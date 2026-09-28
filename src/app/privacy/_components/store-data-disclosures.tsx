export function StoreDataDisclosures() {
  return (
    <>
      <h2>Orders and support</h2>
      <p>
        When you check out, Stripe collects payment and contact information. The store receives and stores order
        details, payment references and status, customer name and email when available, and delivery details including
        the recipient’s name, address, email, and phone number. For orders sent to production, the items and delivery
        details go to Printify for printing and shipping. The store does not receive your full card number. Information
        you send to support is used to handle your request.
      </p>
      <h2>Browser storage and checkout recovery</h2>
      <p>
        This site uses browser local storage for your cart and checkout progress. Checkout recovery uses cookies that
        browser scripts cannot read: a payment-return reference lasts up to 30 days, and a saved shopping selection
        lasts up to 24 hours. Older recovery entries can be removed sooner as new entries are saved. Clearing browser
        data can remove your cart and the ability to reopen a checkout result.
      </p>
      <h2>Store measurement and order sources</h2>
      <p>
        When the store is configured, its policies are published, and shipping is confirmed, storefront measurement uses
        Vercel Web Analytics for page views and shopping events, including product identifiers, broad visit source, and
        checkout or purchase amounts. The integration removes checkout-session references, shopping-selection
        parameters, and signup email fields from the page URLs it sends. Private admin pages are excluded. A broad visit
        source is used for up to 24 hours in this browser tab. Up to 100 purchase-attempt markers in local storage are
        treated as current for 90 days to limit duplicate measurement.
      </p>
      <p>
        Separately, the store can use the first eligible visit in this tab for up to 24 hours and save it with an order:
        channel, source, referring hostname, bounded campaign labels, public landing pathname, capture time, and how the
        source was identified. This order-source record does not include full referring URLs, raw advertising click
        identifiers, or arbitrary query strings, and is not sent to Stripe, Printify, Google, or Meta by this
        integration.
      </p>
      <p>
        Order-source capture runs independently of optional Google and Meta marketing cookies. Global Privacy Control or
        a current denial of either marketing choice stops further order-source capture and clears its tab record. It
        does not rewrite an order already saved. These choices do not switch off the separate Vercel measurement
        described above. When optional marketing is configured, the Privacy choices control lets you review those
        settings; each saved choice is honored for 180 days. These browser-storage time limits control when records are
        used, not automatic deletion. Records can remain until replaced or cleared; tab storage also ends when the
        browser discards the tab’s session.
      </p>
    </>
  )
}
