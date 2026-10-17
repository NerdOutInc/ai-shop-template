import "server-only"
import { randomUUID } from "node:crypto"
import type { Pool, PoolClient } from "pg"
import { normalizeCatalogProduct } from "@/features/catalog/normalize-catalog-product"
import { displayProductTitle } from "@/features/catalog/display-product-title"
import { DOTW_CADENCE } from "@/features/publishing/dotw-cadence"
import { isCurrentCadenceWeek } from "@/features/publishing/is-current-cadence-week"
import { listCadenceSlots } from "@/features/publishing/list-cadence-slots"
import { productVisibilitySql } from "@/features/publishing/product-visibility-sql"
import {
  weeklyHeroSchema,
  type HeroAsset,
  type WeeklyHero,
  type WeeklyHeroManifest,
  type WeeklyHeroDraft,
} from "./weekly-hero-schema"

import { WeeklyHeroError } from "./weekly-hero-error"

export type StoredHeroAsset = HeroAsset & { pathname: string; sha256: string; contentType: string; bytes: number }

type Row = { live_at: Date; version: string; scheduled: boolean; manifest: unknown }
type Product = { productId: string; title: string; colors: string[]; shown: boolean }
type ProductRow = { product_id: string; snapshot: { title?: string }; shown: boolean }

// The normalizer only needs these fields for titles/colors. Keep provider photos and print settings in Postgres.
const productProjectionSql = `jsonb_build_object(
  'product_id', product.product_id, 'shown', (${productVisibilitySql.shown}),
  'snapshot', jsonb_build_object(
    'id', product.product_id, 'shop_id', product.shop_id::bigint, 'title', product.snapshot->'title',
    'options', product.snapshot->'options', 'images', '[]'::jsonb,
    'variants', coalesce((select jsonb_agg(jsonb_build_object(
      'id', variant->'id', 'price', variant->'price', 'is_enabled', true, 'options', variant->'options'
    )) from jsonb_array_elements(product.snapshot->'variants') variant where variant->>'is_enabled'='true'), '[]'::jsonb)
  ))`

function toProduct(row: ProductRow): Product {
  try {
    const product = normalizeCatalogProduct(row.snapshot)
    return {
      productId: row.product_id,
      title: displayProductTitle(product.title),
      colors: product.colors.map((c) => c.name),
      shown: row.shown,
    }
  } catch {
    return {
      productId: row.product_id,
      title: displayProductTitle(typeof row.snapshot.title === "string" ? row.snapshot.title : row.product_id),
      colors: [],
      shown: row.shown,
    }
  }
}

function linksMatch(links: WeeklyHeroManifest["links"], products: Product[], requireShown = false) {
  return links.every((link) =>
    products.some(
      (p) =>
        p.productId === link.productId && (!requireShown || p.shown) && (!link.color || p.colors.includes(link.color))
    )
  )
}

function toHero(row: Row, assets: StoredHeroAsset[]): WeeklyHero | null {
  const parsed = weeklyHeroSchema.safeParse(row.manifest)
  if (!parsed.success) return null
  const desktop = assets.find((a) => a.id === parsed.data.desktopAssetId && a.kind === "desktop")
  const mobile = assets.find((a) => a.id === parsed.data.mobileAssetId && a.kind === "mobile")
  if (!desktop || !mobile) return null
  const metadata = ({ id, kind, width, height }: HeroAsset): HeroAsset => ({ id, kind, width, height })
  return {
    liveAt: row.live_at.toISOString(),
    version: row.version,
    scheduled: row.scheduled,
    manifest: parsed.data,
    desktop: metadata(desktop),
    mobile: metadata(mobile),
  }
}

/** All callers establish admin access or use the deliberately narrow public read. */
export class WeeklyHeroStore {
  constructor(
    private readonly pool: Pool,
    private readonly shopId: string,
    private readonly cadence = DOTW_CADENCE
  ) {}

  async clock() {
    return (await this.pool.query<{ now: Date }>("select clock_timestamp() as now")).rows[0]!.now.getTime()
  }

  async asset(id: string, client: Pool | PoolClient = this.pool): Promise<StoredHeroAsset | null> {
    const result = await client.query<StoredHeroAsset>(
      `select id,kind,width,height,pathname,sha256,content_type as "contentType",bytes
       from commerce.weekly_hero_assets where shop_id=$1 and id=$2`,
      [this.shopId, id]
    )
    return result.rows[0] ?? null
  }

  async addAsset(asset: StoredHeroAsset, actor: string) {
    await this.pool.query(
      `insert into commerce.weekly_hero_assets
      (id,shop_id,kind,pathname,sha256,content_type,bytes,width,height,created_by)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        asset.id,
        this.shopId,
        asset.kind,
        asset.pathname,
        asset.sha256,
        asset.contentType,
        asset.bytes,
        asset.width,
        asset.height,
        actor,
      ]
    )
  }

  async products(liveAt: string, client: Pool | PoolClient = this.pool): Promise<Product[]> {
    const result = await client.query<{ product: ProductRow }>(
      `select ${productProjectionSql} as product
       from commerce.printify_products product join commerce.product_week_schedule schedule using(shop_id,product_id)
       where product.shop_id=$1 and schedule.live_at=$2 and schedule.ended_at is null and product.active
       order by product.product_id`,
      [this.shopId, liveAt]
    )
    return result.rows.map((row) => toProduct(row.product))
  }

  private async hydrate(row: Row, client: Pool | PoolClient = this.pool): Promise<WeeklyHero | null> {
    const parsed = weeklyHeroSchema.safeParse(row.manifest)
    if (!parsed.success) return null
    const [desktop, mobile] = await Promise.all([
      this.asset(parsed.data.desktopAssetId, client),
      this.asset(parsed.data.mobileAssetId, client),
    ])
    return desktop && mobile ? toHero(row, [desktop, mobile]) : null
  }

  async read(liveAt: string): Promise<WeeklyHero | null> {
    return (await this.readDraft(liveAt))?.hero ?? null
  }

  /** Preserve revision guards even when a stored composition cannot be hydrated. */
  async readDraft(liveAt: string): Promise<WeeklyHeroDraft | null> {
    const result = await this.pool.query<Row>(
      `select live_at,version,scheduled,manifest from commerce.weekly_heroes where shop_id=$1 and live_at=$2`,
      [this.shopId, liveAt]
    )
    const row = result.rows[0]
    return row ? { version: row.version, scheduled: row.scheduled, hero: await this.hydrate(row) } : null
  }

  async summaries() {
    const result = await this.pool.query<{ live_at: Date; scheduled: boolean; title: string }>(
      `select live_at,scheduled,manifest->>'title' as title from commerce.weekly_heroes
       where shop_id=$1 and live_at>now()-interval '8 days' order by live_at`,
      [this.shopId]
    )
    return result.rows.map((r) => ({ liveAt: r.live_at.toISOString(), scheduled: r.scheduled, title: r.title }))
  }

  /** One uncached snapshot keeps revocation, product visibility and asset authorization atomic.
   * Private asset fields remain server-only; current() exposes only the public metadata. */
  private async currentSelection() {
    const result = await this.pool.query<
      Row & { evaluated_at: Date; assets: StoredHeroAsset[] | null; products: ProductRow[] | null }
    >(
      `select hero.live_at,hero.version,hero.scheduled,hero.manifest,now() as evaluated_at,
      (select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'width',width,'height',height,
        'pathname',pathname,'sha256',sha256,'contentType',content_type,'bytes',bytes))
        from commerce.weekly_hero_assets where shop_id=hero.shop_id
        and id::text in (lower(hero.manifest->>'desktopAssetId'),lower(hero.manifest->>'mobileAssetId'))) as assets,
      (select jsonb_agg(${productProjectionSql})
        from commerce.printify_products product join commerce.product_week_schedule schedule using(shop_id,product_id)
        where product.shop_id=hero.shop_id and schedule.live_at=hero.live_at and schedule.ended_at is null and product.active) as products
      from commerce.weekly_heroes hero where hero.shop_id=$1 and hero.scheduled
      and hero.live_at<=now() and hero.live_at>now()-interval '8 days'
      order by hero.live_at desc limit 1`,
      [this.shopId]
    )
    const row = result.rows[0]
    if (!row || !isCurrentCadenceWeek(row.live_at.toISOString(), row.evaluated_at.getTime(), this.cadence)) return null
    const assets = row.assets ?? []
    const hero = toHero(row, assets)
    if (!hero) return null
    return linksMatch(hero.manifest.links, (row.products ?? []).map(toProduct), true) ? { hero, assets } : null
  }

  async current(): Promise<WeeklyHero | null> {
    return (await this.currentSelection())?.hero ?? null
  }

  async currentAsset(id: string): Promise<StoredHeroAsset | null> {
    return (await this.currentSelection())?.assets.find((asset) => asset.id === id.toLowerCase()) ?? null
  }

  /** Withdrawal must remain possible after products move or the configured cadence changes. */
  async withdraw(input: { liveAt: string; version: string }, actor: string) {
    const result = await this.pool.query(
      `update commerce.weekly_heroes set scheduled=false,version=$4,updated_by=$5,updated_at=now()
       where shop_id=$1 and live_at=$2 and version=$3 returning version`,
      [this.shopId, input.liveAt, input.version, randomUUID(), actor]
    )
    if (!result.rowCount) throw new WeeklyHeroError("This hero changed in another tab. Reload before withdrawing.")
    return this.readDraft(input.liveAt)
  }

  async save(
    input: { liveAt: string; version: string | null; scheduled: boolean; manifest: WeeklyHeroManifest },
    actor: string
  ) {
    const parsed = weeklyHeroSchema.safeParse(input.manifest)
    if (!parsed.success) throw new WeeklyHeroError(parsed.error.issues[0]?.message ?? "Check the hero details.")
    input = { ...input, manifest: parsed.data }
    const client = await this.pool.connect()
    try {
      await client.query("begin")
      // Use the same ordered product locks as schedule/visibility writers before checking membership.
      const ids = input.manifest.links.map((l) => l.productId).sort()
      await client.query(
        `select product_id from commerce.printify_products where shop_id=$1 and product_id=any($2::text[]) order by product_id for update`,
        [this.shopId, ids]
      )
      const clock = (await client.query<{ now: Date }>("select clock_timestamp() as now")).rows[0]!.now
      const liveAt = new Date(input.liveAt)
      const next = listCadenceSlots({ cadence: this.cadence, from: liveAt, count: 1 })[0]!
      const isCadence =
        listCadenceSlots({ cadence: this.cadence, from: new Date(liveAt.getTime() - 1), count: 1 })[0]!.getTime() ===
        liveAt.getTime()
      const allowed =
        isCadence &&
        next > clock &&
        (liveAt <= clock ||
          listCadenceSlots({ cadence: this.cadence, from: clock, count: 6 }).some(
            (d) => d.getTime() === liveAt.getTime()
          ))
      if (!allowed) throw new WeeklyHeroError("Choose the current week or one of the next six release dates.")
      const products = await this.products(input.liveAt, client)
      if (!linksMatch(input.manifest.links, products))
        throw new WeeklyHeroError(
          "All linked products and colors must belong to this week. Refresh the lineup and try again."
        )
      for (const kind of ["desktop", "mobile"] as const) {
        const asset = await this.asset(input.manifest[`${kind}AssetId`], client)
        if (!asset || asset.kind !== kind) throw new WeeklyHeroError(`Upload the ${kind} image first.`)
      }
      // Revision compare-and-swap prevents a stale tab from replacing a newer approved hero.
      const result = input.version
        ? await client.query(
            `update commerce.weekly_heroes set version=$4,scheduled=$5,manifest=$6,updated_by=$7,updated_at=now()
            where shop_id=$1 and live_at=$2 and version=$3 returning version`,
            [
              this.shopId,
              input.liveAt,
              input.version,
              randomUUID(),
              input.scheduled,
              JSON.stringify(input.manifest),
              actor,
            ]
          )
        : await client.query(
            `insert into commerce.weekly_heroes(shop_id,live_at,version,scheduled,manifest,updated_by)
            values($1,$2,$3,$4,$5,$6) on conflict do nothing returning version`,
            [this.shopId, input.liveAt, randomUUID(), input.scheduled, JSON.stringify(input.manifest), actor]
          )
      if (!result.rowCount) throw new WeeklyHeroError("This hero changed in another tab. Reload before saving.")
      await client.query("commit")
      return this.readDraft(input.liveAt)
    } catch (error) {
      await client.query("rollback").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }
}
