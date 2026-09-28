import { JsonLdScript } from "@/components/json-ld-script"
import { createMerchantReturnPolicy } from "@/features/store-policies/create-merchant-return-policy"
import { storeConfig } from "@/lib/store-config"
import { getSiteUrl } from "@/lib/get-site-url"

export function ReturnPolicyStructuredData() {
  if (!storeConfig.configured || !storeConfig.policies.published) return null
  const siteUrl = getSiteUrl()
  const data = {
    "@context": "https://schema.org",
    "@type": "OnlineStore",
    "@id": new URL("/#store", siteUrl).href,
    name: storeConfig.name,
    url: siteUrl.href,
    hasMerchantReturnPolicy: createMerchantReturnPolicy(siteUrl),
  }
  return <JsonLdScript data={data} />
}
