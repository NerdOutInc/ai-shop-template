import "server-only"

import { readCatalogRefreshHealth } from "@/features/catalog-sync/read-catalog-refresh-health.server"
import type { GarmentFeedProfile } from "@/features/garment-catalog/garment-feed-profile-schema"
import { logMerchantFeedFailure } from "@/features/merchant-feed/log-merchant-feed-failure.server"
import { MerchantFeedError } from "@/features/merchant-feed/merchant-feed-error"
import { prepareMerchantProduct } from "@/features/merchant-feed/prepare-merchant-product.server"
import { env } from "@/lib/env"
import { getSiteUrl } from "@/lib/get-site-url"
import { parsePrintifyProduct } from "@/lib/printify/parse-printify-product"

import { getPublishingStore } from "./get-publishing-store.server"
import type { PublishingHealth, PublishingHealthCounts } from "./publishing-health"

function readProvider(
  path: string,
  config: { shopId: string; token: string },
  deadline: AbortSignal,
  timeoutMs = 5_000
) {
  return fetch(`https://api.printify.com/v1/shops/${config.shopId}/${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "User-Agent": "Clothing-Store/0.1",
      Accept: "application/json",
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.any([deadline, AbortSignal.timeout(timeoutMs)]),
  })
}

function providerFailureIssue(error: unknown, deadline: AbortSignal) {
  if (deadline.aborted) return "CHECK_INCOMPLETE"
  // Our signals only abort on deadlines; reading an aborted response body can throw AbortError.
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))
    return "PRINTIFY_TIMEOUT"
  return "PRINTIFY_UNAVAILABLE"
}

async function readLockedProducts(config: { shopId: string; token: string }, deadline: AbortSignal) {
  // Inventory responses are larger than individual products and can take over ten seconds.
  // Share the former two-page allowance so one slow page can use spare time from the other.
  const scanDeadline = AbortSignal.any([deadline, AbortSignal.timeout(30_000)])
  const seen = new Set<string>()
  const locked: string[] = []
  let expectedTotal: number | undefined
  let expectedLastPage: number | undefined
  for (let page = 1; page <= 2; page++) {
    const startedAt = Date.now()
    let phase = "headers"
    let status: number | undefined
    let raw: unknown
    try {
      scanDeadline.throwIfAborted()
      const response = await readProvider(`products.json?limit=50&page=${page}`, config, scanDeadline, 30_000)
      if (!response.ok) {
        phase = "status"
        status = response.status
        throw new Error("PRINTIFY_UNAVAILABLE")
      }
      phase = "body"
      raw = await response.json()
    } catch (error) {
      const code = providerFailureIssue(error, deadline)
      if (code !== "CHECK_INCOMPLETE")
        console.error("Publishing inventory read failed", {
          code,
          page,
          phase,
          ...(status === undefined ? {} : { status }),
          elapsedMs: Date.now() - startedAt,
        })
      throw error
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("INVENTORY_SCAN_INCOMPLETE")
    const result = raw as Record<string, unknown>
    if (
      !Array.isArray(result.data) ||
      result.data.length > 50 ||
      result.current_page !== page ||
      typeof result.total !== "number" ||
      !Number.isSafeInteger(result.total) ||
      result.total < 0 ||
      result.total > 100 ||
      typeof result.last_page !== "number" ||
      !Number.isSafeInteger(result.last_page) ||
      result.last_page < page ||
      result.last_page > 2
    )
      throw new Error("INVENTORY_SCAN_INCOMPLETE")
    expectedTotal ??= result.total
    expectedLastPage ??= result.last_page
    if (result.total !== expectedTotal || result.last_page !== expectedLastPage)
      throw new Error("INVENTORY_SCAN_INCOMPLETE")
    for (const value of result.data) {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVENTORY_SCAN_INCOMPLETE")
      const product = value as Record<string, unknown>
      if (
        typeof product.id !== "string" ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(product.id) ||
        String(product.shop_id) !== config.shopId ||
        typeof product.is_locked !== "boolean" ||
        seen.has(product.id)
      )
        throw new Error("INVENTORY_SCAN_INCOMPLETE")
      seen.add(product.id)
      if (product.is_locked) locked.push(product.id)
    }
    if (page === result.last_page) {
      if (seen.size !== result.total) throw new Error("INVENTORY_SCAN_INCOMPLETE")
      return locked
    }
  }
  throw new Error("INVENTORY_SCAN_INCOMPLETE")
}

export async function readPublishingHealth(): Promise<PublishingHealth> {
  const counts: PublishingHealthCounts = { activeProducts: 0, attentionJobs: 0, overdueJobs: 0, checkedProducts: 0 }
  const issues = new Set<string>()
  const result = (): PublishingHealth => ({
    status: issues.size ? "unhealthy" : "healthy",
    checkedAt: new Date().toISOString(),
    issues: [...issues].sort(),
    counts,
  })
  if (!env.PRINTIFY_PUBLISHING_ENABLED) {
    issues.add("PUBLISHING_DISABLED")
    return result()
  }
  const token = env.PRINTIFY_API_TOKEN
  const shopId = env.PRINTIFY_SHOP_ID
  if (
    !token?.trim() ||
    /[\r\n]/.test(token) ||
    !shopId ||
    !/^[1-9]\d*$/.test(shopId) ||
    !env.DATABASE_URL ||
    !env.PRINTIFY_PUBLISHING_API_TOKEN ||
    !env.PRINTIFY_WEBHOOK_SECRET ||
    !env.CRON_SECRET
  ) {
    issues.add("PUBLISHING_NOT_CONFIGURED")
    return result()
  }
  const deadline = AbortSignal.timeout(40_000)
  let productIds: string[]
  let openJobProductIds: Set<string>
  try {
    const snapshot = await getPublishingStore().readHealth()
    counts.activeProducts = snapshot.activeProducts
    counts.attentionJobs = snapshot.attentionJobs
    counts.overdueJobs = snapshot.overdueJobs
    productIds = snapshot.productIds
    if (snapshot.failedPublications) issues.add("FAILED_PUBLICATIONS")
    if (snapshot.openJobProductCount > 500 || snapshot.openJobProductIds.length > 500) {
      issues.add("OPEN_JOB_LIMIT_EXCEEDED")
      return result()
    }
    openJobProductIds = new Set(snapshot.openJobProductIds)
  } catch {
    issues.add("DATABASE_UNAVAILABLE")
    return result()
  }
  if (counts.attentionJobs) issues.add("ATTENTION_JOBS")
  if (counts.activeProducts) for (const issue of await readCatalogRefreshHealth()) issues.add(issue)
  if (counts.overdueJobs) issues.add("OVERDUE_JOBS")
  if (counts.activeProducts > 100 || productIds.length > 100) {
    issues.add("PRODUCT_LIMIT_EXCEEDED")
    return result()
  }
  try {
    // Frozen listing defects need publication repairs even when the provider's saved draft is valid.
    const snapshots = await getPublishingStore().listProducts()
    const profiles = snapshots.length
      ? await getPublishingStore().garments.listFeedProfiles()
      : new Map<number, GarmentFeedProfile>()
    const siteUrl = getSiteUrl()
    const seen = new Set<string>()
    for (const snapshot of snapshots) {
      try {
        const { display } = prepareMerchantProduct(snapshot, shopId, siteUrl, profiles)
        if (seen.has(display.id.toLowerCase())) throw new MerchantFeedError("INVALID_PRODUCT_ID", display.id)
        seen.add(display.id.toLowerCase())
      } catch (error) {
        issues.add("MERCHANT_CATALOG_INVALID")
        logMerchantFeedFailure(error, "publishing-health")
      }
    }
  } catch {
    issues.add("DATABASE_UNAVAILABLE")
    logMerchantFeedFailure(new MerchantFeedError("DATABASE_UNAVAILABLE"), "publishing-health")
    return result()
  }
  const providerConfig = { shopId, token }
  async function checkInventory() {
    try {
      const locked = await readLockedProducts(providerConfig, deadline)
      if (locked.some((productId) => !openJobProductIds.has(productId))) issues.add("SOURCE_LOCK_WITHOUT_JOB")
    } catch (error) {
      issues.add("INVENTORY_SCAN_INCOMPLETE")
      if (deadline.aborted) issues.add("CHECK_INCOMPLETE")
      else if (!(error instanceof Error) || error.message !== "INVENTORY_SCAN_INCOMPLETE")
        issues.add(providerFailureIssue(error, deadline))
    }
  }
  let next = 0
  async function checkProducts() {
    while (next < productIds.length && !deadline.aborted) {
      const productId = productIds[next++]!
      try {
        const response = await readProvider(`products/${encodeURIComponent(productId)}.json`, providerConfig, deadline)
        if (response.status === 404) issues.add("LIVE_PRODUCT_MISSING")
        else if (!response.ok) issues.add("PRINTIFY_UNAVAILABLE")
        else if (!parsePrintifyProduct(await response.json(), { productId, shopId: providerConfig.shopId }))
          issues.add("LIVE_PRODUCT_INVALID")
      } catch (error) {
        issues.add(providerFailureIssue(error, deadline))
      } finally {
        counts.checkedProducts++
      }
    }
  }
  // Reserve one of the four request slots for inventory, then return it to product checks.
  await Promise.all([
    checkInventory().then(checkProducts),
    ...Array.from({ length: Math.min(3, productIds.length) }, checkProducts),
  ])
  if (deadline.aborted || counts.checkedProducts !== counts.activeProducts) issues.add("CHECK_INCOMPLETE")
  return result()
}
