export function readProviderDelay(defaultDelay = 0): number {
  const delay = Number(process.env.COMMERCE_PROVIDER_DELAY_MS ?? defaultDelay)
  if (!Number.isInteger(delay) || delay < 0 || delay > 2_000)
    throw new Error("Fixture provider delay must be between 0 and 2000 milliseconds")
  return delay
}
