// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"

import { PrintifyPublishingClient } from "./printify-publishing-client.server"

vi.mock("server-only", () => ({}))
afterEach(() => vi.unstubAllGlobals())

describe("publishing request delivery evidence", () => {
  const client = new PrintifyPublishingClient("test-token", "123")

  it.each(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"])(
    "classifies %s as not sent",
    async (code) => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed", { cause: { code } })))
      await expect(client.request("product", "unpublish")).rejects.toMatchObject({
        delivery: "not-sent",
        message: "PRINTIFY_UNAVAILABLE",
      })
    }
  )

  it.each([
    new TypeError("fetch failed"),
    new TypeError("fetch failed", { cause: { code: "ECONNRESET" } }),
    new TypeError("fetch failed", { cause: { code: "UND_ERR_SOCKET" } }),
    new DOMException("timed out", "TimeoutError"),
    new DOMException("aborted", "AbortError"),
  ])("retains uncertainty for %s", async (error) => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error))
    await expect(client.request("product", "unpublish")).rejects.toMatchObject({ delivery: "uncertain" })
  })

  it.each([
    [400, "rejected"],
    [401, "rejected"],
    [422, "rejected"],
    [408, "uncertain"],
    [500, "uncertain"],
    [503, "uncertain"],
  ])("classifies HTTP %s without leaking its body", async (status, delivery) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("private provider error", { status: Number(status) }))
    )
    await expect(client.request("product", "unpublish")).rejects.toMatchObject({
      delivery,
      message: "PRINTIFY_UNAVAILABLE",
    })
  })

  it("preserves Retry-After on a rate-limit rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 429, headers: { "Retry-After": "120" } }))
    )
    await expect(client.request("product", "unpublish")).rejects.toMatchObject({
      delivery: "rate-limited",
      retryAfterSeconds: 120,
    })
  })

  it("keeps product reads scoped and treats a deleted source as missing", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ id: "other", shop_id: 123 }))
    vi.stubGlobal("fetch", request)
    expect(await client.request("product")).toBeNull()
    await expect(client.request("product")).rejects.toMatchObject({ delivery: "uncertain" })
    expect(request).toHaveBeenCalledWith(
      "https://api.printify.com/v1/shops/123/products/product.json",
      expect.objectContaining({ method: "GET", redirect: "error", cache: "no-store" })
    )
  })
})
