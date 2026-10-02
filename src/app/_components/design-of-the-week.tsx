import Link from "next/link"
import { connection } from "next/server"

import { storeConfig } from "@/lib/store-config"

import { getCatalog } from "@/features/catalog/get-catalog.server"
import { readProductWeek } from "@/features/design-of-the-week/read-product-week.server"
import { readSignupConfirmationSetup } from "@/features/drop-signup/read-signup-confirmation-setup.server"
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
  const signupSelected = storeConfig.features.dropSignup && storeConfig.configured && storeConfig.policies.published
  const signupEnabled = signupSelected && readSignupConfirmationSetup().sending

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
          {signupSelected && !signupEnabled && (
            <p className="mt-8 text-sm text-muted-foreground">
              New design email signups are paused right now. Check back soon.
            </p>
          )}
          {signupEnabled && (
            <div className="mt-12">
              <DropSignupForm ready={readSignupConfirmationSetup().sending} source="design-of-the-week" />
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

          {signupSelected && !signupEnabled && (
            <p className="mt-8 text-sm text-muted-foreground">
              New design email signups are paused right now. Check back soon.
            </p>
          )}
          {signupEnabled && (
            <section aria-labelledby="drop-signup-heading" className="mt-14 sm:mt-20">
              <h3 id="drop-signup-heading" className="sr-only">
                Get told about the next drop
              </h3>
              <DropSignupForm ready={readSignupConfirmationSetup().sending} source="design-of-the-week" />
            </section>
          )}
        </>
      )}
    </>
  )
}
