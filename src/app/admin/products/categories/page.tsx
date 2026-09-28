import type { Metadata } from "next"

import { ProductsSectionNav } from "@/app/admin/products/_components/products-section-nav"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { requireAdmin } from "@/features/admin/require-admin.server"
import { CategoryManager } from "@/features/garment-catalog/category-manager"
import { listAdminGarmentSetup } from "@/features/garment-catalog/list-admin-garment-setup.server"

export const metadata: Metadata = { title: "Categories", robots: { index: false, follow: false } }
export const dynamic = "force-dynamic"

export default async function AdminProductCategoriesPage() {
  // First, before any read: the proxy only refreshes the session, so this call is the page's lock.
  await requireAdmin()
  const setup = await listAdminGarmentSetup()

  return (
    <main id="main-content" tabIndex={-1} className="page-width flex flex-col gap-8 py-10 sm:py-14">
      <header className="max-w-2xl">
        <p className="font-condensed mb-3 text-sm font-semibold tracking-widest text-muted-foreground uppercase">
          Products
        </p>
        <h1 className="display-heading">Categories</h1>
        <p className="mt-4 text-muted-foreground">
          The racks the shop hangs its garments on. Name them, put them in order, and give every garment model one. A
          tee never picks its own rack: it goes wherever its garment does.
        </p>
      </header>
      <ProductsSectionNav current="categories" />
      {setup.status === "unavailable" ? (
        <Alert variant="destructive">
          <AlertDescription>
            Categories are unavailable right now. Check that the latest migration has been pushed.
          </AlertDescription>
        </Alert>
      ) : (
        // The manager keeps its own copy so nothing re-renders under the owner mid-edit. "Reload
        // categories" is the one refresh it asks for, and it must start over from the server's list.
        <CategoryManager
          key={setup.categories
            .map((category) => `${category.slug}:${category.name}:${category.garmentCount}`)
            .join("\n")}
          categories={setup.categories}
        />
      )}
    </main>
  )
}
