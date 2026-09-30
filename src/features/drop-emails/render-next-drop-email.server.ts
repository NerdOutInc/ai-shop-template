import "server-only"

import { readPublishedCatalog } from "@/features/catalog/read-published-catalog.server"
import { getPublishingStore } from "@/features/publishing/get-publishing-store.server"
import { listPublishedProducts } from "@/features/publishing/list-published-products-for-admin.server"
import { getSiteUrl } from "@/lib/get-site-url"

import { dropEmailSubscriberPlaceholder } from "./drop-email-subscriber-placeholder"
import { dropUnsubscribeUrls } from "./drop-unsubscribe-urls"
import { getDropEmailPool } from "./get-drop-email-pool.server"
import { readDropEmailSetup } from "./read-drop-email-setup.server"
import { readDropEmailWindow } from "./read-drop-email-window"
import { renderDropEmail } from "./render-drop-email"
import { toDropEmailProduct } from "./to-drop-email-product"

export type NextDropEmail =
  | {
      status: "ready"
      liveAt: string
      sendAt: string
      productCount: number
      subject: string
      html: string
      text: string
    }
  /** Scheduled, but none of its products could go in an email right now. */
  | { status: "empty"; liveAt: string; sendAt: string }
  | { status: "none" }

/**
 * The next drop nobody has been emailed about, rendered as its subscribers would get it, with the
 * subscriber placeholder still in place.
 *
 * Admin only: it reads products that stay hidden until their reveal. The real email is frozen from the
 * live shop at send time, so a product hidden or sold out by then is not in it.
 */
export async function renderNextDropEmail(): Promise<NextDropEmail> {
  const now = Date.now()
  const [entries, frozen] = await Promise.all([
    getPublishingStore().productSchedule.list(),
    getDropEmailPool().query<{ live_at: Date }>("select live_at from commerce.drop_emails"),
  ])
  const emailed = new Set(frozen.rows.map((row) => row.live_at.getTime()))
  const weeks = new Map<number, Set<string>>()
  for (const entry of entries) {
    const at = Date.parse(entry.liveAt)
    weeks.set(at, (weeks.get(at) ?? new Set()).add(entry.productId))
  }
  const next = [...weeks.keys()]
    .sort((a, b) => a - b)
    .find((at) => !emailed.has(at) && readDropEmailWindow(new Date(at).toISOString(), now).state !== "closed")
  if (next === undefined) return { status: "none" }

  const liveAt = new Date(next).toISOString()
  const sendAt = readDropEmailWindow(liveAt, now).sendAt.toISOString()
  const productIds = weeks.get(next)!
  const snapshots = (await listPublishedProducts()).filter((snapshot) => productIds.has(String(snapshot.id)))
  const products = (await readPublishedCatalog(snapshots)).products
    .filter((product) => product.availability === "available")
    .map(toDropEmailProduct)
  if (products.length === 0) return { status: "empty", liveAt, sendAt }

  const siteUrl = getSiteUrl().origin
  const email = await renderDropEmail({
    liveAt,
    products,
    siteUrl,
    postalAddress:
      readDropEmailSetup().postalAddress ?? "[Your mailing address appears here once STORE_POSTAL_ADDRESS is set]",
    unsubscribeUrl: dropUnsubscribeUrls(siteUrl, dropEmailSubscriberPlaceholder).page,
  })
  return { status: "ready", liveAt, sendAt, productCount: products.length, ...email }
}
