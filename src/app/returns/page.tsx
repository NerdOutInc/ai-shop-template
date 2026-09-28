import type { Metadata } from "next"

import { storeConfig } from "@/lib/store-config"

import { StorePolicyContent } from "@/app/_components/store-policy-content"
import { ReturnPolicyStructuredData } from "./_components/return-policy-structured-data"

export const metadata: Metadata = {
  title: "Returns & order help",
  description: `Returns & order help for ${storeConfig.name}.`,
  alternates: { canonical: "/returns" },
}

export default function ReturnsPage() {
  return (
    <main id="main-content" tabIndex={-1} className="page-width prose-page">
      <ReturnPolicyStructuredData />
      <h1 className="display-heading">Returns & order help</h1>
      <StorePolicyContent paragraphs={storeConfig.policies.returnsText} />
    </main>
  )
}
