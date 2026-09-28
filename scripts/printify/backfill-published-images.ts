import { z } from "zod"

import { createPostgresPool } from "../../src/lib/create-postgres-pool.server"
import { isPublicBlobHost } from "../../src/lib/is-public-blob-host"

const productIdSchema = z.string().regex(/^[a-f\d]{24}$/)
const outcomeSchema = z.enum(["updated", "unchanged", "partial", "skipped", "failed"])
const failureCodeSchema = z.enum([
  "IMAGE_SOURCE_INVALID",
  "IMAGE_CONTENT_INVALID",
  "IMAGE_SOURCE_UNAVAILABLE",
  "IMAGE_SOURCE_CHANGED",
  "IMAGE_STORAGE_UNAVAILABLE",
  "IMAGE_STORAGE_CONFLICT",
  "IMAGE_STORAGE_CONFIGURATION",
  "IMAGE_RECEIPT_UNAVAILABLE",
  "IMAGE_BACKFILL_UNKNOWN",
])
const resultSchema = z
  .object({
    mode: z.literal("apply"),
    products: z.record(outcomeSchema, z.array(productIdSchema).max(5)),
    counts: z.record(outcomeSchema, z.number().int().min(0).max(5)),
    failures: z
      .array(
        z
          .object({ productId: productIdSchema, code: failureCodeSchema, disposition: z.enum(["retry", "review"]) })
          .strict()
      )
      .max(5),
    cacheInvalidation: z.discriminatedUnion("status", [
      z.object({ status: z.enum(["not-needed", "complete"]) }).strict(),
      z
        .object({
          status: z.literal("failed"),
          code: z.literal("IMAGE_CACHE_INVALIDATION_FAILED"),
          disposition: z.literal("retry"),
        })
        .strict(),
    ]),
    nextAfterProductId: productIdSchema.nullable(),
    hasMore: z.boolean(),
  })
  .strict()
  .refine((value) => outcomeSchema.options.every((outcome) => value.counts[outcome] === value.products[outcome].length))
  .refine((value) => {
    const ids = Object.values(value.products).flat()
    return ids.length <= 5 && new Set(ids).size === ids.length
  })
  .refine(
    (value) =>
      value.failures.length === value.products.failed.length &&
      new Set(value.failures.map((failure) => failure.productId)).size === value.failures.length &&
      value.failures.every((failure) => value.products.failed.includes(failure.productId))
  )

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === "--help") {
    console.log(
      "Inspect published image hosting without changing data. --apply sends one authenticated batch to the deployed storefront. Options: --product-id ID, --after-product-id ID, --limit 1..5 (default 5). No Printify product reads or callbacks. Retry partial IDs and failures marked retry with --product-id; resolve failures marked review first. A failed batch cache refresh can be retried using an updated/unchanged product. Continue later batches with the returned cursor."
    )
    return
  }
  const values = new Map<string, string>()
  let apply = false
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!
    if (argument === "--apply" && !apply) {
      apply = true
      continue
    }
    if (!["--product-id", "--after-product-id", "--limit"].includes(argument) || values.has(argument))
      throw new Error("Invalid arguments")
    const value = args[++index]
    if (!value || value.startsWith("--")) throw new Error("Missing option value")
    values.set(argument, value)
  }
  const productId = values.has("--product-id") ? productIdSchema.parse(values.get("--product-id")) : undefined
  const afterProductId = values.has("--after-product-id")
    ? productIdSchema.parse(values.get("--after-product-id"))
    : undefined
  const limitValue = values.get("--limit") ?? "5"
  if (!/^[1-5]$/.test(limitValue) || (productId && afterProductId)) throw new Error("Invalid selection")
  const limit = Number(limitValue)
  if (apply) {
    const secret = process.env.CRON_SECRET
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
    if (!secret || secret.length < 32 || !siteUrl) throw new Error("Missing authenticated backfill configuration")
    const site = new URL(siteUrl)
    if (
      site.username ||
      site.password ||
      site.search ||
      site.hash ||
      site.pathname !== "/" ||
      (site.protocol !== "https:" && !(site.protocol === "http:" && ["localhost", "127.0.0.1"].includes(site.hostname)))
    )
      throw new Error("Invalid storefront origin")
    const response = await fetch(new URL("/api/internal/product-images/backfill", site), {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ productId, afterProductId, limit }),
      redirect: "error",
      signal: AbortSignal.timeout(65_000),
    })
    if (!response.ok) throw new Error("Backfill request did not succeed")
    const result = resultSchema.parse(await response.json())
    console.log(JSON.stringify(result))
    if (result.counts.failed || result.cacheInvalidation.status === "failed") process.exitCode = 1
    return
  }

  const shopId = process.env.PRINTIFY_SHOP_ID
  const databaseUrl = process.env.DATABASE_URL
  const blobHost = process.env.NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST
  if (!shopId || !/^[1-9]\d*$/.test(shopId) || !databaseUrl || !blobHost || !isPublicBlobHost(blobHost))
    throw new Error("Missing image inventory configuration")
  const pool = createPostgresPool(databaseUrl, 1)
  try {
    const client = await pool.connect()
    try {
      await client.query("begin read only")
      await client.query("set local statement_timeout = '5s'")
      const result = await client.query<{ product_id: string; snapshot: Record<string, unknown>; blocked: boolean }>(
        `select p.product_id,p.snapshot,
          exists(select 1 from commerce.printify_publish_jobs j where j.shop_id=p.shop_id and j.product_id=p.product_id
            and j.state in ('pending','callback')) as blocked
        from commerce.printify_products p
        where p.shop_id=$1 and p.active and ($2::text is null or p.product_id=$2)
          and ($3::text is null or p.product_id>$3)
        order by p.product_id limit $4`,
        [shopId, productId ?? null, afterProductId ?? null, limit + 1]
      )
      await client.query("commit")
      const products = result.rows.slice(0, limit).map((row) => {
        const id = productIdSchema.parse(row.product_id)
        if (!Array.isArray(row.snapshot.images)) throw new Error("Published images need review")
        const alreadyHosted = row.snapshot.images.filter((image: unknown) => {
          if (!image || typeof image !== "object" || !("src" in image) || typeof image.src !== "string") return false
          try {
            const url = new URL(image.src)
            return (
              url.protocol === "https:" &&
              url.host === blobHost &&
              !url.username &&
              !url.password &&
              !url.search &&
              !url.hash &&
              /^\/published-mockups\/v1\/[a-f\d]{64}\.(jpg|png|webp)$/.test(url.pathname)
            )
          } catch {
            return false
          }
        }).length
        return {
          productId: id,
          imageCount: row.snapshot.images.length,
          alreadyHosted,
          remainingImages: row.snapshot.images.length - alreadyHosted,
          blockedByPublishing: row.blocked,
        }
      })
      console.log(
        JSON.stringify({
          mode: "dry-run",
          products,
          hasMore: result.rows.length > limit,
          nextAfterProductId: result.rows.length > limit ? (products.at(-1)?.productId ?? null) : null,
          databaseChanged: false,
          storageChanged: false,
          printifyChanged: false,
        })
      )
    } finally {
      client.release()
    }
  } finally {
    await pool.end()
  }
}

main().catch(() => {
  console.error(
    "Published image backfill needs review. Check arguments and environment. Dry runs do not change data; --apply may have committed images before an interrupted response. Repeat that product safely to finish uploads and refresh caches. Provider details and credentials are not printed."
  )
  process.exitCode = 1
})
