import "server-only"
import type { Pool } from "pg"
import { getAdminDatabase } from "@/features/admin/get-admin-database.server"

/** An unknown newly published artwork must not inherit an older library revision's verified badge. */
export async function markDesignProductUnverified(
  input: { shopId: string; productId: string },
  database?: Pool
): Promise<boolean> {
  const result = await (database ?? getAdminDatabase()).query(
    `update public.library_product_bindings b set status='needs-reconciliation',storefront_url=null,verified_at=null
 where b.shop_id=$1 and b.product_id=$2 and exists(select 1 from commerce.printify_products p where p.shop_id=$1 and p.product_id=$2 and p.active
 and not exists(select 1 from commerce.design_product_artwork a where a.shop_id=p.shop_id and a.product_id=p.product_id and a.revision_id::text=p.snapshot->'storefront_artwork'->>'revisionId' and a.production_fingerprint=p.snapshot->'storefront_artwork'->>'productionFingerprint')) returning b.id`,
    [input.shopId, input.productId]
  )
  return result.rows.length > 0
}
