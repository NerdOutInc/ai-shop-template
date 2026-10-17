import "server-only"

import { getAdminDatabase } from "@/features/admin/get-admin-database.server"
import type { GarmentFeedProfile } from "@/features/garment-catalog/garment-feed-profile-schema"
import { getPublishingStore } from "@/features/publishing/get-publishing-store.server"
import { env } from "@/lib/env"

import { readGoogleCopyProvenance, type GoogleCopyProvenance } from "./read-google-copy-provenance.server"

export type GoogleCopyEditorRead = {
  shopId: string
  productId: string
  revision: string
  snapshot: Record<string, unknown> | null
  active: boolean
  blocked: boolean
  profiles: ReadonlyMap<number, GarmentFeedProfile>
  provenance: GoogleCopyProvenance
}

export async function readGoogleMerchantCopyEditor(productId: string): Promise<GoogleCopyEditorRead> {
  const shopId = env.PRINTIFY_SHOP_ID!
  const client = await getAdminDatabase().connect()
  try {
    await client.query("begin isolation level repeatable read read only")
    await client.query("set local statement_timeout='5s'")
    await client.query("set local idle_in_transaction_session_timeout='5s'")
    const row = (
      await client.query<{
        revision: string
        snapshot: Record<string, unknown> | null
        active: boolean
        blocked: boolean
      }>(
        `select p.revision,p.snapshot,p.active,exists(select 1 from commerce.printify_publish_jobs j
         where j.shop_id=p.shop_id and j.product_id=p.product_id and j.state in ('pending','callback')) as blocked
         from commerce.printify_products p where p.shop_id=$1 and p.product_id=$2 limit 1`,
        [shopId, productId]
      )
    ).rows[0]
    if (!row) throw new Error("GOOGLE_COPY_INVALID_TARGET")
    const profiles = await getPublishingStore().garments.listFeedProfiles(client)
    const provenance = await readGoogleCopyProvenance(client, shopId, productId, row.revision)
    await client.query("commit")
    return { shopId, productId, ...row, profiles, provenance }
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}
