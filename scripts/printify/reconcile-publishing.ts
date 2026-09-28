import { createPostgresPool } from "../../src/lib/create-postgres-pool.server"

import { requestPrintifyOperation } from "./request-printify-operation"

type Product = { id: string; title: string; locked: boolean }

async function readProducts(config: { apiToken: string; shopId: string }): Promise<Product[]> {
  const products: Product[] = []
  const seen = new Set<string>()
  const deadline = Date.now() + 120_000
  let expectedTotal: number | undefined
  let expectedLastPage: number | undefined
  for (let page = 1; page <= 20; page++) {
    if (Date.now() >= deadline) throw new Error("Product scan deadline reached")
    const raw = await requestPrintifyOperation(config, `products.json?limit=50&page=${page}`, {
      timeoutMs: deadline - Date.now(),
    })
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid product page")
    const result = raw as Record<string, unknown>
    if (
      !Array.isArray(result.data) ||
      result.data.length > 50 ||
      result.current_page !== page ||
      typeof result.total !== "number" ||
      !Number.isSafeInteger(result.total) ||
      result.total < 0 ||
      typeof result.last_page !== "number" ||
      !Number.isSafeInteger(result.last_page) ||
      result.last_page < page ||
      result.last_page > 20
    ) {
      throw new Error("Product pagination is incomplete")
    }
    expectedTotal ??= result.total
    expectedLastPage ??= result.last_page
    if (expectedTotal !== result.total || expectedLastPage !== result.last_page)
      throw new Error("Products changed during pagination")
    for (const rawProduct of result.data) {
      if (!rawProduct || typeof rawProduct !== "object" || Array.isArray(rawProduct)) throw new Error("Invalid product")
      const product = rawProduct as Record<string, unknown>
      if (
        typeof product.id !== "string" ||
        typeof product.title !== "string" ||
        typeof product.is_locked !== "boolean" ||
        String(product.shop_id) !== config.shopId ||
        seen.has(product.id)
      )
        throw new Error("Invalid product identity")
      seen.add(product.id)
      products.push({ id: product.id, title: product.title, locked: product.is_locked })
    }
    if (page === result.last_page) {
      if (products.length !== result.total) throw new Error("Product totals did not match")
      return products
    }
  }
  throw new Error("Product scan exceeded its page bound")
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === "--help") {
    console.log(
      "Read-only publishing reconciliation: compare Printify locks with durable jobs. At most 20 product pages, 120 seconds of provider scanning, and 500 open jobs. Never publishes, resets, or updates a product/job."
    )
    return
  }
  if (args.length) throw new Error("No mutation arguments are supported")
  const apiToken = process.env.PRINTIFY_API_TOKEN
  const shopId = process.env.PRINTIFY_SHOP_ID
  const databaseUrl = process.env.DATABASE_URL
  if (!apiToken || !shopId || !databaseUrl) throw new Error("Missing reconciliation configuration")
  const products = await readProducts({ apiToken, shopId })
  const pool = createPostgresPool(databaseUrl)
  try {
    const client = await pool.connect()
    try {
      await client.query("begin read only")
      const result = await client.query<{
        product_id: string
        event_id: string
        state: string
        failure_code: string | null
        attempts: number
        next_attempt_at: Date
      }>(
        "select product_id,event_id,state,failure_code,attempts,next_attempt_at from commerce.printify_publish_jobs where shop_id=$1 and state in ('pending','callback','attention') order by event_created_at limit 501",
        [shopId]
      )
      await client.query("commit")
      if (result.rows.length > 500) throw new Error("Open job scan exceeded its bound")
      const byId = new Map(products.map((product) => [product.id, product]))
      const locked = products
        .filter((product) => product.locked)
        .map((product) => ({
          productId: product.id,
          title: product.title,
          jobs: result.rows
            .filter((job) => job.product_id === product.id)
            .map((job) => ({
              eventId: job.event_id,
              state: job.state,
              failureCode: job.failure_code,
              attempts: job.attempts,
            })),
        }))
      console.log(
        JSON.stringify({
          readOnly: true,
          completeScan: true,
          snapshotIsNotAtomic: true,
          shopId,
          scannedProducts: products.length,
          lockedProducts: locked,
          lockedWithoutOpenJob: locked.filter((product) => !product.jobs.length).map((product) => product.productId),
          openJobsWithoutCurrentLock: result.rows
            .filter((job) => !byId.get(job.product_id)?.locked)
            .map((job) => ({
              eventId: job.event_id,
              productId: job.product_id,
              state: job.state,
              productPresent: byId.has(job.product_id),
              failureCode: job.failure_code,
            })),
          reminder:
            "Review mismatches against source and published snapshots. No missing event is inferred as authorization to publish a draft.",
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
    "Publishing reconciliation is incomplete. Check configuration, API access, database migration, and pagination bounds. No remote or database mutations were attempted; partial results are not reported as complete."
  )
  process.exitCode = 1
})
