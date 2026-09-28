import { describe, expect, it, vi } from "vitest"
import { orderAlertFixture } from "../../../test/order-alert-fixture"
import { readOrderShipment } from "./read-order-shipment.server"
vi.mock("server-only", () => ({}))

function provider(status = "in-production") {
  return {
    id: "printify-fixture",
    metadata: { shop_order_id: "cs_live_fixture" },
    line_items: [{ product_id: "tee", variant_id: 1, quantity: 1, status, external_id: "cs_live_fixture-0" }],
  }
}
describe("live shipment evidence", () => {
  it("does not equate submission with shipment", async () => {
    const request = vi.fn().mockResolvedValue(provider())
    expect(await readOrderShipment({ request }, orderAlertFixture())).toMatchObject({
      complete: false,
      summary: "0 of 1 order lines reported shipped by Printify.",
    })
    expect(request).toHaveBeenCalledExactlyOnceWith("orders/printify-fixture.json")
  })
  it("accepts a fulfilled Choice replacement with the original external line ID", async () => {
    const raw = provider("fulfilled")
    raw.line_items[0]!.product_id = "replacement"
    raw.line_items[0]!.variant_id = 9
    expect(await readOrderShipment({ request: vi.fn().mockResolvedValue(raw) }, orderAlertFixture())).toMatchObject({
      complete: true,
    })
  })
  it("keeps partial shipments open", async () => {
    const order = orderAlertFixture()
    order.snapshot.items.push({ ...order.snapshot.items[0]!, variantId: 2 })
    const raw = provider("fulfilled")
    raw.line_items.push({
      ...raw.line_items[0]!,
      variant_id: 2,
      external_id: "cs_live_fixture-1",
      status: "in-production",
    })
    expect(await readOrderShipment({ request: vi.fn().mockResolvedValue(raw) }, order)).toMatchObject({
      complete: false,
      summary: "1 of 2 order lines reported shipped by Printify.",
    })
  })
  it.each(["order", "session", "quantity", "missing", "duplicate"])("fails closed on %s mismatch", async (change) => {
    const raw = provider("fulfilled")
    if (change === "order") raw.id = "other"
    if (change === "session") raw.metadata.shop_order_id = "other"
    if (change === "quantity") raw.line_items[0]!.quantity = 2
    if (change === "missing") raw.line_items = []
    if (change === "duplicate") raw.line_items.push({ ...raw.line_items[0]! })
    expect(await readOrderShipment({ request: vi.fn().mockResolvedValue(raw) }, orderAlertFixture())).toMatchObject({
      complete: false,
      needsAttention: true,
      items: [],
    })
  })
  it("reports missing orders and provider errors without leaking the response", async () => {
    const request = vi.fn().mockRejectedValue(new Error("secret customer payload"))
    const order = orderAlertFixture()
    expect(JSON.stringify(await readOrderShipment({ request }, order))).not.toContain("secret")
    order.printify_order_id = null
    expect(await readOrderShipment({ request }, order)).toMatchObject({ complete: false, needsAttention: true })
  })
})
