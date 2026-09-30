import { render } from "react-email"

import { storeTimeZone } from "@/lib/store-time-zone"

import { DropEmail } from "./drop-email"
import type { DropEmailProduct } from "./drop-email-product"
import { formatDropEmailSubject } from "./format-drop-email-subject"
import { listDropDesignNames } from "./list-drop-design-names"

/** The subject, HTML and plain-text body of one drop's email, from one render of the same element. */
export async function renderDropEmail({
  liveAt,
  products,
  siteUrl,
  postalAddress,
  unsubscribeUrl,
}: {
  liveAt: string
  products: DropEmailProduct[]
  siteUrl: string
  postalAddress: string
  unsubscribeUrl: string
}) {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: storeTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(liveAt))
  const designNames = listDropDesignNames(products.map((product) => product.title))
  const email = (
    <DropEmail
      products={products}
      designNames={designNames}
      siteUrl={siteUrl}
      unsubscribeUrl={unsubscribeUrl}
      postalAddress={postalAddress}
      campaign={`dotw-${day}`}
    />
  )
  const [html, text] = await Promise.all([render(email), render(email, { plainText: true })])
  return { subject: formatDropEmailSubject(designNames), html, text }
}
