import type { Metadata } from "next"

import { storeConfig } from "@/lib/store-config"

import { StorePolicyContent } from "@/app/_components/store-policy-content"

import { GooglePrivacySection } from "./_components/google-privacy-section"
import { MetaPrivacySection } from "./_components/meta-privacy-section"

export const metadata: Metadata = {
  title: "Privacy",
  description: `Privacy for ${storeConfig.name}.`,
  alternates: { canonical: "/privacy" },
}

export default function PrivacyPage() {
  return (
    <main id="main-content" tabIndex={-1} className="page-width prose-page">
      <h1 className="display-heading">Privacy</h1>
      <StorePolicyContent paragraphs={storeConfig.policies.privacyText} />
      <MetaPrivacySection />
      <GooglePrivacySection />
    </main>
  )
}
