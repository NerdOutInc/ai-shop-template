"use client"

import { useMetaPixel } from "@/features/analytics/use-meta-pixel"

export function MetaPrivacySection() {
  const { configured } = useMetaPixel()

  if (!configured) return null

  return (
    <>
      <h2>Optional Meta marketing cookies</h2>
      <p>
        If you allow Meta marketing cookies, we use the Meta Pixel to measure sales from Facebook and Instagram and help
        show relevant ads, including remarketing and ad optimization. Meta receives browser and device information, IP
        address, page location and referrer, advertising cookie identifiers, product views and selections, and confirmed
        purchase amounts in USD. Meta can associate this information with its services; it is not anonymous. See{" "}
        <a href="https://www.facebook.com/privacy/policy/" rel="noreferrer">
          Meta’s privacy policy
        </a>{" "}
        and{" "}
        <a href="https://www.facebook.com/privacy/policies/cookies/" rel="noreferrer">
          cookie policy
        </a>
        .
      </p>
      <p>
        Meta stays off until you choose Allow Meta marketing cookies. Declining does not affect shopping. We remember
        your choice in this browser for 180 days, then ask again. Use Privacy choices in the footer to change it at any
        time. We treat your browser’s Global Privacy Control signal as a denial. Withdrawing permission stops future
        Meta events, discards unsent events, and attempts to remove the Meta cookies set on this website. It does not
        erase information Meta has already received.
      </p>
      <p>
        Meta may set advertising cookies such as _fbp and _fbc under its cookie policy. We do not send your name, email,
        phone, delivery address, card details, or raw checkout references in Pixel event parameters, and automatic
        advanced matching is disabled. We keep a separate set of up to 100 local purchase-attempt markers for Meta for
        up to 90 days to limit duplicate events after a refresh. They are not sent to Meta. Clearing browser data or
        using another device can allow another event; blocking scripts or declining marketing can prevent measurement.
      </p>
    </>
  )
}
