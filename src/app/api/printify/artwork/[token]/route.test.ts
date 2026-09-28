// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest"
import { readPrivateAsset } from "@/features/design-library/read-private-asset.server"
import { readProviderArtworkCapability } from "@/features/design-products/read-provider-artwork-capability.server"
import { assertDesignAgentGrantActive } from "@/features/design-agent/assert-design-agent-grant-active.server"
import { GET, HEAD, maxDuration } from "./route"
vi.mock("server-only", () => ({}))
vi.mock("@/features/design-agent/assert-design-agent-grant-active.server", () => ({
  assertDesignAgentGrantActive: vi.fn(),
}))
vi.mock("@/features/design-library/read-private-asset.server", () => ({ readPrivateAsset: vi.fn() }))
vi.mock("@/features/design-products/read-provider-artwork-capability.server", () => ({
  readProviderArtworkCapability: vi.fn(),
}))
const context = { params: Promise.resolve({ token: "opaque" }) }
beforeEach(() => vi.resetAllMocks())
it("serves only a validated private print asset with no-store responses", async () => {
  vi.mocked(readProviderArtworkCapability).mockResolvedValue({
    id: "asset",
    mimeType: "image/png",
    bytes: 3,
    capabilityExpiresAt: Date.now() + 5000,
  } as Awaited<ReturnType<typeof readProviderArtworkCapability>>)
  vi.mocked(readPrivateAsset).mockResolvedValue(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.close()
      },
    })
  )
  const response = await GET(new Request("https://store.example"), context)
  expect(response.status).toBe(200)
  expect(maxDuration).toBe(60)
  expect(readProviderArtworkCapability).toHaveBeenCalledWith("opaque", { authorize: assertDesignAgentGrantActive })
  expect(response.headers.get("Cache-Control")).toBe("private, no-store")
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  const head = await HEAD(new Request("https://store.example"), context)
  expect(head.headers.get("Content-Length")).toBe("3")
  expect(await head.text()).toBe("")
  expect(readPrivateAsset).toHaveBeenCalledTimes(1)
})
it("conceals expired/revoked capabilities and storage errors without disclosing tokens", async () => {
  vi.mocked(readProviderArtworkCapability).mockResolvedValue(null)
  expect((await GET(new Request("https://store.example"), context)).status).toBe(404)
  vi.mocked(readProviderArtworkCapability).mockRejectedValue(new Error("secret grant details"))
  const response = await GET(new Request("https://store.example"), context)
  expect(response.status).toBe(404)
  expect(await response.text()).toBe("")
  expect(response.headers.get("Cache-Control")).toBe("private, no-store")
})
