import "server-only"

export async function readBoundedArtworkStream(stream: ReadableStream<Uint8Array>, expectedBytes: number) {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > 64 * 1024 * 1024)
    throw new Error("Artwork exceeds the supported size")
  const chunks: Uint8Array[] = []
  const reader = stream.getReader()
  let total = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      total += chunk.value.byteLength
      if (total > expectedBytes) throw new Error("Artwork byte count exceeds its registered size")
      chunks.push(chunk.value)
    }
    if (total !== expectedBytes) throw new Error("Artwork upload is incomplete")
    return Buffer.concat(chunks, total)
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }
}
