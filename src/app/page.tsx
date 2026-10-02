import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"

import { readSignupConfirmationSetup } from "@/features/drop-signup/read-signup-confirmation-setup.server"
import { DropSignupForm } from "@/features/drop-signup/drop-signup-form"
import { storeConfig } from "@/lib/store-config"

import { DesignOfTheWeek } from "./_components/design-of-the-week"
import { StoreStructuredData } from "./_components/store-structured-data"

export const metadata: Metadata = { alternates: { canonical: "/" } }

export default function HomePage() {
  return (
    <main id="main-content" tabIndex={-1}>
      <StoreStructuredData />
      <section className="home-intro">
        <div className="page-width">
          <p className="home-tagline">{storeConfig.tagline}</p>
          <h1 className="font-display">{storeConfig.home.headline}</h1>
          <p className="home-description">{storeConfig.home.introduction}</p>
          <Link href="/shop" className="button mt-7">
            {storeConfig.home.shopLabel}
          </Link>
        </div>
      </section>
      {storeConfig.features.designOfTheWeek && (
        <>
          {/* The footer link moves focus here so the next Tab starts inside. */}
          <section
            id="design-of-the-week"
            aria-labelledby="design-of-the-week-label"
            className="page-width scroll-mt-6 py-10 outline-none sm:py-14"
          >
            <p id="design-of-the-week-label" className="text-sm font-semibold">
              Design of the week
            </p>
            <Suspense
              fallback={
                <p role="status" className="mt-4">
                  Loading this week’s picks…
                </p>
              }
            >
              <DesignOfTheWeek />
            </Suspense>
          </section>
        </>
      )}
      {storeConfig.features.dropSignup &&
        !storeConfig.features.designOfTheWeek &&
        storeConfig.configured &&
        storeConfig.policies.published &&
        readSignupConfirmationSetup().sending && (
          <section aria-label="New design updates" className="page-width py-10 sm:py-14">
            <DropSignupForm ready={readSignupConfirmationSetup().sending} source="home" />
          </section>
        )}
    </main>
  )
}
