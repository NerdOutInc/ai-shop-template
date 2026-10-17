import type { Metadata } from "next"
import { Suspense } from "react"
import { storeConfig } from "@/lib/store-config"
import { DesignOfTheWeek } from "./_components/design-of-the-week"
import { StoreStructuredData } from "./_components/store-structured-data"
import { HomeIntro } from "./_components/home-intro"
import { HomeHero } from "./_components/home-hero"
import { HomeSignup } from "./_components/home-signup"

export const metadata: Metadata = { alternates: { canonical: "/" } }

export default function HomePage() {
  return (
    <main id="main-content" tabIndex={-1}>
      <StoreStructuredData />
      {storeConfig.features.designOfTheWeek ? (
        <Suspense fallback={<HomeIntro />}>
          <HomeHero />
        </Suspense>
      ) : (
        <HomeIntro />
      )}
      {storeConfig.features.designOfTheWeek && (
        // The complete weekly lineup stays visible even when only some products are pictured above.
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
      )}
      {storeConfig.features.dropSignup &&
        !storeConfig.features.designOfTheWeek &&
        storeConfig.configured &&
        storeConfig.policies.published && (
          <Suspense fallback={null}>
            <HomeSignup />
          </Suspense>
        )}
    </main>
  )
}
