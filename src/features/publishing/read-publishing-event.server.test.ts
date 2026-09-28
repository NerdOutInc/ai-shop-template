// @vitest-environment node
import { createHmac } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import { readPublishingEvent } from "./read-publishing-event.server"

vi.mock("server-only", () => ({}))

const config = { secret: "fixture-webhook-signing-secret", shopId: "12345" }
const event = {
  id: "653b6be8-2ff7-4ab5-a7a6-6889a8b3bbf5",
  type: "product:publish:started",
  created_at: "2026-09-09 16:00:00+00:00",
  resource: {
    id: "111111000000000000000001",
    type: "product",
    data: { shop_id: 12345, action: "create", publish_details: { title: true, images: false } },
  },
}

function signature(body: string, secret = config.secret) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`
}

function read(value: unknown) {
  const body = JSON.stringify(value)
  return readPublishingEvent(body, signature(body), config)
}

describe("readPublishingEvent", () => {
  it.each(["create", "update"])("reads a signed %s event and retains selective publishing flags", (action) => {
    expect(read({ ...event, resource: { ...event.resource, data: { ...event.resource.data, action } } })).toEqual({
      id: event.id,
      productId: event.resource.id,
      shopId: config.shopId,
      createdAt: event.created_at,
      action,
      publishDetails: { title: true, images: false },
    })
  })

  it.each([null, "", "sha256=abc", `sha1=${"0".repeat(64)}`, `sha256=${"g".repeat(64)}`])(
    "rejects malformed or missing signatures",
    (header) => {
      expect(() => readPublishingEvent(JSON.stringify(event), header, config)).toThrow("signature")
    }
  )

  it("rejects a payload modified after signing", () => {
    const body = JSON.stringify(event)
    expect(() => readPublishingEvent(body.replace('"create"', '"delete"'), signature(body), config)).toThrow(
      "signature"
    )
  })

  it("validates the exact raw body without reparsing it for the signature", () => {
    const body = JSON.stringify(event, null, 2)
    expect(() => readPublishingEvent(body, signature(JSON.stringify(event)), config)).toThrow("signature")
    expect(readPublishingEvent(body, signature(body), config).id).toBe(event.id)
  })

  it("rejects a signature from another webhook secret", () => {
    const body = JSON.stringify(event)
    expect(() => readPublishingEvent(body, signature(body, "another-shop-secret"), config)).toThrow("signature")
  })

  it("rejects the wrong shop even with a valid signature", () => {
    expect(() =>
      read({ ...event, resource: { ...event.resource, data: { ...event.resource.data, shop_id: 123 } } })
    ).toThrow("another shop")
  })

  it("accepts delete without shop_id through the signed shop-bound webhook", () => {
    expect(read({ ...event, resource: { ...event.resource, data: { action: "delete" } } })).toMatchObject({
      action: "delete",
      shopId: config.shopId,
      productId: event.resource.id,
      publishDetails: {},
    })
  })

  it("rejects a delete that explicitly identifies another shop", () => {
    expect(() => read({ ...event, resource: { ...event.resource, data: { action: "delete", shop_id: 123 } } })).toThrow(
      "another shop"
    )
  })

  it.each([
    { action: "update", publish_details: {} },
    { action: "create", shop_id: 12345 },
  ])("requires shop and publishing details for create/update", (data) => {
    expect(() => read({ ...event, resource: { ...event.resource, data } })).toThrow("missing publication details")
  })

  it.each([
    { ...event, type: "product:updated" },
    { ...event, created_at: "not-a-timestamp" },
    { ...event, resource: { ...event.resource, type: "order" } },
    { ...event, resource: { ...event.resource, id: "../other-product" } },
    {
      ...event,
      resource: { ...event.resource, data: { ...event.resource.data, publish_details: { images: "false" } } },
    },
    { ...event, resource: { ...event.resource, data: { ...event.resource.data, action: "publish" } } },
  ])("rejects unsupported or malformed event data", (payload) => {
    expect(() => read(payload)).toThrow("Invalid publishing webhook payload")
  })
})
