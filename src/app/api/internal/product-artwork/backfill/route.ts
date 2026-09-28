import { timingSafeEqual } from "node:crypto"

import { revalidatePath, revalidateTag } from "next/cache"
import { z } from "zod"

import { backfillPublishedArtwork } from "@/features/publishing/backfill-published-artwork.server"
import { readPrivateAsset } from "@/features/design-library/read-private-asset.server"
import { resolvePublishedProductArtwork } from "@/features/design-products/resolve-published-product-artwork.server"
import { getPublishingStore } from "@/features/publishing/get-publishing-store.server"
import { env } from "@/lib/env"

export const runtime = "nodejs"
export const maxDuration = 60

const selectionSchema = z
  .object({
    productId: z
      .string()
      .regex(/^[a-f\d]{24}$/)
      .optional(),
    afterProductId: z
      .string()
      .regex(/^[a-f\d]{24}$/)
      .optional(),
    limit: z.number().int().min(1).max(5).default(5),
  })
  .strict()
  .refine((value) => !(value.productId && value.afterProductId))

function respond(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

async function readSelection(request: Request) {
  const length = request.headers.get("content-length")
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 1_024)) throw new Error("Invalid body size")
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json" || !request.body)
    throw new Error("JSON is required")
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void reader.cancel().catch(() => undefined)
      reject(new Error("Request body timed out"))
    }, 5_000)
  })
  try {
    await Promise.race([
      (async () => {
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          size += chunk.value.byteLength
          if (size > 1_024) throw new Error("Body is too large")
          chunks.push(chunk.value)
        }
      })(),
      timeout,
    ])
    return selectionSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")))
  } finally {
    clearTimeout(timer)
    void reader.cancel().catch(() => undefined)
  }
}

export async function POST(request: Request) {
  if (!env.CRON_SECRET) return respond({ error: "Artwork backfill is not configured" }, 503)
  const received = Buffer.from(request.headers.get("authorization") ?? "", "utf8")
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`, "utf8")
  if (received.length !== expected.length || !timingSafeEqual(received, expected))
    return respond({ error: "Unauthorized" }, 401)
  if (
    !env.PRINTIFY_PUBLISHING_ENABLED ||
    !env.ADMIN_LIBRARY_ENABLED ||
    !env.DATABASE_URL ||
    !env.PRINTIFY_SHOP_ID ||
    !env.NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST
  )
    return respond({ error: "Artwork backfill is not configured" }, 503)
  let selection: z.infer<typeof selectionSchema>
  try {
    selection = await readSelection(request)
  } catch {
    return respond({ error: "Invalid artwork backfill request" }, 400)
  }
  try {
    return respond(
      await backfillPublishedArtwork(
        {
          store: getPublishingStore(),
          shopId: env.PRINTIFY_SHOP_ID,
          blobHost: env.NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST,
          readApproved: resolvePublishedProductArtwork,
          readAsset: readPrivateAsset,
          invalidate: () => {
            revalidateTag("printify-published-catalog", { expire: 0 })
            revalidatePath("/", "layout")
          },
        },
        selection
      )
    )
  } catch {
    console.error("Published artwork backfill could not complete")
    return respond({ error: "Artwork backfill needs retry or review" }, 500)
  }
}
