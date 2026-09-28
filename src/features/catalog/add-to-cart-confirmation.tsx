"use client"

import { Dialog } from "@base-ui/react/dialog"
import Image from "next/image"
import Link from "next/link"
import { type RefObject, useRef } from "react"

import type { CartItem } from "@/features/cart/cart-item"
import { useCart } from "@/features/cart/use-cart"

import { canOptimizeProductImage } from "./can-optimize-product-image"

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

export function AddToCartConfirmation({
  item,
  open,
  onOpenChange,
  returnFocus,
}: {
  item: CartItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  returnFocus: RefObject<HTMLButtonElement | null>
}) {
  const { count, persistenceWarning } = useCart()
  const cartLink = useRef<HTMLAnchorElement>(null)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="cart-confirmation-backdrop" />
        <Dialog.Popup className="cart-confirmation" initialFocus={cartLink} finalFocus={returnFocus}>
          <div className="cart-confirmation-heading">
            <span className="cart-confirmation-check" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="m5 12 4 4L19 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <Dialog.Title className="font-condensed">Added to cart</Dialog.Title>
            <Dialog.Close className="cart-confirmation-close" aria-label="Close cart confirmation">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="m6 6 12 12M6 18 18 6" strokeLinecap="round" />
              </svg>
            </Dialog.Close>
          </div>
          {item && (
            <>
              <Dialog.Description className="sr-only">
                {item.title}, {item.variantTitle}. Quantity: {item.quantity}.
              </Dialog.Description>
              <div className="cart-confirmation-item">
                {item.image ? (
                  <Image
                    src={item.image}
                    alt=""
                    width={104}
                    height={104}
                    sizes="104px"
                    unoptimized={!canOptimizeProductImage(item.image)}
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="cart-confirmation-product">{item.title}</p>
                  <p className="text-sm text-muted-foreground">{item.variantTitle}</p>
                  <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm text-muted-foreground">Quantity: {item.quantity}</p>
                    <p className="font-semibold">{usd.format((item.unitAmount * item.quantity) / 100)}</p>
                  </div>
                </div>
              </div>
            </>
          )}
          {persistenceWarning && (
            <p className="mb-4 text-sm">
              Your cart is available for this visit, but this browser couldn’t save it for later.
            </p>
          )}
          <Link ref={cartLink} className="button button-accent w-full" href="/cart" onClick={() => onOpenChange(false)}>
            View cart ({count})
          </Link>
          <Dialog.Close className="cart-confirmation-continue">Continue shopping</Dialog.Close>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
