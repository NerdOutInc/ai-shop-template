import { JsonLdScript } from "@/components/json-ld-script"
import { createShippingService } from "@/features/store-policies/create-shipping-service"
import { storeConfig } from "@/lib/store-config"
import { getSiteUrl } from "@/lib/get-site-url"

export function ShippingStructuredData() {
  if (!storeConfig.configured || !storeConfig.policies.published) return null
  const siteUrl = getSiteUrl()
  const shippingService = createShippingService(siteUrl)
  if (!shippingService) return null
  const data = {
    "@context": "https://schema.org",
    "@type": "OnlineStore",
    "@id": new URL("/#store", siteUrl).href,
    name: storeConfig.name,
    url: siteUrl.href,
    hasShippingService: shippingService,
  }
  return <JsonLdScript data={data} />
}
