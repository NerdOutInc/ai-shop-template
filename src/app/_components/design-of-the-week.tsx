import Link from "next/link"
import { connection } from "next/server"

import { storeConfig } from "@/lib/store-config"

import { getCatalog } from "@/features/catalog/get-catalog.server"
import { pickMoreLikeThis } from "@/features/design-of-the-week/pick-more-like-this"
import { readProductWeek } from "@/features/design-of-the-week/read-product-week.server"
import { DropSignupForm } from "@/features/drop-signup/drop-signup-form"

import { DropProductGrid } from "./drop-product-grid"

export async function DesignOfTheWeek() {
  if (!storeConfig.features.designOfTheWeek) return null
  // Share one live-clock reading so the section and catalog agree when a new week begins.
  await connection()
  const reading = readProductWeek()
  const [drop, catalog] = await Promise.all([reading, getCatalog({ productWeek: reading })])
  const dropIds = new Set(catalog.designOfTheWeekProductIds ?? [])
  const roster = catalog.products.filter((product) => dropIds.has(product.id))
  // The pick holds all week, so a sold-out tee would hold its slot all week too.
  const pool = catalog.products.filter((product) => !dropIds.has(product.id) && product.availability === "available")
  const signupEnabled = storeConfig.features.dropSignup && storeConfig.configured && storeConfig.policies.published
  const more = drop === null ? [] : pickMoreLikeThis(drop.liveAt, pool, 4)

  return (
    <>
      {drop === null || roster.length === 0 ? (
        <section className="max-w-2xl">
          <h2 className="display-heading mt-3">New designs are on their way.</h2>
          <p className="mt-4 leading-relaxed text-muted-foreground">
            Check the shop for our current collection, or come back soon for new designs.
          </p>
          <Link href="/shop" className="button mt-7">
            {storeConfig.home.shopLabel}
          </Link>
          {signupEnabled && (
            <div className="mt-12">
              <DropSignupForm source="design-of-the-week" />
            </div>
          )}
        </section>
      ) : (
        <>
          <h2 className="display-heading mt-3 max-w-3xl">This week’s picks.</h2>
          <p className="mt-4 max-w-2xl leading-relaxed text-muted-foreground">
            Discover the latest selection and find a new favorite.
          </p>

          <section aria-labelledby="drop-products-heading" className="mt-8 sm:mt-10">
            <h3 id="drop-products-heading" className="sr-only">
              This week&rsquo;s products
            </h3>
            <DropProductGrid
              products={roster}
              label="Design of the Week products"
              newProductIds={catalog.newProductIds}
            />
          </section>

          {more.length > 0 && (
            <section aria-labelledby="more-like-this-heading" className="mt-14 sm:mt-20">
              <h3 id="more-like-this-heading" className="font-display text-3xl">
                More like this
              </h3>
              <div className="mt-6">
                <DropProductGrid products={more} label="More like this" newProductIds={catalog.newProductIds} />
              </div>
            </section>
          )}

          {signupEnabled && (
            <section aria-labelledby="drop-signup-heading" className="mt-14 sm:mt-20">
              <h3 id="drop-signup-heading" className="sr-only">
                Get told about the next drop
              </h3>
              <DropSignupForm source="design-of-the-week" />
            </section>
          )}

          <div className="section-divider mt-14" aria-hidden="true">
            <span>∞</span>
          </div>
          <div className="text-center">
            <Link href="/shop" className="button">
              {storeConfig.home.shopLabel}
            </Link>
          </div>
        </>
      )}
    </>
  )
}
