import "server-only"

import type { Pool } from "pg"

import { getAdminDatabase } from "@/features/admin/get-admin-database.server"

/** A stale callback cannot relabel the binding after a newer snapshot has become active. */
export async function markDesignProductPublished(
  input: {
    shopId: string
    productId: string
    revisionId: string
    productionFingerprint: string
    storefrontUrl: string
  },
  database?: Pool
): Promise<boolean> {
  const result = await (database ?? getAdminDatabase()).query(
    `update public.library_product_bindings b set status='published',revision_id=$3::uuid,storefront_url=$5,verified_at=now()
    where b.shop_id=$1 and b.product_id=$2
    and exists(select 1 from commerce.printify_products p where p.shop_id=$1 and p.product_id=$2 and p.active
      and p.snapshot->'storefront_artwork'->>'revisionId'=$3::text and p.snapshot->'storefront_artwork'->>'productionFingerprint'=$4)
    and exists(select 1 from commerce.design_product_artwork a where a.shop_id=$1 and a.product_id=$2 and a.revision_id=$3::uuid and a.production_fingerprint=$4)
    returning b.id`,
    [input.shopId, input.productId, input.revisionId, input.productionFingerprint, input.storefrontUrl]
  )
  return result.rows.length > 0
}
