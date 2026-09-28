// @vitest-environment node
import { expect, it, vi } from "vitest"
import { readDesignAssetBytes } from "./read-design-asset-bytes.server"
import { streamProviderArtwork } from "./stream-provider-artwork.server"
vi.mock("server-only", () => ({}))
it("cancels a stalled source read on the request deadline", async () => {
  const controller = new AbortController(),
    cancel = vi.fn()
  const source = new ReadableStream<Uint8Array>({ cancel })
  const result = readDesignAssetBytes(source, controller.signal)
  controller.abort(new Error("deadline"))
  await expect(result).rejects.toThrow("deadline")
  expect(cancel).toHaveBeenCalledTimes(1)
})
it("stops an already-started provider response at expiry", async () => {
  const controller = new AbortController(),
    cancel = vi.fn()
  const source = new ReadableStream<Uint8Array>({
    start(output) {
      output.enqueue(new Uint8Array([1]))
    },
    cancel,
  })
  const response = streamProviderArtwork(source, controller.signal).getReader()
  expect((await response.read()).value).toEqual(new Uint8Array([1]))
  controller.abort(new Error("expired"))
  await expect(response.read()).rejects.toThrow("expired")
  expect(cancel).toHaveBeenCalledTimes(1)
})
