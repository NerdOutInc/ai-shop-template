import Link from "next/link"

import { storeConfig } from "@/lib/store-config"

import { PrivacyChoices } from "@/features/analytics/privacy-choices"

import { DesignOfTheWeekLink } from "./design-of-the-week-link"

export function StoreFooter() {
  return (
    <footer className="store-footer">
      <div className="page-width footer-inner">
        <p className="font-display text-xl">{storeConfig.tagline}</p>
        <nav aria-label="Footer navigation" className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          {storeConfig.features.about && (
            <Link href="/about" className="inline-flex min-h-11 items-center">
              About
            </Link>
          )}
          <Link href="/shop" className="inline-flex min-h-11 items-center">
            {storeConfig.home.shopLabel}
          </Link>
          {storeConfig.features.designOfTheWeek && <DesignOfTheWeekLink />}
          <Link href="/shipping" className="inline-flex min-h-11 items-center">
            Shipping & care
          </Link>
          <Link href="/returns" className="inline-flex min-h-11 items-center">
            Returns & order help
          </Link>
          <Link href="/privacy" className="inline-flex min-h-11 items-center">
            Privacy
          </Link>
          <PrivacyChoices />
        </nav>
        {storeConfig.socialLinks.length > 0 && (
          <nav aria-label="Social links" className="flex flex-wrap gap-6">
            {storeConfig.socialLinks.map(({ label, url }) => (
              <a key={url} href={url} rel="me noopener noreferrer" className="inline-flex min-h-11 items-center">
                {label}
              </a>
            ))}
          </nav>
        )}
        <p className="footer-copyright">
          © {new Date().getFullYear()} {storeConfig.name}
        </p>
      </div>
    </footer>
  )
}
