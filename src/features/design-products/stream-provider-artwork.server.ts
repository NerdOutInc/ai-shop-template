import "server-only"

/** Expiry or disconnect closes a provider download even after the response has started streaming. */
export function streamProviderArtwork(
  source: ReadableStream<Uint8Array>,
  signal: AbortSignal
): ReadableStream<Uint8Array> {
  const reader = source.getReader()
  let stopped = false
  let listener: () => void = () => {}
  const clean = () => {
    stopped = true
    signal.removeEventListener("abort", listener)
  }
  return new ReadableStream<Uint8Array>({
    start(controller) {
      listener = () => {
        if (stopped) return
        clean()
        controller.error(signal.reason)
        void reader.cancel().catch(() => {})
      }
      signal.addEventListener("abort", listener, { once: true })
      if (signal.aborted) listener()
    },
    async pull(controller) {
      if (stopped) return
      try {
        const part = await reader.read()
        if (stopped) return
        if (part.done) {
          clean()
          controller.close()
        } else controller.enqueue(part.value)
      } catch (error) {
        if (!stopped) {
          clean()
          controller.error(error)
        }
      }
    },
    cancel() {
      clean()
      return reader.cancel()
    },
  })
}
