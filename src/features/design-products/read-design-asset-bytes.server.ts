import "server-only"

/** The listener cancels a pending read as well as reads between chunks. */
export async function readDesignAssetBytes(stream: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted()
  const reader = stream.getReader(),
    chunks: Uint8Array[] = []
  const cancel = () => {
    void reader.cancel().catch(() => {})
  }
  signal.addEventListener("abort", cancel, { once: true })
  let size = 0
  try {
    while (true) {
      const part = await reader.read()
      signal.throwIfAborted()
      if (part.done) break
      size += part.value.length
      if (size > 64 * 1024 * 1024) throw new Error("Artwork exceeds the 64 MiB inspection limit")
      chunks.push(part.value)
    }
    return Buffer.concat(chunks)
  } finally {
    signal.removeEventListener("abort", cancel)
    cancel()
  }
}
