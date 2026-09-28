import { storeConfig } from "@/lib/store-config"

export function StorePolicyContent({ paragraphs }: { paragraphs: string[] }) {
  if (!storeConfig.policies.published) {
    return (
      <p role="status">
        The store is preparing its policies before opening for orders. Please check back when the collection launches.
      </p>
    )
  }
  return (
    <>
      {paragraphs.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      {storeConfig.configured && (
        <p>
          Questions? Email <a href={`mailto:${storeConfig.supportEmail}`}>{storeConfig.supportEmail}</a>.
        </p>
      )}
    </>
  )
}
