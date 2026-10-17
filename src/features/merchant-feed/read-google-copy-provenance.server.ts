import "server-only"

import type { Pool } from "pg"

export type GoogleCopyProvenance = "generated" | "unknown" | "incomplete"

export async function readGoogleCopyProvenance(
  client: Pick<Pool, "query">,
  shopId: string,
  productId: string,
  currentRevision: string
): Promise<GoogleCopyProvenance> {
  const { rows } = await client.query<{ origin: string | null; boundary: boolean }>(
    `select snapshot #>> '{google_merchant_copy,origin}' as origin,snapshot is null as boundary
     from commerce.printify_product_revisions where shop_id=$1 and product_id=$2 and revision<=$3
     order by revision desc limit 101`,
    [shopId, productId, currentRevision]
  )
  for (const row of rows) {
    // Unpublish/delete starts a new snapshot lifecycle; a guarded clear does not.
    if (row.boundary) return "unknown"
    if (row.origin === "generated") return "generated"
  }
  // Refuse human relabeling when a bounded scan cannot establish complete provenance.
  return rows.length === 101 ? "incomplete" : "unknown"
}
