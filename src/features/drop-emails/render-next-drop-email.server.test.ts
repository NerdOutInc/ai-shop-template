// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { CatalogProduct } from "@/features/catalog/catalog-product"
import { readPublishedCatalog } from "@/features/catalog/read-published-catalog.server"
import { listPublishedProducts } from "@/features/publishing/list-published-products-for-admin.server"

import { dropEmailSubscriberPlaceholder } from "./drop-email-subscriber-placeholder"
import { readDropEmailSetup } from "./read-drop-email-setup.server"
import { renderNextDropEmail } from "./render-next-drop-email.server"

const { schedule, emailed } = vi.hoisted(() => ({ schedule: vi.fn(), emailed: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/features/publishing/get-publishing-store.server", () => ({
  getPublishingStore: () => ({ productSchedule: { list: schedule } }),
}))
vi.mock("./get-drop-email-pool.server", () => ({ getDropEmailPool: () => ({ query: emailed }) }))
vi.mock("@/features/publishing/list-published-products-for-admin.server", () => ({ listPublishedProducts: vi.fn() }))
vi.mock("@/features/catalog/read-published-catalog.server", () => ({ readPublishedCatalog: vi.fn() }))
vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://store.example") }))
vi.mock("./read-drop-email-setup.server", () => ({ readDropEmailSetup: vi.fn() }))

const product = (
  id: string,
  title: string,
  availability: CatalogProduct["availability"] = "available"
): CatalogProduct => ({
  id,
  title,
  description: "",
  addedToShopAt: null,
  salesCount: 0,
  image: { src: `https://example.public.blob.vercel-storage.com/published-mockups/v1/${id}.jpg`, alt: title },
  images: [],
  price: { currency: "USD", min: 3000, max: 3000 },
  options: [],
  variants: [],
  colors: [],
  sizeGuide: null,
  availability,
})
const entry = (productId: string, liveAt: string) => ({ id: `${productId}-${liveAt}`, productId, liveAt })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  // Wednesday September 30, 2026: last Monday's drop is over; the next is October 5.
  vi.setSystemTime(new Date("2026-09-30T17:00:00Z"))
  schedule.mockResolvedValue([
    entry("morning", "2026-09-28T09:00:00.000Z"),
    entry("lines-crop", "2026-10-05T09:00:00.000Z"),
    entry("lines-tee", "2026-10-05T09:00:00.000Z"),
    entry("fern", "2026-10-12T09:00:00.000Z"),
  ])
  emailed.mockResolvedValue({ rows: [] })
  vi.mocked(listPublishedProducts).mockResolvedValue([{ id: "lines-tee" }, { id: "lines-crop" }, { id: "fern" }])
  vi.mocked(readPublishedCatalog).mockImplementation(async (snapshots) => ({
    status: "ready",
    products: snapshots.map((snapshot) =>
      product(
        String(snapshot.id),
        snapshot.id === "fern" ? "Fern Study - Premium T-Shirt" : `Abstract Lines - ${snapshot.id}`
      )
    ),
  }))
  vi.mocked(readDropEmailSetup).mockReturnValue({
    missing: [],
    storeSettings: [],
    sending: true,
    from: "Fixture Store <drops@fixture.example>",
    postalAddress: "PO Box 123, Austin, TX 78701",
  })
})
afterEach(() => vi.useRealTimers())

describe("renderNextDropEmail", () => {
  it("renders the next drop nobody has been emailed about, hidden products included, in shop order", async () => {
    const next = await renderNextDropEmail()
    expect(next).toMatchObject({
      status: "ready",
      liveAt: "2026-10-05T09:00:00.000Z",
      sendAt: "2026-10-05T14:00:00.000Z",
      productCount: 2,
      subject: "New this week: Abstract Lines",
    })
    expect(vi.mocked(readPublishedCatalog).mock.calls[0]![0]).toEqual([{ id: "lines-tee" }, { id: "lines-crop" }])
    // The same frozen shape the sender uses, so a preview is filled in exactly like a real send.
    expect(next.status === "ready" && next.html).toContain(
      `https://store.example/unsubscribe/${dropEmailSubscriberPlaceholder}`
    )
    expect(next.status === "ready" && next.html).toContain("PO Box 123, Austin, TX 78701")
  })

  it("moves on once a drop's email has been frozen, and says when nothing is left", async () => {
    emailed.mockResolvedValue({ rows: [{ live_at: new Date("2026-10-05T09:00:00Z") }] })
    expect(await renderNextDropEmail()).toMatchObject({ status: "ready", subject: "New this week: Fern Study" })
    schedule.mockResolvedValue([entry("morning", "2026-09-28T09:00:00.000Z")])
    expect(await renderNextDropEmail()).toEqual({ status: "none" })
  })

  it("still previews on the drop's own morning, until the email is frozen", async () => {
    vi.setSystemTime(new Date("2026-10-05T12:00:00Z"))
    expect(await renderNextDropEmail()).toMatchObject({ status: "ready", liveAt: "2026-10-05T09:00:00.000Z" })
  })

  it("says so when the week has nothing an email could offer", async () => {
    vi.mocked(readPublishedCatalog).mockResolvedValue({
      status: "ready",
      products: [product("lines-tee", "Abstract Lines - Premium T-Shirt", "unavailable")],
    })
    expect(await renderNextDropEmail()).toEqual({
      status: "empty",
      liveAt: "2026-10-05T09:00:00.000Z",
      sendAt: "2026-10-05T14:00:00.000Z",
    })
  })

  it("marks where the mailing address goes before one is set", async () => {
    vi.mocked(readDropEmailSetup).mockReturnValue({
      missing: ["STORE_POSTAL_ADDRESS"],
      storeSettings: [],
      sending: false,
      from: null,
      postalAddress: null,
    })
    const next = await renderNextDropEmail()
    expect(next.status === "ready" && next.html).toContain("once STORE_POSTAL_ADDRESS is set")
  })
})
