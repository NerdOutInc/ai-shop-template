import "server-only"

/** Bound external work even when a test adapter or stalled stream ignores its AbortSignal. */
export async function withinDesignDeadline<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  signal.throwIfAborted()
  let abort: () => void = () => {}
  const stopped = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
  })
  try {
    return await Promise.race([work(), stopped])
  } finally {
    signal.removeEventListener("abort", abort)
  }
}
