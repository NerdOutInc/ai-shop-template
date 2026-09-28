import type { Metadata } from "next"

import { AdminOrders } from "@/features/orders/admin-orders"
import { listAdminOrders } from "@/features/orders/list-admin-orders.server"
import { parseAdminOrderFilters } from "@/features/orders/parse-admin-order-filters"

export const metadata: Metadata = { title: "Orders", robots: { index: false, follow: false } }
export const dynamic = "force-dynamic"

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const filters = parseAdminOrderFilters(await searchParams)
  const result = await listAdminOrders(filters)
  return (
    <main id="main-content" tabIndex={-1} className="page-width space-y-8 py-10 sm:py-14">
      <header className="max-w-2xl">
        <h1 className="display-heading">Orders</h1>
        <p className="mt-4 text-muted-foreground">
          See who ordered, where they found us, and whether their tees made it to Printify. Follow each order from hello
          to delivery.
        </p>
      </header>
      <AdminOrders filters={filters} result={result} />
    </main>
  )
}
