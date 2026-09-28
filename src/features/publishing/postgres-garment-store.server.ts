import "server-only"

import type { Pool, PoolClient } from "pg"

import type {
  AdminGarment,
  GarmentDisplayProfile,
  GarmentSetup,
  ProductGarmentStatus,
  ShopCategory,
} from "@/features/garment-catalog/garment-catalog"
import type { GarmentFeedProfile } from "@/features/garment-catalog/garment-feed-profile-schema"

import { productVisibilitySql } from "./product-visibility-sql"

type GarmentRow = {
  blueprint_id: number
  known: boolean
  complete: boolean
  manufacturer: string | null
  model: string | null
  category_slug: string | null
  google_product_category: number | null
  gender: AdminGarment["gender"]
  age_group: AdminGarment["ageGroup"]
  size_system: AdminGarment["sizeSystem"]
  product_count: number
  shown_count: number
  scheduled_count: number
}

function hasCode(error: unknown, code: string) {
  return (error as { code?: string } | null)?.code === code
}

/**
 * Shop categories and the garments (Printify blueprints) assigned to them.
 *
 * A second class rather than more methods on PostgresPublishingStore, which it rides: it borrows that
 * store's request pool and shop, so there is no extra pool against the connection budget, and it
 * lives in this folder because it counts shown and scheduled products, which only the Postgres
 * stores here may do (product-visibility-sql.ts). Nothing in it shares a transaction with a
 * publishing write. The two meet on ROW LOCKS instead; see saveGarment.
 */
export class PostgresGarmentStore {
  constructor(
    private readonly pool: Pool,
    private readonly shopId: string
  ) {}

  /** The public reader caches this projection; garment and category writes refresh the storefront. */
  async listDisplayProfiles(): Promise<ReadonlyMap<number, GarmentDisplayProfile>> {
    const { rows } = await this.pool.query<GarmentDisplayProfile & { blueprintId: number }>(
      `select garment.blueprint_id as "blueprintId",garment.manufacturer,garment.model,
              garment.category_slug as "categorySlug",category.name as "categoryName",
              category.sort_position as "categorySortPosition",garment.gender
         from commerce.garment_models garment
         left join commerce.shop_categories category
           on category.shop_id=garment.shop_id and category.slug=garment.category_slug
        where garment.shop_id=$1`,
      [this.shopId]
    )
    return new Map(rows.map(({ blueprintId, ...profile }) => [blueprintId, profile]))
  }

  /** Read once per feed or health check; incomplete garments have no usable feed profile. */
  async listFeedProfiles(): Promise<ReadonlyMap<number, GarmentFeedProfile>> {
    const { rows } = await this.pool.query<GarmentFeedProfile & { blueprintId: number }>(
      `select blueprint_id as "blueprintId",google_product_category as "googleProductCategory",
              gender,age_group as "ageGroup",size_system as "sizeSystem"
         from commerce.garment_models where shop_id=$1 and complete`,
      [this.shopId]
    )
    return new Map(rows.map(({ blueprintId, ...profile }) => [blueprintId, profile]))
  }

  async listCategories(): Promise<ShopCategory[]> {
    return (
      await this.pool.query<{ slug: string; name: string; garment_count: number }>(
        `select category.slug,category.name,count(garment.blueprint_id)::int as garment_count
           from commerce.shop_categories category
           left join commerce.garment_models garment
             on garment.shop_id=category.shop_id and garment.category_slug=category.slug
          where category.shop_id=$1
          group by category.slug,category.name,category.sort_position
          order by category.sort_position,category.slug`,
        [this.shopId]
      )
    ).rows.map((row) => ({ slug: row.slug, name: row.name, garmentCount: row.garment_count }))
  }

  async createCategory(input: {
    slug: string
    name: string
  }): Promise<{ status: "saved"; category: ShopCategory } | { status: "taken" }> {
    try {
      // Last in the owner's order. Two creates at once may share a position; nothing requires them
      // to differ, readers break the tie by slug, and the next reorder hands out fresh ones.
      await this.pool.query(
        `insert into commerce.shop_categories (shop_id,slug,name,sort_position)
         select $1,$2::text,$3::text,coalesce(max(sort_position),0)+1
           from commerce.shop_categories where shop_id=$1`,
        [this.shopId, input.slug, input.name]
      )
    } catch (error) {
      // The slug (primary key) or the name (shop_categories_name, case-insensitive) already exists.
      // Either way the owner would be looking at two categories they cannot tell apart.
      if (hasCode(error, "23505")) return { status: "taken" }
      throw error
    }
    return { status: "saved", category: { slug: input.slug, name: input.name, garmentCount: 0 } }
  }

  /** Changes the name and nothing else: the slug is the identity and becomes URL state. */
  async renameCategory(slug: string, name: string): Promise<"saved" | "missing" | "taken"> {
    try {
      const renamed = await this.pool.query(
        "update commerce.shop_categories set name=$3,updated_at=now() where shop_id=$1 and slug=$2 returning slug",
        [this.shopId, slug, name]
      )
      return renamed.rows.length ? "saved" : "missing"
    } catch (error) {
      if (hasCode(error, "23505")) return "taken"
      throw error
    }
  }

  async reorderCategories(slugs: readonly string[]): Promise<"saved" | "changed"> {
    const client = await this.pool.connect()
    try {
      await client.query("begin")
      // Same shape as reorderProducts: lock every row in a stable order, then compare the locked set
      // with what the owner sorted. A category created or deleted since the page loaded is a stale
      // list, and saving it would silently drop or resurrect a position.
      const rows = (
        await client.query<{ slug: string }>(
          "select slug from commerce.shop_categories where shop_id=$1 order by slug for update",
          [this.shopId]
        )
      ).rows
      const current = new Set(rows.map((row) => row.slug))
      if (
        rows.length !== slugs.length ||
        new Set(slugs).size !== slugs.length ||
        slugs.some((slug) => !current.has(slug))
      ) {
        await client.query("rollback")
        return "changed"
      }
      // Fresh 1..n rather than reorderProducts' recycled positions. Products recycle because
      // unpublished rows keep their slots; every category is in this list, and recycling would carry
      // a tie from two simultaneous creates into an order the owner did not choose.
      await client.query(
        `update commerce.shop_categories category set sort_position=ordered.sort_position,updated_at=now()
           from unnest($2::text[]) with ordinality as ordered(slug,sort_position)
          where category.shop_id=$1 and category.slug=ordered.slug`,
        [this.shopId, [...slugs]]
      )
      await client.query("commit")
      return "saved"
    } catch (error) {
      await client.query("rollback").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async deleteCategory(slug: string): Promise<"saved" | "missing" | { status: "in-use"; garments: number }> {
    // The foreign key IS the guard (garment_models_category has no `on delete` action), so "delete
    // only when unused" is one atomic statement with no read-then-write race. The count afterwards is
    // only for the sentence the owner reads. If the last garment moved away between the two
    // statements the category is free after all, so the delete gets one more go rather than
    // reporting "0 garments still use this".
    for (let attempt = 0; ; attempt++) {
      try {
        const deleted = await this.pool.query(
          "delete from commerce.shop_categories where shop_id=$1 and slug=$2 returning slug",
          [this.shopId, slug]
        )
        return deleted.rows.length ? "saved" : "missing"
      } catch (error) {
        if (!hasCode(error, "23503")) throw error
      }
      const garments = (
        await this.pool.query<{ garments: number }>(
          "select count(*)::int as garments from commerce.garment_models where shop_id=$1 and category_slug=$2",
          [this.shopId, slug]
        )
      ).rows[0]!.garments
      if (garments > 0 || attempt > 0) return { status: "in-use", garments: Math.max(garments, 1) }
    }
  }

  /**
   * Every garment worth the owner's attention: the ones set up, plus every blueprint found on an
   * active product that nobody has set up. No row means incomplete, so those come back with
   * `known: false` and their counts, which is how a blueprint Printify published behind the owner's
   * back becomes visible at all.
   */
  async listGarments(): Promise<{ garments: AdminGarment[]; productsWithoutBlueprint: number }> {
    // The visibility fragments are unqualified, so they are only ever interpolated where
    // commerce.printify_products is the single table in scope: inside the CTE, never in the join.
    const garments = (
      await this.pool.query<GarmentRow>(
        `with product_counts as (
           select blueprint_id,
                  count(*)::int as product_count,
                  (count(*) filter (where ${productVisibilitySql.shown}))::int as shown_count,
                  (count(*) filter (where (${productVisibilitySql.hiddenNow}) and reveal_at is not null))::int as scheduled_count
             from commerce.printify_products
            where shop_id=$1 and active and blueprint_id is not null
            group by blueprint_id
         ), garments as (
           select blueprint_id,complete,manufacturer,model,category_slug,google_product_category,
                  gender,age_group,size_system
             from commerce.garment_models where shop_id=$1
         )
         select coalesce(garments.blueprint_id,product_counts.blueprint_id) as blueprint_id,
                garments.blueprint_id is not null as known,
                coalesce(garments.complete,false) as complete,
                garments.manufacturer,garments.model,garments.category_slug,
                garments.google_product_category,garments.gender,garments.age_group,garments.size_system,
                coalesce(product_counts.product_count,0) as product_count,
                coalesce(product_counts.shown_count,0) as shown_count,
                coalesce(product_counts.scheduled_count,0) as scheduled_count
           from garments
           full outer join product_counts on product_counts.blueprint_id=garments.blueprint_id
          order by complete,blueprint_id`,
        [this.shopId]
      )
    ).rows.map((row) => ({
      blueprintId: row.blueprint_id,
      known: row.known,
      complete: row.complete,
      manufacturer: row.manufacturer,
      model: row.model,
      categorySlug: row.category_slug,
      googleProductCategory: row.google_product_category,
      gender: row.gender,
      ageGroup: row.age_group,
      sizeSystem: row.size_system,
      productCount: row.product_count,
      shownCount: row.shown_count,
      scheduledCount: row.scheduled_count,
    }))
    // A snapshot with no readable blueprint can never be matched to a garment, so no amount of setup
    // on this page fixes it. Counted separately so the page can say so instead of hiding them.
    const productsWithoutBlueprint = (
      await this.pool.query<{ products: number }>(
        `select count(*)::int as products from commerce.printify_products
          where shop_id=$1 and active and blueprint_id is null`,
        [this.shopId]
      )
    ).rows[0]!.products
    return { garments, productsWithoutBlueprint }
  }

  /**
   * Create or edit a garment.
   *
   * THE RULE: a complete garment may not become incomplete while a product on it is shown or
   * scheduled. No CHECK can say that, and under READ COMMITTED no single statement can either: an
   * `update ... where not exists (shown products)` that waits on a lock resumes with its pre-wait
   * snapshot, because the row it waited for was only locked, never modified, so nothing re-evaluates
   * the subquery. So both sides meet on the GARMENT ROW:
   *   - the gated writers (setProductHidden's show branch, product scheduling) lock their product
   *     rows, then take `for share` on the complete garment row before they write;
   *   - this editor takes `for update` on the garment row FIRST and only then counts products, in a
   *     SEPARATE statement, whose fresh snapshot sees every writer that committed while it waited.
   * Whichever side arrives second sees what the first one did.
   *
   * LOCK ORDER, for everything that touches these tables: categories, then products, then garments.
   *   - Writers lock products, then garments. This method takes NO product row locks, only a plain
   *     read, so it can never invert that order and deadlock a drop.
   *   - deleteCategory and reorderCategories lock category rows first, and the delete's foreign key
   *     check then waits on every garment still in that category. Left to itself this method would
   *     go the other way round: garment first, and the category only when its own foreign key check
   *     ran inside the final upsert. An edit, a delete of the category the garment is leaving and a
   *     reorder could then each hold what the next one wanted, and Postgres would end it with 40P01.
   *     So the TARGET category is taken `for key share` before the garment, which is the very lock
   *     that check takes, only early. After it this method waits on nothing but the garment.
   */
  async saveGarment(
    blueprintId: number,
    setup: GarmentSetup
  ): Promise<"saved" | "invalid-category" | { status: "in-use"; products: number }> {
    const values = [
      this.shopId,
      blueprintId,
      setup.manufacturer,
      setup.model,
      setup.categorySlug,
      setup.googleProductCategory,
      setup.gender,
      setup.ageGroup,
      setup.sizeSystem,
    ]
    // Decided from nulls ONLY to choose whether the guard below has anything to protect. What is
    // stored as `complete` is the generated column's answer, never this one.
    const leavesIncomplete = [
      setup.categorySlug,
      setup.googleProductCategory,
      setup.gender,
      setup.ageGroup,
      setup.sizeSystem,
    ].some((value) => value === null)
    const client = await this.pool.connect()
    try {
      await client.query("begin")
      // Category before garment; see LOCK ORDER. A delete that got there first makes this wait, and
      // when it commits there is no row: the same answer the foreign key would have given later.
      if (setup.categorySlug !== null) {
        const category = await client.query(
          "select 1 from commerce.shop_categories where shop_id=$1 and slug=$2 for key share",
          [this.shopId, setup.categorySlug]
        )
        if (!category.rows.length) {
          await client.query("rollback")
          return "invalid-category"
        }
      }
      let current = await this.lockGarment(client, blueprintId)
      if (!current) {
        // `for update` cannot lock a row that does not exist, so a first save has nothing to meet a
        // writer on. `do nothing` rather than `do update`: if another editor created the row while
        // this one was looking (complete, perhaps, with a product shown on it a moment later), an
        // upsert would overwrite it without ever running the guard. Losing the insert means the row
        // exists now, so lock it and take the guarded path like any other edit.
        const created = await client.query(
          `insert into commerce.garment_models
             (shop_id,blueprint_id,manufacturer,model,category_slug,google_product_category,gender,age_group,size_system)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           on conflict (shop_id,blueprint_id) do nothing returning blueprint_id`,
          values
        )
        if (created.rows.length) {
          await client.query("commit")
          return "saved"
        }
        current = await this.lockGarment(client, blueprintId)
      }
      if (current?.complete && leavesIncomplete) {
        const products = (
          await client.query<{ products: number }>(
            `select count(*)::int as products from commerce.printify_products
              where shop_id=$1 and blueprint_id=$2 and ${productVisibilitySql.revealable}`,
            [this.shopId, blueprintId]
          )
        ).rows[0]!.products
        if (products > 0) {
          await client.query("rollback")
          return { status: "in-use", products }
        }
      }
      // Still an upsert although the row is locked and nothing deletes garments: it costs nothing
      // and means this statement is right even if that ever stops being true. Moving a complete
      // garment between two real categories needs no guard, because it stays complete throughout.
      await client.query(
        `insert into commerce.garment_models
           (shop_id,blueprint_id,manufacturer,model,category_slug,google_product_category,gender,age_group,size_system)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (shop_id,blueprint_id) do update set
           manufacturer=excluded.manufacturer,model=excluded.model,category_slug=excluded.category_slug,
           google_product_category=excluded.google_product_category,gender=excluded.gender,
           age_group=excluded.age_group,size_system=excluded.size_system,updated_at=now()`,
        values
      )
      await client.query("commit")
      return "saved"
    } catch (error) {
      await client.query("rollback").catch(() => undefined)
      // garment_models_category. The key share above means a delete can no longer slip in before the
      // write, so this is the constraint's own last word rather than a path anything should reach.
      if (hasCode(error, "23503")) return "invalid-category"
      throw error
    } finally {
      client.release()
    }
  }

  private async lockGarment(client: PoolClient, blueprintId: number) {
    return (
      await client.query<{ complete: boolean }>(
        "select complete from commerce.garment_models where shop_id=$1 and blueprint_id=$2 for update",
        [this.shopId, blueprintId]
      )
    ).rows[0]
  }

  /** Every ACTIVE product with its garment's verdict, so the Products page can say "fix this garment". */
  async listProductGarmentStatus(): Promise<ProductGarmentStatus[]> {
    return (
      await this.pool.query<{
        product_id: string
        blueprint_id: number | null
        complete: boolean
        manufacturer: string | null
        model: string | null
      }>(
        `select product.product_id,product.blueprint_id,coalesce(garment.complete,false) as complete,
                garment.manufacturer,garment.model
           from commerce.printify_products product
           left join commerce.garment_models garment
             on garment.shop_id=product.shop_id and garment.blueprint_id=product.blueprint_id
          where product.shop_id=$1 and product.active
          order by product.sort_position,product.product_id`,
        [this.shopId]
      )
    ).rows.map((row) => ({
      productId: row.product_id,
      blueprintId: row.blueprint_id,
      complete: row.complete,
      label: row.manufacturer === null || row.model === null ? null : `${row.manufacturer} ${row.model}`,
    }))
  }
}
