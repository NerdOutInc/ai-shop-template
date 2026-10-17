import "server-only"

import type { Pool } from "pg"

export type GoogleCopyProvenance = "generated" | "unknown" | "incomplete"

export async function readGoogleCopyProvenance(
  client: Pick<Pool, "query">,
  shopId: string,
  productId: string,
  currentRevision: string
): Promise<GoogleCopyProvenance> {
  // A null snapshot ends the lifecycle. Clear keeps its origin history intact.
  const { rows } = await client.query<{ generated: boolean }>(
    `select exists (
       select 1 from commerce.printify_product_revisions
       where shop_id=$1 and product_id=$2 and revision<=$3
         and revision>coalesce((
           select max(revision) from commerce.printify_product_revisions
           where shop_id=$1 and product_id=$2 and revision<=$3 and snapshot is null
         ),0)
         and snapshot #>> '{google_merchant_copy,origin}'='generated'
     ) as generated`,
    [shopId, productId, currentRevision]
  )
  // Missing or unexpected results cannot authorize a human-origin label.
  const generated = rows[0]?.generated
  return generated === true ? "generated" : generated === false ? "unknown" : "incomplete"
}
