import "server-only"

import type { LibraryStoredAsset } from "@/features/design-library/library-types"

export function mapPrivateArtworkAsset(row: Record<string, unknown>): LibraryStoredAsset {
  return {
    id: String(row.id),
    url: `/api/admin/assets/${row.id}`,
    kind: row.kind as LibraryStoredAsset["kind"],
    status: row.status as LibraryStoredAsset["status"],
    pathname: row.pathname as string | null,
    sourcePath: row.source_path as string | null,
    originalFilename: String(row.original_filename),
    mimeType: String(row.mime_type),
    width: row.width as number | null,
    height: row.height as number | null,
    bytes: row.bytes === null ? null : Number(row.bytes),
    sha256: row.sha256 as string | null,
    pixelSha256: row.pixel_sha256 as string | null,
    perceptualHash: row.perceptual_hash as string | null,
    hasAlpha: row.has_alpha as boolean | null,
    hasTransparency: row.has_transparency as boolean | null,
    enlarged: row.enlarged as boolean | null,
  }
}
