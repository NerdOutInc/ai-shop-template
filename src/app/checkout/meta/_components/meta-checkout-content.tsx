import Link from "next/link"

import { MetaCartReview } from "@/features/cart/meta-cart-review"
import type { MetaCartResult } from "@/features/cart/resolve-meta-cart.server"
import { storeConfig } from "@/lib/store-config"
import { cartLimits } from "@/lib/cart-limits"

export function MetaCheckoutContent({ result }: { result: MetaCartResult }) {
  return result.status === "ready" ? (
    <MetaCartReview key={result.importKey} items={result.items} importKey={result.importKey} />
  ) : (
    <section className="max-w-xl rounded-2xl border border-foreground/15 bg-background p-5 sm:p-8">
      <h2 className="display-heading text-3xl">Let’s get your selection sorted.</h2>
      <p role="alert" className="mt-5 leading-7">
        {result.reason === "coupon"
          ? `This link includes a coupon, but ${storeConfig.name} doesn’t currently support coupon codes. Nothing was added or charged. You can browse the shop at the listed prices, or contact ${storeConfig.supportEmail} for help with the offer.`
          : result.reason === "lookup"
            ? "We couldn’t check the selected shirts just now. Nothing was added. Please reload this page to try again, or browse the shop."
            : result.reason === "unavailable"
              ? result.unavailableItem
                ? `${result.unavailableItem.title}${result.unavailableItem.variantTitle ? ` (${result.unavailableItem.variantTitle})` : " in the selected size and color"} can’t be ordered from this link. Nothing was added. Choose an available option on the product page, then choose the other shirts in your selection again.`
                : "One or more selected shirts are no longer listed in the shop. Nothing was added. Please browse the current shirts and choose your selection again."
              : `This shopping link is incomplete or has invalid items or quantities. Nothing was added. Please choose your shirts again. Orders can include up to ${cartLimits.maxQuantityPerVariant} of each size and color, and ${cartLimits.maxTotalQuantity} shirts in total.`}
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-5">
        <Link href={result.unavailableItem?.href ?? "/shop"} className="button button-accent">
          {result.unavailableItem ? `Choose options for ${result.unavailableItem.title}` : "Browse the shirts"}
        </Link>
        <Link href="/cart" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">
          View your existing cart
        </Link>
      </div>
    </section>
  )
}
