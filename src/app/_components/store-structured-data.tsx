import { JsonLdScript } from "@/components/json-ld-script"
import { getSiteUrl } from "@/lib/get-site-url"
import { storeConfig } from "@/lib/store-config"

export function StoreStructuredData() {
  if (!storeConfig.configured) return null
  const siteUrl = getSiteUrl()
  const data = {
    "@context": "https://schema.org",
    "@type": "OnlineStore",
    "@id": new URL("/#store", siteUrl).href,
    name: storeConfig.name,
    url: siteUrl.href,
    logo: new URL(storeConfig.logo.src, siteUrl).href,
    email: storeConfig.supportEmail,
    contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: storeConfig.supportEmail },
    sameAs: storeConfig.socialLinks.map(({ url }) => url),
  }
  return <JsonLdScript data={data} />
}
