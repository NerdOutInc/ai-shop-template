import "server-only"
import { createHash } from "node:crypto"
import type { Pool } from "pg"
import { getAdminDatabase } from "@/features/admin/get-admin-database.server"
import { mapPrivateArtworkAsset } from "./map-private-artwork-asset"
const query = `select a.*,c.user_id,c.grant_id,c.expires_at as capability_expires_at from private.design_provider_capabilities c
 join private.design_product_attempts o on o.binding_id=c.binding_id and o.asset_id=c.asset_id and o.stage='uploading' and o.uploaded_image_id is null
 join public.library_assets a on a.id=c.asset_id and a.revision_id=c.revision_id and a.sha256=c.asset_sha256 and a.kind='print' and a.status='ready'
 join public.admin_memberships m on m.user_id=c.user_id and m.active
 join private.auth_user_identity u on u.id=c.user_id and u.email_confirmed_at is not null
  and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now())
 where c.token_hash=$1 and c.revoked_at is null and c.expires_at>now()`
export async function readProviderArtworkCapability(
  token: string,
  options: {
    database?: Pool
    /** Runs only for a capability an agent grant issued; an administrator's own has no grant to check. */
    authorize: (actor: { userId: string; grantId: string; scope: "drafts:create" }) => Promise<void>
  }
) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null
  const database = options.database ?? getAdminDatabase(),
    hash = createHash("sha256").update(token).digest("hex")
  const row = (await database.query<Record<string, unknown>>(query, [hash])).rows[0]
  if (!row) return null
  // A null grant is an administrator's own session. The query above already requires that person's
  // active membership and a confirmed, unbanned identity, the same standing a grant check demands,
  // and that is the whole of their authority; there is no grant to have expired.
  if (row.grant_id !== null)
    await options.authorize({ userId: String(row.user_id), grantId: String(row.grant_id), scope: "drafts:create" })
  // Recheck every binding condition after the asynchronous current-grant check.
  const current = (await database.query<Record<string, unknown>>(query, [hash])).rows[0]
  return current
    ? {
        ...mapPrivateArtworkAsset(current),
        capabilityExpiresAt: new Date(String(current.capability_expires_at)).getTime(),
      }
    : null
}
