import type { Metadata, Viewport } from "next"
import type { CSSProperties } from "react"

import { CartProvider } from "@/features/cart/cart-provider"
import { GoogleTagProvider } from "@/features/analytics/google-tag-provider"
import { MetaPixelProvider } from "@/features/analytics/meta-pixel-provider"
import { env } from "@/lib/env"
import { getSiteUrl } from "@/lib/get-site-url"
import { isIndexableSite } from "@/lib/is-indexable-site"
import { storeConfig } from "@/lib/store-config"

import { StoreAnalytics } from "./_components/store-analytics"
import { StoreFooter } from "./_components/store-footer"
import { StoreHeader } from "./_components/store-header"

import "./globals.css"

const { name, description, theme } = storeConfig

export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  robots: isIndexableSite() ? undefined : { index: false, follow: false },
  title: { default: name, template: `%s | ${name}` },
  description,
  icons: {
    icon: [{ url: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title: name,
    description,
    siteName: name,
    type: "website",
    locale: storeConfig.locale.replace("-", "_"),
  },
  twitter: { card: "summary_large_image", title: name, description },
}

export const viewport: Viewport = { themeColor: theme.primary }

const brandStyle = {
  "--background": theme.background,
  "--popover": theme.background,
  "--popover-foreground": theme.foreground,
  "--foreground": theme.foreground,
  "--primary": theme.primary,
  "--primary-foreground": theme.primaryForeground,
  "--secondary": theme.secondary,
  "--secondary-foreground": theme.foreground,
  "--muted": theme.secondary,
  "--muted-foreground": theme.mutedForeground,
  "--accent": theme.accent,
  "--accent-foreground": theme.accentForeground,
  "--border": theme.border,
  "--input": theme.border,
  "--ring": theme.primary,
} as CSSProperties

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang={storeConfig.locale} style={brandStyle}>
      <body>
        <a
          className="fixed top-4 left-4 z-50 -translate-y-24 rounded-md bg-primary px-5 py-3 text-primary-foreground focus:translate-y-0"
          href="#main-content"
        >
          Skip to content
        </a>
        <CartProvider>
          <StoreHeader adminEnabled={env.ADMIN_LIBRARY_ENABLED} />
          {children}
          <StoreFooter />
        </CartProvider>
        <StoreAnalytics />
        {storeConfig.configured && storeConfig.policies.published && storeConfig.commerce.shippingConfirmed && (
          <>
            <MetaPixelProvider />
            <GoogleTagProvider />
          </>
        )}
      </body>
    </html>
  )
}
