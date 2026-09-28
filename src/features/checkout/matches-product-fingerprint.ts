export function matchesProductFingerprint(variant: { fingerprint: string }, stored: string) {
  return /^v2:[a-f0-9]{64}$/.test(stored) && variant.fingerprint === stored
}
