import "server-only"

import type { Pool } from "pg"

import { getAdminDatabase } from "@/features/admin/get-admin-database.server"
import type { LibraryStoredAsset } from "@/features/design-library/library-types"

export async function readApprovedProductArtwork(
  input: { shopId: string; productId: string; productionFingerprint: string },
  database?: Pool
): Promise<{ revisionId: string; productionFingerprint: string; printAsset: LibraryStoredAsset } | null> {
  const row = (
    await (database ?? getAdminDatabase()).query<Record<string, unknown>>(
      `select a.*,r.revision_id,r.production_fingerprint from commerce.design_product_artwork r
    join public.library_assets a on a.id=r.print_asset_id and a.revision_id=r.revision_id and a.sha256=r.print_sha256
    where r.shop_id=$1 and r.product_id=$2 and r.production_fingerprint=$3 and a.status='ready' and a.kind='print'`,
      [input.shopId, input.productId, input.productionFingerprint]
    )
  ).rows[0]
  if (!row) return null
  return {
    revisionId: String(row.revision_id),
    productionFingerprint: String(row.production_fingerprint),
    printAsset: {
      id: String(row.id),
      url: `/api/admin/assets/${row.id}`,
      kind: "print",
      status: "ready",
      pathname: row.pathname as string,
      sourcePath: row.source_path as string | null,
      originalFilename: String(row.original_filename),
      mimeType: String(row.mime_type),
      width: row.width as number,
      height: row.height as number,
      bytes: Number(row.bytes),
      sha256: row.sha256 as string,
      pixelSha256: row.pixel_sha256 as string,
      perceptualHash: row.perceptual_hash as string | null,
      hasAlpha: row.has_alpha as boolean,
      hasTransparency: row.has_transparency as boolean,
      enlarged: row.enlarged as boolean | null,
    },
  }
}
