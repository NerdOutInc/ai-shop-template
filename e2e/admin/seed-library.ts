import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"

import { createClient } from "@supabase/supabase-js"
import { Pool } from "pg"
import sharp from "sharp"

import { createPostgresLibraryStore } from "@/features/design-library/postgres-library-store.server"
import { privateAssetPathname } from "@/features/design-library/private-asset-pathname"
import { inspectLibraryImage } from "@/features/design-library/inspect-library-image.server"
import type { LibraryDesignInput } from "@/features/design-library/library-types"

import { adminTestConfig } from "./admin-test-config"

const config = adminTestConfig()
const auth = createClient(config.authURL, config.secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const { data, error } = await auth.auth.admin.listUsers()
if (error) throw new Error("Could not read local fixture owner")
const owner = data.users.find((user) => user.email === config.ownerEmail)
if (!owner) throw new Error("Complete local owner setup before seeding the gallery")
const pool = new Pool({ connectionString: config.databaseUrl })
try {
  const store = createPostgresLibraryStore({ database: pool })
  await mkdir(".tmp/admin-e2e/artwork", { recursive: true })
  await store.createCollection(owner.id, { id: "test-collection", title: "Test collection", description: null })
  for (let number = 1; number <= 3; number++) {
    const pixels = Buffer.alloc(1200 * 1200 * 4)
    for (let y = 0; y < 1200; y++)
      for (let x = 0; x < 1200; x++) {
        const offset = (y * 1200 + x) * 4
        pixels[offset] = (x * 7 + y * 11 + number * 31) % 256
        pixels[offset + 1] = (x * 13 + number * 29) % 256
        pixels[offset + 2] = (y * 17 + number * 19) % 256
        pixels[offset + 3] = x < 50 || y < 50 || x >= 1150 || y >= 1150 ? 0 : 255
      }
    const bytes = await sharp(pixels, { raw: { width: 1200, height: 1200, channels: 4 } })
      .png()
      .toBuffer()
    const sourcePath = `.tmp/admin-e2e/artwork/design-${number}.png`
    await writeFile(sourcePath, bytes)
    const inspection = await inspectLibraryImage(bytes)
    const revisionId = randomUUID()
    const design: LibraryDesignInput = {
      id: randomUUID(),
      displayNumber: number,
      title: number === 1 ? "Sample Character" : `Geometry Study ${number}`,
      family: "Geometry",
      summary: "Synthetic fixture artwork",
      mechanism: "Color pattern",
      prompt: "Generated locally for browser tests",
      background: null,
      state: "active",
      collectionIds: ["test-collection"],
      revision: {
        id: revisionId,
        printReadiness: "needs-preparation",
        printNotes: "Synthetic test image only",
        widthInches: null,
        heightInches: null,
        nativePpi: null,
        assets: (["original", "print", "preview"] as const).map((kind) => {
          const id = randomUUID()
          return {
            id,
            url: `/api/admin/assets/${id}`,
            kind,
            status: "pending",
            pathname: null,
            sourcePath,
            originalFilename: `design-${number}.png`,
            ...inspection,
            enlarged: false,
          }
        }),
      },
    }
    await store.saveDesign(owner.id, design)
  }
  const files: Record<string, { sourcePath: string; mimeType: string; sha256: string }> = {}
  const assets = await pool.query<{ id: string }>("select id from public.library_assets where status='pending'")
  for (const { id } of assets.rows) {
    const asset = await store.getAsset(owner.id, id)
    if (!asset?.sourcePath || !asset.sha256 || !asset.pixelSha256 || !asset.bytes) continue
    const pathname = privateAssetPathname(asset)
    files[pathname] = { sourcePath: asset.sourcePath, mimeType: asset.mimeType, sha256: asset.sha256 }
    // The test transport serves the already-inspected local bytes; no Blob upload is claimed here.
    await store.finalizeAsset(owner.id, {
      assetId: id,
      pathname,
      sha256: asset.sha256,
      pixelSha256: asset.pixelSha256,
      bytes: asset.bytes,
    })
  }
  await writeFile(".tmp/admin-e2e/blob-files.json", JSON.stringify(files), { mode: 0o600 })
  process.stdout.write(`Seeded 3 synthetic private fixture designs and ${assets.rowCount} local artwork files.\n`)
} finally {
  await pool.end()
}
