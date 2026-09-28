"use client"

import { useGoogleTag } from "@/features/analytics/use-google-tag"

export function GooglePrivacySection() {
  const { configured } = useGoogleTag()

  if (!configured) return null

  return (
    <>
      <h2>Optional Google marketing cookies</h2>
      <p>
        If you choose Allow Google marketing cookies, we allow Google advertising and analytics cookies and share
        browsing and purchase data with Google for ads and product-listing measurement in Merchant Center. Google
        receives browser and device information, IP address, cookie and listing-click identifiers, public page
        locations, purchased product identifiers and quantities, merchandise value, shipping, tax, currency, and a
        purchase identifier. This information is not anonymous. We do not send customer contact details, payment
        details, or raw checkout references in Google events. See{" "}
        <a href="https://policies.google.com/privacy" rel="noreferrer">
          Google’s privacy policy
        </a>{" "}
        and{" "}
        <a href="https://policies.google.com/technologies/cookies" rel="noreferrer">
          cookie policy
        </a>
        .
      </p>
      <p>
        Google has a separate choice from Meta and stays off until you allow it. Declining does not affect shopping. We
        remember your choice for 180 days and honor Global Privacy Control as a denial. Privacy choices in the footer
        lets you change your decision. Withdrawing permission stops our Google measurement events and attempts to remove
        Google marketing cookies set on this website. Google may receive the consent update; withdrawal does not erase
        information already received. Advertising personalization and enhanced conversion customer-data matching are not
        enabled by this integration.
      </p>
      <p>
        Google may set analytics cookies such as _ga and advertising cookies such as _gcl_. We send a Google-specific
        purchase identifier to limit duplicates, and retain up to 100 purchase-attempt markers in this browser for 90
        days. Clearing browser data, using another device, blocking scripts, declining cookies, or not returning from
        payment can affect measurement.
      </p>
    </>
  )
}
