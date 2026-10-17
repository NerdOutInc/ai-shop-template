// @vitest-environment node
import { randomUUID } from "node:crypto"
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { Pool } from "pg"
import { createAdminDatabaseFixture } from "../../../test/create-admin-database-fixture"
import { createRuntimeLoginPool } from "../../../test/create-runtime-login-pool"
import { applyAllMigrations } from "../../../test/apply-all-migrations"
import { listCadenceSlots } from "@/features/publishing/list-cadence-slots"
import { WeeklyHeroStore } from "./weekly-hero-store.server"
import type { WeeklyHeroManifest } from "./weekly-hero-schema"

vi.mock("server-only", () => ({}))

const url = process.env.WEEKLY_HERO_TEST_DATABASE_URL
const actor = randomUUID(),
  desktop = randomUUID(),
  mobile = randomUUID()
const future = listCadenceSlots({ from: new Date(), count: 1 })[0]!.toISOString()
const current = listCadenceSlots({ from: new Date(Date.now() - 8 * 86400000), count: 2 })
  .filter((d) => d.getTime() <= Date.now())
  .at(-1)!
  .toISOString()
let pool: Pool, runtime: Pool, store: WeeklyHeroStore
const manifest: WeeklyHeroManifest = {
  title: "Fixture drop",
  alt: "Two real garments in a climbing scene",
  offer: "Explore this week’s collection.",
  desktopAssetId: desktop,
  mobileAssetId: mobile,
  links: [
    {
      productId: "tee",
      label: "Shop T-shirt",
      color: "Black",
      desktop: { x: 26, y: 15, width: 23, height: 75 },
      mobile: { x: 0, y: 10, width: 50, height: 40 },
    },
    {
      productId: "crop",
      label: "Shop crop top",
      color: "Black",
      desktop: { x: 51, y: 15, width: 23, height: 75 },
      mobile: { x: 50, y: 50, width: 50, height: 40 },
    },
  ],
}
describe.skipIf(!url)("weekly hero release boundary", () => {
  beforeAll(async () => {
    pool = await createAdminDatabaseFixture(url!)
    await applyAllMigrations(pool, async (file) => {
      if (file.endsWith("_weekly_hero_schedule.sql"))
        await pool.query(
          `insert into commerce.printify_products(shop_id,product_id,active,snapshot) values('123','pre-hero-product',true,'{"title":"Existing product"}'::jsonb)`
        )
    })
    // An upgrade must leave existing products and their operating schema intact.
    expect(
      (
        await pool.query(
          "select snapshot->>'title' as title from commerce.printify_products where product_id='pre-hero-product'"
        )
      ).rows[0]?.title
    ).toBe("Existing product")
    runtime = await createRuntimeLoginPool(pool, url!)
    store = new WeeklyHeroStore(runtime, "123")
  })
  afterAll(async () => {
    await runtime?.end()
    await pool?.end()
  })
  beforeEach(async () => {
    await pool.query(
      "delete from commerce.weekly_heroes;delete from commerce.weekly_hero_assets;delete from commerce.product_week_schedule;delete from commerce.printify_products"
    )
    for (const id of ["tee", "crop"])
      await pool.query(
        `insert into commerce.printify_products(shop_id,product_id,active,snapshot,hidden_at,reveal_at) values('123',$1,true,$2,now(),$3)`,
        [
          id,
          JSON.stringify({
            title: `${id}`,
            options: [{ name: "Colours", values: [{ id: 1, title: "Black" }] }],
            variants: [{ id: 1, price: 2500, is_enabled: true, options: [1] }],
          }),
          future,
        ]
      )
    for (const liveAt of [current, future])
      for (const id of ["tee", "crop"])
        await pool.query(
          `insert into commerce.product_week_schedule(shop_id,product_id,live_at,featured_by) values('123',$1,$2,$3)`,
          [id, liveAt, actor]
        )
    for (const [id, kind, width, height] of [
      [desktop, "desktop", 2400, 800],
      [mobile, "mobile", 1200, 2100],
    ] as const)
      await store.addAsset(
        {
          id,
          kind,
          width,
          height,
          pathname: `weekly-heroes/v1/${id}.webp`,
          contentType: "image/webp",
          sha256: "a".repeat(64),
          bytes: 100,
        },
        actor
      )
  })
  it("withholds approved future artwork, then releases matching visible products without a publishing job", async () => {
    const saved = await store.save({ liveAt: future, version: null, scheduled: true, manifest }, actor)
    expect(saved?.scheduled).toBe(true)
    expect(await store.current()).toBeNull()
    expect(await store.currentAsset(desktop)).toBeNull()
    await pool.query("update commerce.weekly_heroes set live_at=$1", [current])
    expect(await store.current()).toBeNull()
    expect(await store.currentAsset(desktop)).toBeNull()
    await pool.query("update commerce.printify_products set reveal_at=$1", [current])
    expect((await store.current())?.manifest.title).toBe("Fixture drop")
    expect(JSON.stringify(await store.current())).not.toContain("pathname")
    expect((await store.currentAsset(desktop))?.pathname).toBe(`weekly-heroes/v1/${desktop}.webp`)
    expect(await store.currentAsset(randomUUID())).toBeNull()
    expect(await store.products(current)).toEqual([
      { productId: "crop", title: "crop", colors: ["Black"], shown: true },
      { productId: "tee", title: "tee", colors: ["Black"], shown: true },
    ])
    await pool.query("update commerce.weekly_heroes set scheduled=false")
    expect(await store.currentAsset(desktop)).toBeNull()
  })
  it("keeps drafts private and stops showing a hero after its product is moved or hidden", async () => {
    const draft = await store.save({ liveAt: current, version: null, scheduled: false, manifest }, actor)
    await pool.query("update commerce.printify_products set hidden_at=null,reveal_at=null")
    expect(await store.current()).toBeNull()
    expect(await store.currentAsset(desktop)).toBeNull()
    await store.save({ liveAt: current, version: draft!.version, scheduled: true, manifest }, actor)
    expect(await store.current()).not.toBeNull()
    await pool.query("update commerce.printify_products set hidden_at=now(),reveal_at=null where product_id='crop'")
    expect(await store.currentAsset(desktop)).toBeNull()
    await pool.query("update commerce.printify_products set hidden_at=null where product_id='crop'")
    expect(await store.currentAsset(desktop)).not.toBeNull()
    await pool.query(
      "update commerce.product_week_schedule set ended_at=now() where product_id='crop' and live_at=$1",
      [current]
    )
    expect(await store.current()).toBeNull()
    expect(await store.currentAsset(desktop)).toBeNull()
  })
  it("expires a previous week's hero even when the next week has no hero", async () => {
    await store.save({ liveAt: current, version: null, scheduled: true, manifest }, actor)
    await pool.query("update commerce.printify_products set hidden_at=null,reveal_at=null")
    const old = new Date(Date.parse(current) - 7 * 86400000).toISOString()
    await pool.query("update commerce.weekly_heroes set live_at=$1;", [old])
    await pool.query("update commerce.product_week_schedule set live_at=$1 where live_at=$2", [old, current])
    expect(await store.current()).toBeNull()
    expect(await store.currentAsset(desktop)).toBeNull()
  })
  it("rejects stale edits, missing assets, wrong colors and products outside the selected week", async () => {
    const saved = await store.save({ liveAt: future, version: null, scheduled: false, manifest }, actor)
    await expect(store.save({ liveAt: future, version: null, scheduled: true, manifest }, actor)).rejects.toThrow(
      "another tab"
    )
    await expect(
      store.save(
        { liveAt: future, version: saved!.version, scheduled: true, manifest: { ...manifest, mobileAssetId: desktop } },
        actor
      )
    ).rejects.toThrow("mobile")
    await expect(
      store.save(
        {
          liveAt: future,
          version: saved!.version,
          scheduled: true,
          manifest: { ...manifest, links: manifest.links.map((l) => ({ ...l, color: "Pink" })) },
        },
        actor
      )
    ).rejects.toThrow("colors")
    await pool.query(
      "update commerce.product_week_schedule set ended_at=now() where product_id='crop' and live_at=$1",
      [future]
    )
    await expect(
      store.save({ liveAt: future, version: saved!.version, scheduled: true, manifest }, actor)
    ).rejects.toThrow("All linked products")
  })
  it("supports a single destination, shop isolation and withdrawal after lineup changes", async () => {
    const saved = await store.save(
      { liveAt: current, version: null, scheduled: true, manifest: { ...manifest, links: manifest.links.slice(0, 1) } },
      actor
    )
    await pool.query("update commerce.printify_products set hidden_at=null,reveal_at=null")
    expect((await store.current())?.manifest.links).toHaveLength(1)
    const otherShop = new WeeklyHeroStore(runtime, "456")
    expect(await otherShop.read(current)).toBeNull()
    expect(await otherShop.asset(desktop)).toBeNull()
    expect(await otherShop.currentAsset(desktop)).toBeNull()
    await pool.query("delete from commerce.product_week_schedule")
    const withdrawn = await store.withdraw({ liveAt: current, version: saved!.version }, actor)
    expect(withdrawn?.scheduled).toBe(false)
    expect(await store.currentAsset(desktop)).toBeNull()
    await expect(store.withdraw({ liveAt: current, version: saved!.version }, actor)).rejects.toThrow("another tab")
  })
  it("uses the configured cadence and refuses arbitrary or expired instants", async () => {
    const offCadence = new Date(Date.parse(future) + 3600000).toISOString()
    await expect(store.save({ liveAt: offCadence, version: null, scheduled: true, manifest }, actor)).rejects.toThrow(
      "release dates"
    )
    const expired = new Date(Date.parse(current) - 14 * 86400000).toISOString()
    await expect(store.save({ liveAt: expired, version: null, scheduled: true, manifest }, actor)).rejects.toThrow(
      "release dates"
    )
  })
  it("denies browser-role database access and allows only the intended runtime operations", async () => {
    for (const role of ["anon", "authenticated"])
      for (const table of ["weekly_heroes", "weekly_hero_assets"])
        expect(
          (
            await pool.query("select has_table_privilege($1,$2,'select,insert,update,delete') as allowed", [
              role,
              `commerce.${table}`,
            ])
          ).rows[0].allowed
        ).toBe(false)
    expect(
      (
        await pool.query(
          "select has_table_privilege('store_app_runtime','commerce.weekly_hero_assets','delete,update') as allowed"
        )
      ).rows[0].allowed
    ).toBe(false)
    const client = await runtime.connect()
    try {
      await client.query("begin")
      expect((await client.query("select count(*)::int as count from commerce.weekly_hero_assets")).rows[0].count).toBe(
        2
      )
      await client.query("rollback")
    } finally {
      client.release()
    }
  })
})

it("the public hero gate expires at the configured Friday wall clock across daylight saving", async () => {
  const row = {
    live_at: new Date("2026-03-06T23:30:00Z"),
    version: randomUUID(),
    scheduled: true,
    manifest,
    evaluated_at: new Date("2026-03-13T22:29:59Z"),
    assets: [
      { id: desktop, kind: "desktop", width: 2400, height: 800 },
      { id: mobile, kind: "mobile", width: 1200, height: 2100 },
    ],
    products: ["tee", "crop"].map((product_id) => ({
      product_id,
      shown: true,
      snapshot: {
        id: product_id,
        shop_id: 123,
        title: product_id,
        options: [{ name: "Colors", values: [{ id: 1, title: "Black" }] }],
        variants: [{ id: 1, price: 2500, is_enabled: true, options: [1] }],
        images: [],
      },
    })),
  }
  const query = vi.fn().mockImplementation(async () => ({ rows: [row] }))
  const gate = new WeeklyHeroStore({ query } as unknown as Pool, "123", {
    weekday: 5,
    hour: 17,
    minute: 30,
    timeZone: "America/Chicago",
  })
  expect((await gate.current())?.manifest.title).toBe(manifest.title)
  row.evaluated_at = new Date("2026-03-13T22:30:00Z")
  expect(await gate.current()).toBeNull()
  expect(await gate.currentAsset(desktop)).toBeNull()
})
