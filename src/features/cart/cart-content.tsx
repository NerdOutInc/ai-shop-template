"use client"

import Image from "next/image"
import Link from "next/link"

import { canOptimizeProductImage } from "@/features/catalog/can-optimize-product-image"
import { cartLimits } from "@/lib/cart-limits"

import { CartCheckout } from "./cart-checkout"
import type { CartItem } from "./cart-item"
import { useCart } from "./use-cart"

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

function itemLabel({ title, variantTitle }: CartItem) {
  return title.endsWith(` – ${variantTitle}`) ? title : `${title}, ${variantTitle}`
}

export function CartContent({ cancelled = false }: { cancelled?: boolean }) {
  const { items, count, hydrated, persistenceWarning, setQuantity, removeItem } = useCart()
  if (!hydrated)
    return (
      <p role="status" className="py-16">
        Loading your cart…
      </p>
    )
  if (items.length === 0)
    return (
      <section className="mx-auto max-w-xl py-16 text-center sm:py-24">
        <Image
          src="/images/cart-hanger.svg"
          alt=""
          width={1031}
          height={728}
          unoptimized
          className="mx-auto h-auto w-40"
        />
        <h2 className="display-heading mt-7 text-4xl">Ready for your next favorite.</h2>
        <p className="mx-auto mt-5 max-w-sm leading-7 text-foreground/75">
          Your cart is empty. Explore the collection to find a shirt that suits you.
        </p>
        <Link href="/shop" className="button button-accent mt-8">
          Find your shirt
        </Link>
      </section>
    )
  return (
    <>
      {cancelled ? (
        <p role="status" className="mb-8 rounded-xl border border-foreground/15 bg-background p-4 text-sm leading-6">
          Back for another look? Your cart is still here. If a payment went through, check your Stripe receipt before
          trying again.
        </p>
      ) : null}
      {persistenceWarning ? (
        <p role="status" className="mb-8 rounded-xl border border-foreground/15 bg-background p-4 text-sm leading-6">
          Your browser isn’t saving your cart. It will stay here for this visit, but a reload may empty it.
        </p>
      ) : null}
      <div className="grid items-start gap-10 lg:grid-cols-[1.08fr_1fr] lg:gap-16">
        <section aria-labelledby="cart-items-heading">
          <h2 id="cart-items-heading" className="mb-5 text-sm font-bold tracking-[0.12em] uppercase">
            The good stuff ({count})
          </h2>
          <ul className="divide-y divide-foreground/15 border-y border-foreground/15">
            {items.map((item) => (
              <li key={`${item.productId}:${item.variantId}`} className="flex gap-4 py-6 sm:gap-6">
                <Link
                  href={`/shop/${item.productId}`}
                  aria-label={`View ${item.title}`}
                  className="block h-fit w-24 shrink-0 overflow-hidden rounded-xl bg-white sm:w-32"
                >
                  {item.image ? (
                    <Image
                      src={item.image}
                      alt=""
                      width={240}
                      height={280}
                      sizes="(min-width: 640px) 128px, 96px"
                      unoptimized={!canOptimizeProductImage(item.image)}
                      className="aspect-[6/7] h-auto w-full object-contain"
                    />
                  ) : (
                    <span className="flex aspect-[6/7] items-center justify-center p-3 text-center text-xs">
                      Made to order
                    </span>
                  )}
                </Link>
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg leading-6 font-bold">
                    <Link href={`/shop/${item.productId}`} className="hover:underline">
                      {item.title}
                    </Link>
                  </h3>
                  {itemLabel(item) !== item.title ? (
                    <p className="mt-2 text-sm leading-5 text-foreground/70">{item.variantTitle}</p>
                  ) : null}
                  <p className="mt-2 text-sm font-semibold">{usd.format(item.unitAmount / 100)} each</p>
                  <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
                    <div className="inline-flex items-center overflow-hidden rounded-full border border-foreground/30 bg-background">
                      <button
                        type="button"
                        aria-label={`Decrease quantity of ${itemLabel(item)}`}
                        disabled={item.quantity <= 1}
                        onClick={() => setQuantity(item.productId, item.variantId, item.quantity - 1)}
                        className="size-11 text-xl disabled:opacity-30"
                      >
                        −
                      </button>
                      <span aria-label={`Quantity: ${item.quantity}`} className="min-w-7 text-center text-sm font-bold">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        aria-label={`Increase quantity of ${itemLabel(item)}`}
                        disabled={
                          item.quantity >= cartLimits.maxQuantityPerVariant || count >= cartLimits.maxTotalQuantity
                        }
                        onClick={() => setQuantity(item.productId, item.variantId, item.quantity + 1)}
                        className="size-11 text-xl disabled:opacity-30"
                      >
                        +
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeItem(item.productId, item.variantId)}
                      aria-label={`Remove ${itemLabel(item)}`}
                      className="min-h-11 text-sm underline underline-offset-4"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-xs leading-5 text-foreground/70">
            Up to {cartLimits.maxQuantityPerVariant} of each size/color and {cartLimits.maxTotalQuantity} items per
            order.
          </p>
          <Link
            href="/shop"
            className="mt-6 inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4"
          >
            Keep shopping
          </Link>
        </section>
        <CartCheckout />
      </div>
    </>
  )
}
