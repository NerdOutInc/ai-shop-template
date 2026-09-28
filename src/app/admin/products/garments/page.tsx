import type { Metadata } from "next"

import { ProductsSectionNav } from "@/app/admin/products/_components/products-section-nav"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { requireAdmin } from "@/features/admin/require-admin.server"
import { AddGarmentForm } from "@/features/garment-catalog/add-garment-form"
import { GarmentModelList } from "@/features/garment-catalog/garment-model-list"
import { listAdminGarmentSetup } from "@/features/garment-catalog/list-admin-garment-setup.server"

export const metadata: Metadata = { title: "Garment models", robots: { index: false, follow: false } }
export const dynamic = "force-dynamic"

export default async function AdminGarmentModelsPage() {
  // First, before any read: the proxy only refreshes the session, so this call is the page's lock.
  await requireAdmin()
  const setup = await listAdminGarmentSetup()

  return (
    <main id="main-content" tabIndex={-1} className="page-width flex flex-col gap-8 py-10 sm:py-14">
      <header className="max-w-2xl">
        <p className="font-condensed mb-3 text-sm font-semibold tracking-widest text-muted-foreground uppercase">
          Products
        </p>
        <h1 className="display-heading">Garment models</h1>
        <p className="mt-4 text-muted-foreground">
          Set up each Printify garment once and every product printed on it follows along. A product can be shown or
          scheduled only when its garment has a name, a category and its apparel details. Measure once, hang many.
        </p>
      </header>
      <ProductsSectionNav current="garments" />
      {setup.status === "unavailable" ? (
        <Alert variant="destructive">
          <AlertDescription>
            Garment models are unavailable right now. Check that the latest migration has been pushed.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <GarmentModelList
            categories={setup.categories}
            garments={setup.garments}
            productsWithoutBlueprint={setup.productsWithoutBlueprint}
          />
          <AddGarmentForm
            categories={setup.categories}
            listedBlueprintIds={setup.garments.map((garment) => garment.blueprintId)}
          />
        </>
      )}
    </main>
  )
}
