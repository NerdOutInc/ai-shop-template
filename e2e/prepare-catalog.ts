import { parsePrintifyProduct } from "@/lib/printify/parse-printify-product"
import { productionFingerprintVersion } from "@/lib/printify/production-fingerprint-version"
import { listCadenceSlots } from "@/features/publishing/list-cadence-slots"
import { applyAllMigrations } from "../test/apply-all-migrations"
import { createAdminDatabaseFixture } from "../test/create-admin-database-fixture"
import { seedCompleteGarment } from "../test/seed-complete-garment"
import { catalogProducts } from "./catalog-products"
import { designOfTheWeekDrop } from "./design-of-the-week-drop"
import { withheldCatalogProducts } from "./withheld-catalog-products"

/** "Fixture Newest Design", shown after this week's drop began. */
const newestDesignIndex = 2

const url = new URL(process.env.CATALOG_E2E_DATABASE_URL ?? "http://missing-database")
if (
  !["postgres:", "postgresql:"].includes(url.protocol) ||
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  url.pathname !== "/store_catalog_e2e" ||
  url.search
)
  throw new Error("CATALOG_E2E_DATABASE_URL must use the isolated local store_catalog_e2e database")
const pool = await createAdminDatabaseFixture(url.toString())
try {
  await applyAllMigrations(pool)
  await seedCompleteGarment(pool, "123")
  await pool.query(
    `insert into commerce.shop_categories (shop_id,slug,name,sort_position)
       values ('123','crop-tops','Crop tops',2)`
  )
  await pool.query(
    `insert into commerce.garment_models
       (shop_id,blueprint_id,manufacturer,model,category_slug,google_product_category,gender,age_group,size_system)
       values ('123',1312,'Next Level','5080','crop-tops',212,'female','adult','US')`
  )
  const now = new Date()
  const recentSlots = listCadenceSlots({ from: new Date(now.getTime() - 15 * 86_400_000), count: 3 })
  const currentWeek = recentSlots.filter((instant) => instant.getTime() <= now.getTime()).at(-1)
  if (!currentWeek) throw new Error("No current weekly slot for the catalog fixture")
  // When each public product entered the shop, which Newest sorts by and the New badge reads. The
  // drop's tees arrived when their week began. Newest Design was shown after that, so it is the newest
  // tee in the shop and proves Newest is not pinned to the drop. Every other one arrived more than
  // two weeks ago, an hour apart in Featured order, so none is new and their Newest order is known.
  // From the same `now` as the week, so Newest Design can never land before the drop it follows.
  const arrivedAt = (index: number) =>
    designOfTheWeekDrop.productIndexes.includes(index)
      ? currentWeek
      : index === newestDesignIndex
        ? now
        : new Date(now.getTime() - 30 * 86_400_000 - index * 3_600_000)
  const stock: Record<string, unknown> = {}
  const counts: Record<string, number> = {}
  // Every product the shop knows about, shown or not, so the withheld ones are ordinary in every way
  // except the owner's decision. A gate that failed open has to be caught by absence, not by a
  // product that was incomplete anyway. None was ever shown, so none has an arrival of its own; the
  // one the clock already revealed arrives by its reveal_at, as a real drop does.
  const seeded = [
    ...catalogProducts.map((display, index) => ({
      display,
      hiddenAt: null as string | null,
      revealAt: null as string | null,
      addedToShopAt: arrivedAt(index).toISOString() as string | null,
    })),
    ...withheldCatalogProducts.map((product) => ({ ...product, addedToShopAt: null })),
  ]
  for (const [index, { display, hiddenAt, revealAt, addedToShopAt }] of seeded.entries()) {
    const snapshot = {
      ...display,
      visible: true,
      // One matching-artwork sibling is deliberately not scheduled; one scheduled product has
      // different artwork. Weekly membership must come from product IDs, never the design.
      ...(designOfTheWeekDrop.artworkProductIndexes.includes(index)
        ? { storefront_artwork: designOfTheWeekDrop.artwork }
        : {}),
      blueprint_id: display.blueprint_id,
      print_provider_id: 99,
      print_areas: [
        {
          variant_ids: display.variants.map((v) => v.id),
          placeholders: [
            { position: "front", images: [{ id: "fixture-artwork", x: 0.5, y: 0.5, scale: 1, angle: 0 }] },
          ],
        },
      ],
    }
    const parsed = parsePrintifyProduct(snapshot, { productId: display.id, shopId: "123" })
    if (!parsed) throw new Error("Invalid catalog fixture")
    stock[display.id] = parsed.variants.map(({ id, enabled, inStock, fingerprint }) => ({
      id,
      enabled,
      inStock,
      fingerprint,
    }))
    counts[display.id] = index === 1 ? 3 : index === 0 ? 1 : 0
    // hidden_at is named explicitly: the reveal gate defaults it to now(), so relying on the default
    // here would seed the whole public fixture hidden and fail every browser spec at server startup.
    // The two moments are SQL expressions so they stay relative to when the fixture is prepared.
    await pool.query(
      `insert into commerce.printify_products (shop_id,product_id,snapshot,active,hidden_at,reveal_at,added_to_shop_at)
         values ('123',$1,$2::jsonb,true,${hiddenAt ?? "null"},${revealAt ?? "null"},$3)`,
      [display.id, JSON.stringify(snapshot), addedToShopAt]
    )
  }
  for (const index of designOfTheWeekDrop.productIndexes) {
    await pool.query(
      `insert into commerce.product_week_schedule (shop_id,product_id,live_at,featured_by)
       values ('123',$1,$2,gen_random_uuid())`,
      [catalogProducts[index]!.id, currentWeek.toISOString()]
    )
  }
  for (const [kind, payload] of [
    ["stock", { fingerprintVersion: productionFingerprintVersion, products: stock }],
    ["popularity", counts],
  ])
    await pool.query(
      "insert into commerce.catalog_refreshes (shop_id,kind,payload,observed_at) values ('123',$1,$2::jsonb,now())",
      [kind, JSON.stringify(payload)]
    )
} finally {
  await pool.end()
}
