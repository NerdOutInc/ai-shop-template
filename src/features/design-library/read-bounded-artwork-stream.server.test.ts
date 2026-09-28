// @vitest-environment node
import { expect, it, vi } from "vitest"

import { readBoundedArtworkStream } from "./read-bounded-artwork-stream.server"

vi.mock("server-only", () => ({}))

function stream(chunks: number[][]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk))
      controller.close()
    },
  })
}

it("accepts the exact byte count and rejects oversized or truncated content", async () => {
  expect(await readBoundedArtworkStream(stream([[1, 2], [3]]), 3)).toEqual(Buffer.from([1, 2, 3]))
  await expect(readBoundedArtworkStream(stream([[1, 2, 3, 4]]), 3)).rejects.toThrow("exceeds")
  await expect(readBoundedArtworkStream(stream([[1, 2]]), 3)).rejects.toThrow("incomplete")
  await expect(readBoundedArtworkStream(stream([]), 0)).rejects.toThrow("supported size")
})
