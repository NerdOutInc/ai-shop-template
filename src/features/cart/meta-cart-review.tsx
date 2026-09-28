"use client"

import Image from "next/image"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"

import { trackStoreEvent } from "@/features/analytics/track-store-event"
import { metaPixel } from "@/features/analytics/meta-pixel"
import { canOptimizeProductImage } from "@/features/catalog/can-optimize-product-image"
import { calculateCartShipping } from "@/features/checkout/calculate-cart-shipping"
import { storeConfig } from "@/lib/store-config"
import { cartLimits } from "@/lib/cart-limits"

import { CartContent } from "./cart-content"
import type { CartItem } from "./cart-item"
import { useCart } from "./use-cart"

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

export function MetaCartReview({ items, importKey }: { items: CartItem[]; importKey: string }) {
  const cart = useCart()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [completion, setCompletion] = useState<"added" | "already-added" | null>(null)
  const completionRef = useRef<HTMLParagraphElement>(null)
  const imported = cart.importedCarts.includes(importKey)
  const [wasImported, setWasImported] = useState(imported)
  if (wasImported !== imported) {
    setWasImported(imported)
    // An old action's feedback no longer applies once that selection leaves the cart.
    if (!imported) setCompletion(null)
  }
  const subtotal = items.reduce((sum, item) => sum + item.unitAmount * item.quantity, 0)
  const shipping = calculateCartShipping(items)
  const shippingReady =
    storeConfig.configured && storeConfig.policies.published && storeConfig.commerce.shippingConfirmed

  useEffect(() => {
    // Move with the customer's action, without stealing focus on reload or another tab's update.
    if (completion) completionRef.current?.focus()
  }, [completion])

  async function addSelection() {
    if (pending) return
    setPending(true)
    setError(null)
    setCompletion(null)
    try {
      const result = await cart.importCart(items, importKey)
      if (result === "limit") {
        setError(
          `Your cart has room for ${cartLimits.maxTotalQuantity} shirts, with up to ${cartLimits.maxQuantityPerVariant} of each size and color. Edit your existing cart, then try adding this selection again. Nothing was added.`
        )
      } else if (result === "invalid") {
        setError("We couldn’t add this selection. Please return to the shop and choose your shirts again.")
      } else if (result === "added") {
        setCompletion("added")
        for (const productId of new Set(items.map((item) => item.productId)))
          trackStoreEvent({ name: "add_to_cart", productId })
        metaPixel.track({ name: "AddToCart", items })
      } else if (result === "already-added") {
        setCompletion("already-added")
      }
    } catch {
      setError("We couldn’t update your cart. Please try again.")
    } finally {
      setPending(false)
    }
  }

  if (!cart.hydrated) return <p role="status">Loading your cart…</p>
  if (imported)
    return (
      <>
        <p
          ref={completionRef}
          tabIndex={-1}
          role="status"
          className="mb-8 rounded-xl border border-foreground/15 bg-background p-4 text-sm leading-6"
        >
          {completion === "already-added"
            ? "This selection is already in your cart. Nothing was added again."
            : "This selection has been added to your cart. Returning to this link won’t add it again."}{" "}
          Review your quantities below before checkout.
        </p>
        <CartContent />
      </>
    )

  return (
    <div className="grid items-start gap-10 lg:grid-cols-[1.08fr_1fr] lg:gap-16">
      <section aria-labelledby="meta-selection-heading">
        <h2 id="meta-selection-heading" className="mb-5 text-sm font-bold tracking-[0.12em] uppercase">
          Your Facebook or Instagram selection
        </h2>
        <ul className="divide-y divide-foreground/15 border-y border-foreground/15">
          {items.map((item) => (
            <li key={`${item.productId}:${item.variantId}`} className="flex gap-4 py-6 sm:gap-6">
              {item.image ? (
                <Image
                  src={item.image}
                  alt=""
                  width={240}
                  height={280}
                  sizes="96px"
                  unoptimized={!canOptimizeProductImage(item.image)}
                  className="h-auto w-24 shrink-0 self-start rounded-xl bg-white object-contain"
                />
              ) : null}
              <div className="min-w-0">
                <h3 className="text-lg font-bold">{item.title}</h3>
                <p className="mt-2 text-sm">Quantity: {item.quantity}</p>
                <p className="mt-2 text-sm font-semibold">{usd.format(item.unitAmount / 100)} each</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section
        aria-labelledby="meta-review-heading"
        className="rounded-2xl border border-foreground/15 bg-background p-5 sm:p-8"
      >
        <h2 id="meta-review-heading" className="display-heading text-3xl">
          Good picks. Let’s check the fit.
        </h2>
        <p className="mt-4 text-sm leading-6 text-foreground/75">
          Check the sizes, colors, and current prices. You can change quantities in your cart before secure checkout.
        </p>
        <dl className="mt-6 space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt>Selection subtotal</dt>
            <dd>{usd.format(subtotal / 100)}</dd>
          </div>
          {shippingReady && (
            <div className="flex justify-between gap-4">
              <dt>US shipping for this selection</dt>
              <dd>{usd.format(shipping / 100)}</dd>
            </div>
          )}
          {shippingReady && (
            <div className="flex justify-between gap-4 border-t border-foreground/15 pt-4 font-bold">
              <dt>Total before tax</dt>
              <dd>{usd.format((subtotal + shipping) / 100)}</dd>
            </div>
          )}
        </dl>
        {shippingReady ? (
          <p className="mt-4 text-xs leading-5 text-foreground/70">
            All prices in USD. Made to order. Shipping to the 50 US states and Washington, DC.
          </p>
        ) : (
          <p role="status" className="mt-4 text-sm leading-6 text-muted-foreground">
            The store is confirming shipping and policies before opening checkout. You can save this selection to your
            cart.
          </p>
        )}
        {cart.count > 0 ? (
          <p className="mt-5 text-sm leading-6">
            You already have {cart.count} {cart.count === 1 ? "shirt" : "shirts"} in your cart. We’ll keep those and add
            this selection. Your combined total will appear before checkout.
          </p>
        ) : null}
        {cart.persistenceWarning ? (
          <p role="status" className="mt-5 text-sm leading-6">
            Your browser isn’t saving your cart. Keep this tab open until you finish checkout.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-5 rounded-xl bg-destructive/12 p-4 text-sm leading-6 text-destructive">
            {error}
          </p>
        ) : null}
        {completion === "already-added" ? (
          <p ref={completionRef} tabIndex={-1} role="status" className="mt-5 text-sm leading-6">
            This selection is already in your cart. Nothing was added again. View your existing cart to review it.
          </p>
        ) : null}
        <button
          type="button"
          className="button button-accent mt-6 w-full disabled:cursor-wait disabled:opacity-60"
          disabled={pending}
          onClick={addSelection}
        >
          {pending ? "Adding selection…" : "Add selection to cart"}
        </button>
        <Link href="/cart" className="mt-4 inline-flex min-h-11 items-center text-sm underline underline-offset-4">
          View your existing cart
        </Link>
      </section>
    </div>
  )
}
