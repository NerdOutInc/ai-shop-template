import "server-only"
import type { Pool } from "pg"
import { galleryDisplaySql } from "./gallery-display-sql"
import type { GalleryDisplayRow } from "./apply-gallery-display.server"

export async function queryGalleryDisplay<T extends GalleryDisplayRow>(
  pool: Pool,
  fields: string,
  scope: string,
  values: unknown[]
) {
  try {
    return await pool.query<T>(`select ${fields},${galleryDisplaySql} from commerce.printify_products ${scope}`, values)
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "42P01") throw error
    // Only an absent gallery table proves no curated selection can exist. Other errors stay closed.
    const exists = await pool.query<{ relation: string | null }>(
      "select to_regclass('commerce.product_galleries')::text as relation"
    )
    if (exists.rows[0]?.relation !== null) throw error
    return pool.query<T>(
      `select ${fields},null::jsonb as gallery_active,'{}'::jsonb as gallery_history from commerce.printify_products ${scope}`,
      values
    )
  }
}
