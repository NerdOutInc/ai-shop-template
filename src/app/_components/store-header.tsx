"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { useCart } from "@/features/cart/use-cart"
import { storeConfig } from "@/lib/store-config"
import { cn } from "@/lib/cn"

import { BrandLogo } from "./brand-logo"

export function StoreHeader() {
  const pathname = usePathname()
  const adminPage = pathname === "/admin" || pathname.startsWith("/admin/")
  const adminEntryPage = pathname === "/admin/setup" || pathname === "/admin/sign-in"
  const { count } = useCart()
  return (
    <header className="store-header">
      <div className="page-width header-inner">
        <Link href="/" aria-label={`${storeConfig.name} home`} className="brand-link">
          <BrandLogo />
        </Link>
        <nav aria-label="Primary navigation" className={cn("store-nav font-condensed", adminPage && "flex-wrap")}>
          {adminPage && !adminEntryPage && (
            <>
              <Link href="/admin/concepts" aria-current={pathname.startsWith("/admin/concepts") ? "page" : undefined}>
                Designs
              </Link>
              <Link href="/admin/products" aria-current={pathname.startsWith("/admin/products") ? "page" : undefined}>
                Products
              </Link>
              <Link href="/admin/orders" aria-current={pathname.startsWith("/admin/orders") ? "page" : undefined}>
                Orders
              </Link>
              <Link href="/admin/account" aria-current={pathname.startsWith("/admin/account") ? "page" : undefined}>
                Account
              </Link>
            </>
          )}
          {/* Signed-in studio pages reach the store through the logo. */}
          {(!adminPage || adminEntryPage) && (
            <>
              <Link href="/about" aria-current={pathname === "/about" ? "page" : undefined}>
                About
              </Link>
              <Link href="/shop" aria-current={pathname.startsWith("/shop") ? "page" : undefined}>
                Shop
              </Link>
            </>
          )}
          {!adminPage && (
            <Link
              href="/cart"
              aria-current={pathname === "/cart" ? "page" : undefined}
              className="cart-link"
              aria-label={`Cart, ${count} ${count === 1 ? "item" : "items"}`}
            >
              <span className="cart-word">Cart</span>
              <svg
                width="27"
                height="27"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M2 3h2l2.5 12h12L21 6H5" />
                <path d="M7 18h11" />
                <circle cx="8" cy="21" r="1" />
                <circle cx="18" cy="21" r="1" />
              </svg>
              {count > 0 && <span className="cart-count">{count}</span>}
            </Link>
          )}
        </nav>
      </div>
    </header>
  )
}
