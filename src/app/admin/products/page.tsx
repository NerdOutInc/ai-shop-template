import type { Metadata } from "next"
import Link from "next/link"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { requireAdmin } from "@/features/admin/require-admin.server"
import { readAdminProductSchedule } from "@/features/design-of-the-week/read-admin-product-schedule.server"
import { listCadenceSlots } from "@/features/publishing/list-cadence-slots"
import { storeConfig } from "@/lib/store-config"
import { formatStoreMoment } from "@/lib/format-store-moment"
import { FeaturedOrderList } from "@/features/featured-order/featured-order-list"
import type { FeaturedOrderProduct } from "@/features/featured-order/featured-order-product"
import { listFeaturedOrder } from "@/features/featured-order/list-featured-order.server"
import { listProductGarmentStatus } from "@/features/garment-catalog/list-product-garment-status.server"
import { hasRevealArrived } from "@/features/publishing/has-reveal-arrived"

import { getWeeklyHeroStore } from "@/features/weekly-heroes/get-weekly-hero-store.server"

import { ProductsSectionNav } from "./_components/products-section-nav"

export const metadata: Metadata = { title: "Products", robots: { index: false, follow: false } }
export const dynamic = "force-dynamic"

export default async function AdminProductsPage() {
  await requireAdmin()
  // Three separate caught reads. The garment one answers null when it cannot tell (its migration
  // may be merged but not pushed), and then the lineup simply carries no garment notices.
  const [result, drop, garmentStatus, heroes] = await Promise.all([
    listFeaturedOrder(),
    storeConfig.features.designOfTheWeek ? readAdminProductSchedule() : null,
    listProductGarmentStatus(),
    storeConfig.features.designOfTheWeek
      ? Promise.resolve()
          .then(() => getWeeklyHeroStore().summaries())
          .catch(() => null)
      : null,
  ])
  // `complete` is the database's answer and is only ever passed along here, never worked out again.
  const waiting = new Map(
    (garmentStatus ?? []).filter((status) => !status.complete).map((status) => [status.productId, status])
  )
  const lineup: FeaturedOrderProduct[] = (result.status === "ready" ? result.products : []).map((product) => {
    const garment = waiting.get(product.id)
    return garment ? { ...product, garmentSetup: { blueprintId: garment.blueprintId, label: garment.label } } : product
  })
  // Both drops are counted against the same lineup and the same instant the lineup was grouped by.
  const now = Math.max(result.status === "ready" ? result.now : 0, drop?.status === "ready" ? drop.now : 0)
  // The summary says "cannot be shown", which is only true of a product hidden from the storefront. One that
  // is already up on an unfinished garment (a republish onto another blueprint, say) stays up and
  // sells as before; its row still carries the notice, but counting it here would be a fib. Hidden
  // is the lineup's own test: an indefinite hide, or a reveal that has not arrived.
  const waitingCount = lineup.filter(
    (product) =>
      product.garmentSetup &&
      product.hiddenAt !== null &&
      (product.revealAt === null || !hasRevealArrived({ revealAt: product.revealAt }, now))
  ).length
  const garmentKey = ({ garmentSetup }: FeaturedOrderProduct) =>
    garmentSetup ? `waiting:${garmentSetup.blueprintId ?? ""}:${garmentSetup.label ?? ""}` : ""
  const slots = (storeConfig.features.designOfTheWeek ? listCadenceSlots({ from: new Date(now), count: 6 }) : []).map(
    (date) => ({
      value: date.toISOString(),
      label: formatStoreMoment(date.toISOString(), { weekday: "long", month: "long", day: "numeric" }),
    })
  )
  const designOfWeekProductIds =
    drop?.status === "ready"
      ? drop.entries.filter((entry) => Date.parse(entry.liveAt) <= now).map((entry) => entry.productId)
      : []

  return (
    <main id="main-content" tabIndex={-1} className="page-width flex flex-col gap-8 py-10 sm:py-14">
      <header className="max-w-2xl">
        <p className="font-condensed mb-3 text-sm font-semibold tracking-widest text-muted-foreground uppercase">
          Products
        </p>
        <h1 className="display-heading">Shop lineup</h1>
        <p className="mt-4 text-muted-foreground">
          {storeConfig.features.designOfTheWeek
            ? "Plan the next six weeks, preview products privately, and arrange the shop. Published products are ready to show or feature."
            : "Preview products privately and arrange the shop. Published products are ready to show."}
        </p>
      </header>
      <ProductsSectionNav current="lineup" />
      {waitingCount > 0 && (
        // Not an error, and not red: nothing is broken, these hidden tees are just waiting on a garment.
        // Each row carries the precise pointer; this saves scanning three lists to learn there is any.
        <p className="rounded-lg border p-4 text-sm">
          {waitingCount === 1
            ? `1 product is waiting on garment setup and cannot be shown${storeConfig.features.designOfTheWeek ? " or scheduled" : ""}.`
            : `${waitingCount} products are waiting on garment setup and cannot be shown${storeConfig.features.designOfTheWeek ? " or scheduled" : ""}.`}{" "}
          <Link
            href="/admin/products/garments"
            className="inline-flex min-h-11 items-center underline underline-offset-4"
          >
            Open Garment models
          </Link>
        </p>
      )}
      {drop?.status === "unavailable" && (
        <Alert variant="destructive">
          <AlertDescription>
            The weekly schedule is unavailable right now. Product order is still available. Check that the latest
            migration has been applied before changing visibility or the weekly schedule.
          </AlertDescription>
        </Alert>
      )}
      {result.status === "unavailable" ? (
        <Alert variant="destructive">
          <AlertDescription>
            The product list is unavailable right now. Try again shortly, or check the publishing monitor.
          </AlertDescription>
        </Alert>
      ) : (
        // A refresh with a different lineup, a visibility change made elsewhere, a schedule moved in
        // another tab, or a garment finished on the Garment models page starts over from what the
        // server now says rather than leaving the client grouped stale. The list copies its products
        // once, so a garment flag left out of this key would keep a fixed tee's Show disabled.
        <FeaturedOrderList
          key={[
            ...lineup.map(
              (product) =>
                `${product.id}:${product.hiddenAt ?? ""}:${product.revealAt ?? ""}:${product.addedToShopAt ?? ""}:${garmentKey(product)}`
            ),
            ...(drop?.status === "ready"
              ? drop.entries.map((entry) => `${entry.productId}:${entry.liveAt}`)
              : [storeConfig.features.designOfTheWeek ? "schedule-unavailable" : "schedule-disabled"]),
            ...slots.map((slot) => slot.value),
          ].join("\n")}
          heroes={heroes}
          products={lineup}
          now={now}
          designOfWeekProductIds={designOfWeekProductIds}
          schedule={drop?.status === "ready" ? { entries: drop.entries, slots } : undefined}
        />
      )}
    </main>
  )
}
