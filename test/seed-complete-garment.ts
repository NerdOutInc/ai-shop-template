import type { Pool } from "pg"

/**
 * Give a fixture shop a complete garment, so its products can be shown or scheduled.
 *
 * Template migrations deliberately seed no categories or garments. Each fixture owns its
 * own approved garment profile; both inserts are idempotent for repeated fixture setup.
 */
export async function seedCompleteGarment(pool: Pool, shopId: string, blueprintId = 1317) {
  await pool.query(
    `insert into commerce.shop_categories (shop_id,slug,name,sort_position)
       values ($1,'t-shirts','T-shirts',1) on conflict do nothing`,
    [shopId]
  )
  await pool.query(
    `insert into commerce.garment_models
       (shop_id,blueprint_id,manufacturer,model,category_slug,google_product_category,gender,age_group,size_system)
       values ($1,$2,'Next Level','6210','t-shirts',212,'unisex','adult','US') on conflict do nothing`,
    [shopId, blueprintId]
  )
}
