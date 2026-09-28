import "server-only"
import type { Pool } from "pg"
import { getAdminDatabase } from "@/features/admin/get-admin-database.server"

/** Provider acknowledgement alone is insufficient if a newer active snapshot won the race. */
export async function markDesignProductRemoved(
  input: { shopId: string; productId: string },
  database?: Pool
): Promise<boolean> {
  const result = await (database ?? getAdminDatabase()).query(
    `update public.library_product_bindings b set status='removed',storefront_url=null,verified_at=now()
 where b.shop_id=$1 and b.product_id=$2 and exists(select 1 from commerce.printify_products p where p.shop_id=$1 and p.product_id=$2 and not p.active) returning b.id`,
    [input.shopId, input.productId]
  )
  return result.rows.length > 0
}
