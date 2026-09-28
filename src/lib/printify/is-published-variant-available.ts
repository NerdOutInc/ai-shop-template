import "server-only"

type PublishedVariant = { enabled: boolean; unitAmount: number; fingerprint?: string }
type CurrentVariant = { enabled: boolean; inStock: boolean; fingerprint: string }

export function isPublishedVariantAvailable(published: PublishedVariant, current: CurrentVariant | undefined): boolean {
  return (
    published.enabled &&
    published.unitAmount > 0 &&
    current?.enabled === true &&
    current.inStock &&
    current.fingerprint === published.fingerprint
  )
}
