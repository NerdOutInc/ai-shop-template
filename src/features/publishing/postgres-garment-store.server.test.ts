// @vitest-environment node
import { Pool, type PoolClient } from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest"

import type { GarmentSetup } from "@/features/garment-catalog/garment-catalog"
import { garmentProfileOptions } from "@/features/garment-catalog/garment-profile-options"

import { applyAllMigrations } from "../../../test/apply-all-migrations"
import { createAdminDatabaseFixture } from "../../../test/create-admin-database-fixture"

import { PostgresGarmentStore } from "./postgres-garment-store.server"
import { PostgresPublishingStore } from "./postgres-publishing-store.server"

vi.mock("server-only", () => ({}))
const databaseUrl = process.env.GARMENTS_TEST_DATABASE_URL

// Each store owns its database. Queries still scope catalog rows to this configured shop.
const shop = "12345"
const hour = 60 * 60 * 1000

const finished: GarmentSetup = {
  manufacturer: "Gildan",
  model: "18000",
  categorySlug: "sweatshirts",
  googleProductCategory: 212,
  gender: "unisex",
  ageGroup: "adult",
  sizeSystem: "US",
}

describe.skipIf(!databaseUrl)("garment categories as the production login", () => {
  let database: Pool
  let runtimeUrl: string
  let publishing: PostgresPublishingStore
  let store: PostgresGarmentStore
  let initial: {
    categories: Awaited<ReturnType<PostgresGarmentStore["listCategories"]>>
    garments: Awaited<ReturnType<PostgresGarmentStore["listGarments"]>>
  }

  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    if (url.pathname !== "/store_garments_test") throw new Error("Use an isolated local store_garments_test database")
    database = await createAdminDatabaseFixture(databaseUrl!)
    await applyAllMigrations(database)
    // EVERYTHING under test runs as store_app_runtime, which is nobypassrls. A suite connected as the
    // table owner would pass with a verb's policy missing, while production answered with zero rows
    // and no error. The superuser pool below only arranges fixtures and plays the other transaction.
    //
    // A separate INHERITING login, as the drop-signup suite does, rather than giving store_app_runtime
    // itself a password: `alter role` rewrites that role's one cluster-wide catalog row, and every
    // suite doing so in its beforeAll is another chance of `tuple concurrently updated`. Creating a
    // role nobody else touches races nothing, and a member of store_app_runtime meets exactly its
    // grants and its `to store_app_runtime` policies.
    await database.query(
      "do $$ begin create role store_garments_test_login login inherit password 'garments-fixture'; exception when duplicate_object or unique_violation then null; end $$"
    )
    await database.query("grant store_app_runtime to store_garments_test_login")
    url.username = "store_garments_test_login"
    url.password = "garments-fixture"
    runtimeUrl = url.toString()
    // The garment store rides the publishing store's pool in production, so it does here too.
    publishing = new PostgresPublishingStore(runtimeUrl, shop)
    store = publishing.garments
    initial = { categories: await store.listCategories(), garments: await store.listGarments() }
  })
  afterAll(async () => {
    await publishing?.close()
    await database?.end()
  })

  // Set up the synthetic approved garment profiles independently for every test.
  beforeEach(async () => {
    await database.query(
      `truncate commerce.printify_products cascade;
       delete from commerce.garment_models where shop_id='${shop}';
       delete from commerce.shop_categories where shop_id='${shop}';
       insert into commerce.shop_categories (shop_id,slug,name,sort_position) values
         ('${shop}','t-shirts','T-shirts',1),('${shop}','sweatshirts','Sweatshirts',2),
         ('${shop}','crop-tops','Crop tops',3),('${shop}','tank-tops','Tank tops',4);
       insert into commerce.garment_models
         (shop_id,blueprint_id,manufacturer,model,category_slug,google_product_category,gender,age_group,size_system)
         values ('${shop}',1317,'Next Level','6210','t-shirts',212,'unisex','adult','US'),
                ('${shop}',1312,'Next Level','5080','crop-tops',212,'female','adult','US')`
    )
  })

  async function insertProduct(
    productId: string,
    blueprintId: number | null,
    visibility: { hiddenAt?: string | null; revealAt?: string | null; active?: boolean } = {}
  ) {
    await database.query(
      `insert into commerce.printify_products (shop_id,product_id,snapshot,active,hidden_at,reveal_at)
         values ($1,$2,$3::jsonb,$4,$5,$6)`,
      [
        shop,
        productId,
        JSON.stringify({ id: productId, ...(blueprintId === null ? {} : { blueprint_id: blueprintId }) }),
        visibility.active ?? true,
        visibility.hiddenAt ?? null,
        visibility.revealAt ?? null,
      ]
    )
  }
  const hiddenAt = () => new Date(Date.now() - hour).toISOString()
  async function garment(blueprintId: number) {
    return (await store.listGarments()).garments.find((row) => row.blueprintId === blueprintId)
  }
  // Deterministic, not a sleep: the other transaction is known to be queued behind the row lock.
  async function waitUntilBlockedOn(fragment: string) {
    for (let attempt = 0; attempt < 150; attempt++) {
      const waiting = await database.query(
        "select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like $1",
        [`%${fragment}%`]
      )
      if (waiting.rows.length) return
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error(`Nothing ever waited on ${fragment}`)
  }

  it("starts with no inherited categories or garment profiles", () => {
    expect(initial.categories).toEqual([])
    expect(initial.garments).toEqual({ garments: [], productsWithoutBlueprint: 0 })
  })

  it("reads only this shop's complete feed profiles as the runtime login and reflects edits immediately", async () => {
    onTestFinished(async () => {
      await database.query("delete from commerce.garment_models where shop_id='feed-other'")
      await database.query("delete from commerce.shop_categories where shop_id='feed-other'")
    })
    await store.saveGarment(2679, { ...finished, model: "SASW035", gender: "female", googleProductCategory: 1604 })
    await store.saveGarment(3076, { ...finished, model: "DT5300", gender: "male", sizeSystem: "UK" })
    await store.saveGarment(999, { ...finished, categorySlug: null })
    await database.query(
      `insert into commerce.shop_categories (shop_id,slug,name,sort_position)
         values ('feed-other','other','Other',1) on conflict do nothing;
       insert into commerce.garment_models
         (shop_id,blueprint_id,manufacturer,model,category_slug,google_product_category,gender,age_group,size_system)
         values ('feed-other',1312,'Other','Other','other',1604,'male','kids','EU'),
                ('feed-other',9999,'Other','Other','other',1604,'male','kids','EU') on conflict do nothing`
    )
    const profiles = await store.listFeedProfiles()
    expect([...profiles.keys()].sort()).toEqual([1312, 1317, 2679, 3076])
    expect(profiles.get(1312)).toEqual({
      googleProductCategory: 212,
      gender: "female",
      ageGroup: "adult",
      sizeSystem: "US",
    })
    expect(profiles.get(2679)).toEqual({
      googleProductCategory: 1604,
      gender: "female",
      ageGroup: "adult",
      sizeSystem: "US",
    })
    expect(profiles.get(3076)).toEqual({
      googleProductCategory: 212,
      gender: "male",
      ageGroup: "adult",
      sizeSystem: "UK",
    })
    await store.saveGarment(2679, { ...finished, googleProductCategory: 1604, sizeSystem: "EU", ageGroup: "kids" })
    expect((await store.listFeedProfiles()).get(2679)).toEqual({
      googleProductCategory: 1604,
      gender: "unisex",
      ageGroup: "kids",
      sizeSystem: "EU",
    })
  })

  it("reads saved display identities as the runtime login, including incomplete profiles and category renames", async () => {
    onTestFinished(async () => {
      await database.query("delete from commerce.garment_models where shop_id='display-other'")
      await database.query("delete from commerce.shop_categories where shop_id='display-other'")
    })
    await store.saveGarment(2679, { ...finished, manufacturer: "Stanley/Stella", model: "SASW035" })
    await store.saveGarment(999, { ...finished, categorySlug: null, gender: null })
    await database.query(
      `insert into commerce.shop_categories (shop_id,slug,name,sort_position)
         values ('display-other','crop-tops','Wrong shop',1);
       insert into commerce.garment_models
         (shop_id,blueprint_id,manufacturer,model,category_slug)
         values ('display-other',1312,'Wrong','Other','crop-tops'),
                ('display-other',9999,'Wrong','Other','crop-tops')`
    )
    const profiles = await store.listDisplayProfiles()
    expect([...profiles.keys()].sort()).toEqual([1312, 1317, 2679, 999])
    expect(profiles.get(1312)).toEqual({
      manufacturer: "Next Level",
      model: "5080",
      categoryName: "Crop tops",
      categorySlug: "crop-tops",
      categorySortPosition: 3,
      gender: "female",
    })
    expect(profiles.get(1317)).toEqual({
      manufacturer: "Next Level",
      model: "6210",
      categoryName: "T-shirts",
      categorySlug: "t-shirts",
      categorySortPosition: 1,
      gender: "unisex",
    })
    expect(profiles.get(2679)).toEqual({
      manufacturer: "Stanley/Stella",
      model: "SASW035",
      categoryName: "Sweatshirts",
      categorySlug: "sweatshirts",
      categorySortPosition: 2,
      gender: "unisex",
    })
    expect(profiles.get(999)).toEqual({
      manufacturer: "Gildan",
      model: "18000",
      categoryName: null,
      categorySlug: null,
      categorySortPosition: null,
      gender: null,
    })
    await store.renameCategory("crop-tops", "Crops")
    expect((await store.listDisplayProfiles()).get(1312)?.categoryName).toBe("Crops")
    await store.saveGarment(2679, { ...finished, manufacturer: "Updated", model: "Saved model" })
    expect((await store.listDisplayProfiles()).get(2679)?.manufacturer).toBe("Updated")
  })

  it("reads the owner's saved category order into public garment profiles after a reorder", async () => {
    await store.saveGarment(2679, finished)
    expect(await store.reorderCategories(["crop-tops", "sweatshirts", "tank-tops", "t-shirts"])).toBe("saved")

    const profiles = await store.listDisplayProfiles()
    expect(profiles.get(1312)?.categorySortPosition).toBe(1)
    expect(profiles.get(2679)?.categorySortPosition).toBe(2)
    expect(profiles.get(1317)?.categorySortPosition).toBe(4)
  })

  it("creates a category last in line, and refuses one the owner could not tell from another", async () => {
    expect(await store.createCategory({ slug: "hoodies", name: "Hoodies" })).toEqual({
      status: "saved",
      category: { slug: "hoodies", name: "Hoodies", garmentCount: 0 },
    })
    expect((await store.listCategories()).map((category) => category.slug)).toEqual([
      "t-shirts",
      "sweatshirts",
      "crop-tops",
      "tank-tops",
      "hoodies",
    ])
    // Same slug, and the same name however it is capitalised under a different slug.
    expect(await store.createCategory({ slug: "hoodies", name: "Hooded things" })).toEqual({ status: "taken" })
    expect(await store.createCategory({ slug: "hoodies-2", name: "HOODIES" })).toEqual({ status: "taken" })
    expect(await store.listCategories()).toHaveLength(5)
  })

  it("renames a category without touching its slug", async () => {
    expect(await store.renameCategory("tank-tops", "Tanks")).toBe("saved")
    expect(await store.listCategories()).toContainEqual({ slug: "tank-tops", name: "Tanks", garmentCount: 0 })
    expect(await store.renameCategory("tank-tops", "t-SHIRTS")).toBe("taken")
    expect(await store.renameCategory("never-existed", "Anything")).toBe("missing")
    expect(await store.listCategories()).toContainEqual({ slug: "tank-tops", name: "Tanks", garmentCount: 0 })
  })

  it("saves the owner's order, and refuses a list that has gone stale", async () => {
    expect(await store.reorderCategories(["tank-tops", "t-shirts", "crop-tops", "sweatshirts"])).toBe("saved")
    expect((await store.listCategories()).map((category) => category.slug)).toEqual([
      "tank-tops",
      "t-shirts",
      "crop-tops",
      "sweatshirts",
    ])
    // Missing one, naming one twice, and naming one that is gone are all "reload first".
    expect(await store.reorderCategories(["t-shirts", "crop-tops", "sweatshirts"])).toBe("changed")
    expect(await store.reorderCategories(["t-shirts", "t-shirts", "crop-tops", "sweatshirts"])).toBe("changed")
    expect(await store.reorderCategories(["t-shirts", "hoodies", "crop-tops", "sweatshirts"])).toBe("changed")
    expect((await store.listCategories())[0]?.slug).toBe("tank-tops")
  })

  it("deletes an unused category, and refuses one a garment still uses with the count", async () => {
    expect(await store.deleteCategory("tank-tops")).toBe("saved")
    expect(await store.deleteCategory("tank-tops")).toBe("missing")
    expect((await store.listCategories()).map((category) => category.slug)).not.toContain("tank-tops")

    expect(await store.saveGarment(5000, { ...finished, categorySlug: "t-shirts" })).toBe("saved")
    expect(await store.deleteCategory("t-shirts")).toEqual({ status: "in-use", garments: 2 })
    expect(await store.listCategories()).toContainEqual({ slug: "t-shirts", name: "T-shirts", garmentCount: 2 })
  })

  it("saves a new garment, edits it, and refuses a category that no longer exists", async () => {
    const draft = { ...finished, categorySlug: null, gender: null }
    expect(await store.saveGarment(5000, draft)).toBe("saved")
    expect(await garment(5000)).toMatchObject({ known: true, complete: false, manufacturer: "Gildan", gender: null })

    expect(await store.saveGarment(5000, finished)).toBe("saved")
    expect(await garment(5000)).toMatchObject({ complete: true, categorySlug: "sweatshirts", gender: "unisex" })

    expect(await store.saveGarment(5000, { ...finished, categorySlug: "deleted-meanwhile" })).toBe("invalid-category")
    expect(await store.saveGarment(5001, { ...finished, categorySlug: "deleted-meanwhile" })).toBe("invalid-category")
    expect(await garment(5000)).toMatchObject({ complete: true, categorySlug: "sweatshirts" })
    expect(await garment(5001)).toBeUndefined()
  })

  // The same lists live twice: in garmentProfileOptions, which the form and the request schema read,
  // and in the table's CHECKs. Nothing but this keeps them together, and a value the form offers
  // that the table refuses is a 23514 the owner would meet as a permanent "temporarily unavailable".
  it.each([
    ["gender", "gender", garmentProfileOptions.genders],
    ["ageGroup", "age_group", garmentProfileOptions.ageGroups],
    ["sizeSystem", "size_system", garmentProfileOptions.sizeSystems],
  ] as const)("accepts every %s the form offers, and nothing the form does not", async (field, column, offered) => {
    for (const value of offered) {
      expect(await store.saveGarment(5000, { ...finished, [field]: value }), value).toBe("saved")
      expect((await garment(5000))?.[field], value).toBe(value)
    }
    // The other direction, read from the constraint itself: a value only the table knows would
    // never be offered, and one refusal would not prove there is no such value.
    const definition = (
      await database.query<{ definition: string }>(
        `select pg_get_constraintdef(oid) as definition from pg_constraint
          where conrelid='commerce.garment_models'::regclass and conname=$1`,
        [`garment_models_${column}_check`]
      )
    ).rows[0]!.definition
    expect([...definition.matchAll(/'([^']+)'::text/g)].map((match) => match[1])).toEqual([...offered])
    await expect(
      database.query(`update commerce.garment_models set ${column}='XX' where shop_id=$1 and blueprint_id=5000`, [shop])
    ).rejects.toMatchObject({ code: "23514" })
  })

  // The edit takes its category before its garment (saveGarment's LOCK ORDER), so a delete already
  // under way makes it wait there, holding nothing, and answer from what the delete left behind.
  it("waits for a delete of its category, and then says the category is gone", async () => {
    const remover = await database.connect()
    let edit: ReturnType<PostgresGarmentStore["saveGarment"]>
    try {
      await remover.query("begin")
      await remover.query("delete from commerce.shop_categories where shop_id=$1 and slug='tank-tops'", [shop])
      edit = store.saveGarment(1312, { ...finished, categorySlug: "tank-tops" })
      await waitUntilBlockedOn("shop_categories where shop_id=$1 and slug=$2 for key share")
      await remover.query("commit")
    } catch (error) {
      await remover.query("rollback").catch(() => undefined)
      throw error
    } finally {
      remover.release()
    }
    expect(await edit).toBe("invalid-category")
    expect(await garment(1312)).toMatchObject({ complete: true, categorySlug: "crop-tops", model: "5080" })
  })

  it.each([
    ["shown", {}],
    [
      "scheduled",
      { hiddenAt: new Date(Date.now() - hour).toISOString(), revealAt: new Date(Date.now() + hour).toISOString() },
    ],
  ])("refuses to make a complete garment incomplete while a product on it is %s", async (_state, visibility) => {
    await insertProduct("tee-in-the-way", 1317, visibility)
    await insertProduct("tee-in-the-dark", 1317, { hiddenAt: hiddenAt() })
    const unfinished = { ...finished, manufacturer: "Next Level", model: "6210", sizeSystem: null }
    expect(await store.saveGarment(1317, unfinished)).toEqual({ status: "in-use", products: 1 })
    expect(await garment(1317)).toMatchObject({ complete: true, sizeSystem: "US" })
    // Moving it between two real categories keeps it complete throughout, so that is always fine.
    expect(await store.saveGarment(1317, { ...unfinished, sizeSystem: "US", categorySlug: "tank-tops" })).toBe("saved")
    expect(await garment(1317)).toMatchObject({ complete: true, categorySlug: "tank-tops" })
  })

  it("lets a complete garment become incomplete once every product on it is hidden", async () => {
    await insertProduct("tee-in-the-dark", 1317, { hiddenAt: hiddenAt() })
    // An unpublished row on the wall by its columns is not on the wall: `active` is Printify's answer.
    await insertProduct("unpublished", 1317, { active: false })
    // Another garment's shown product is nobody's business here.
    await insertProduct("crop-top-selling", 1312)
    expect(await store.saveGarment(1317, { ...finished, categorySlug: null })).toBe("saved")
    expect(await garment(1317)).toMatchObject({ complete: false, categorySlug: null })
  })

  // THE MIRROR RACE. A writer has share-locked the complete garment and is about to show a product.
  // An edit that arrives now must WAIT, and must then count with a fresh snapshot that sees the
  // product the writer just put on the wall. A guard that counted first, or in the statement that
  // waited, would see no shown product and clear the garment under it.
  it("refuses an edit that was waiting while a writer showed a product on the garment", async () => {
    await insertProduct("racing-tee", 1317, { hiddenAt: hiddenAt() })
    const writer = await database.connect()
    let edit: ReturnType<PostgresGarmentStore["saveGarment"]>
    try {
      await writer.query("begin")
      await writer.query(
        "select 1 from commerce.printify_products where shop_id=$1 and product_id='racing-tee' for update",
        [shop]
      )
      await writer.query(
        "select 1 from commerce.garment_models where shop_id=$1 and blueprint_id=1317 and complete for share",
        [shop]
      )
      edit = store.saveGarment(1317, { ...finished, googleProductCategory: null })
      await waitUntilBlockedOn("garment_models where shop_id=$1 and blueprint_id=$2 for update")
      await writer.query(
        "update commerce.printify_products set hidden_at=null where shop_id=$1 and product_id='racing-tee'",
        [shop]
      )
      await writer.query("commit")
    } catch (error) {
      await writer.query("rollback").catch(() => undefined)
      throw error
    } finally {
      writer.release()
    }
    expect(await edit).toEqual({ status: "in-use", products: 1 })
    expect(await garment(1317)).toMatchObject({ complete: true, googleProductCategory: 212, shownCount: 1 })
  })

  // THE THREE-WAY KNOT. An edit moving a garment to another category, a delete of the category it is
  // leaving, and a reorder, all at once. If the edit took its garment before its category, each of
  // the three would hold what the next one wants: the edit the garment, the delete the old category
  // (its foreign key check waits on that garment), the reorder the new category (waiting on the
  // delete), and the edit's own foreign key check would then wait on the reorder. Postgres ends that
  // with 40P01, which the owner meets as "temporarily unavailable".
  //
  // The only staging is a held-back final statement, standing in for one slow network round trip
  // between the edit's lock and its write. Everything else is the real store as the runtime login.
  it("never deadlocks an edit against a category delete and a reorder", async () => {
    await database.query("update commerce.garment_models set category_slug='tank-tops' where blueprint_id=1312")
    let reachedTheWrite!: () => void
    let letTheWriteGo!: () => void
    const atTheWrite = new Promise<void>((resolve) => (reachedTheWrite = resolve))
    const held = new Promise<void>((resolve) => (letTheWriteGo = resolve))
    const slowPool = new Pool({ connectionString: runtimeUrl, max: 1 })
    const connect = slowPool.connect.bind(slowPool) as () => Promise<PoolClient>
    Object.assign(slowPool, {
      connect: async () => {
        const client = await connect()
        const query = client.query.bind(client) as (text: string, values?: unknown[]) => Promise<unknown>
        Object.assign(client, {
          query: async (text: string, values?: unknown[]) => {
            if (text.includes("do update set")) {
              reachedTheWrite()
              await held
            }
            return query(text, values)
          },
        })
        return client
      },
    })
    try {
      const edit = new PostgresGarmentStore(slowPool, shop).saveGarment(1312, {
        ...finished,
        categorySlug: "crop-tops",
      })
      await atTheWrite
      const removal = store.deleteCategory("tank-tops")
      await waitUntilBlockedOn("delete from commerce.shop_categories")
      const reorder = store.reorderCategories(["tank-tops", "t-shirts", "crop-tops", "sweatshirts"])
      await waitUntilBlockedOn("commerce.shop_categories where shop_id=$1 order by slug for update")
      letTheWriteGo()
      // Settled, not awaited one by one: whichever of the three Postgres picked as the deadlock's
      // victim is the one that would reject, and the test must not care which.
      expect(await Promise.allSettled([edit, removal, reorder])).toEqual([
        { status: "fulfilled", value: "saved" },
        // The garment left before the delete's foreign key check got to look, so nothing uses it.
        { status: "fulfilled", value: "saved" },
        // ...and the list the owner sorted still named the category that just went.
        { status: "fulfilled", value: "changed" },
      ])
      expect(await garment(1312)).toMatchObject({ complete: true, categorySlug: "crop-tops" })
    } finally {
      letTheWriteGo()
      await slowPool.end()
    }
  })

  // `for update` cannot lock a row that does not exist yet, so a FIRST save has to notice that it
  // lost the insert and take the guarded path, instead of upserting over a garment somebody else
  // just completed.
  it("runs the guard when another editor creates the garment first", async () => {
    await insertProduct("already-selling", 5002)
    const other = await database.connect()
    let edit: ReturnType<PostgresGarmentStore["saveGarment"]>
    try {
      await other.query("begin")
      await other.query(
        `insert into commerce.garment_models
           (shop_id,blueprint_id,manufacturer,model,category_slug,google_product_category,gender,age_group,size_system)
           values ($1,5002,'Gildan','18000','sweatshirts',212,'unisex','adult','US')`,
        [shop]
      )
      edit = store.saveGarment(5002, { ...finished, ageGroup: null })
      await waitUntilBlockedOn("on conflict (shop_id,blueprint_id) do nothing")
      await other.query("commit")
    } catch (error) {
      await other.query("rollback").catch(() => undefined)
      throw error
    } finally {
      other.release()
    }
    expect(await edit).toEqual({ status: "in-use", products: 1 })
    expect(await garment(5002)).toMatchObject({ complete: true, ageGroup: "adult" })
  })

  it("surfaces a blueprint nobody has set up, with what is riding on it, and sorts unfinished first", async () => {
    await insertProduct("hoodie-shown", 9999)
    await insertProduct("hoodie-scheduled", 9999, {
      hiddenAt: hiddenAt(),
      revealAt: new Date(Date.now() + hour).toISOString(),
    })
    await insertProduct("hoodie-hidden", 9999, { hiddenAt: hiddenAt() })
    // The clock already revealed this one: it is shown, and no longer scheduled.
    await insertProduct("hoodie-revealed", 9999, {
      hiddenAt: hiddenAt(),
      // Half an hour, not a second: this is Node's clock being compared with Postgres's now().
      revealAt: new Date(Date.now() - hour / 2).toISOString(),
    })
    await insertProduct("hoodie-unpublished", 9999, { active: false })
    await insertProduct("tee-shown", 1317)
    await insertProduct("no-blueprint", null)
    await insertProduct("no-blueprint-hidden", null, { hiddenAt: hiddenAt() })
    await insertProduct("no-blueprint-unpublished", null, { active: false })

    const listed = await store.listGarments()
    expect(listed.productsWithoutBlueprint).toBe(2)
    expect(listed.garments.map((row) => [row.blueprintId, row.complete])).toEqual([
      [9999, false],
      [1312, true],
      [1317, true],
    ])
    expect(listed.garments[0]).toEqual({
      blueprintId: 9999,
      known: false,
      complete: false,
      manufacturer: null,
      model: null,
      categorySlug: null,
      googleProductCategory: null,
      gender: null,
      ageGroup: null,
      sizeSystem: null,
      productCount: 4,
      shownCount: 2,
      scheduledCount: 1,
    })
    expect(listed.garments[2]).toMatchObject({ productCount: 1, shownCount: 1, scheduledCount: 0 })
  })

  // blueprint_id is a generated column over a snapshot Printify wrote, and a generated column that
  // raises refuses the INSERT: one odd value would stop a product being published at all. So it must
  // read anything that is not a plain positive integer as null, which everything here treats as
  // "no garment", and never throw. A bare `::integer` cast raises on four of these and quietly
  // accepts the other three.
  it.each([
    ["a string", '"1317"'],
    ["a fraction", "13.17"],
    ["zero", "0"],
    ["a negative", "-5"],
    ["past integer range", "12345678901"],
    ["a boolean", "true"],
    ["an object", "{}"],
  ])("reads a snapshot whose blueprint_id is %s as no blueprint, without refusing the row", async (_kind, json) => {
    await database.query(
      `insert into commerce.printify_products (shop_id,product_id,snapshot,active)
         values ($1,'odd-blueprint',$2::jsonb,true)`,
      [shop, `{"id":"odd-blueprint","blueprint_id":${json}}`]
    )
    expect(
      (await database.query("select blueprint_id from commerce.printify_products where product_id='odd-blueprint'"))
        .rows
    ).toEqual([{ blueprint_id: null }])
    expect(await store.listProductGarmentStatus()).toEqual([
      { productId: "odd-blueprint", blueprintId: null, complete: false, label: null },
    ])
    expect((await store.listGarments()).productsWithoutBlueprint).toBe(1)
  })

  it("reports every active product's garment, in lineup order", async () => {
    await insertProduct("tee", 1317)
    await insertProduct("unfinished", 5000, { hiddenAt: hiddenAt() })
    await insertProduct("unknown", 9999, { hiddenAt: hiddenAt() })
    await insertProduct("unreadable", null, { hiddenAt: hiddenAt() })
    await insertProduct("unpublished", 1317, { active: false })
    expect(await store.saveGarment(5000, { ...finished, categorySlug: null })).toBe("saved")
    expect(await store.listProductGarmentStatus()).toEqual([
      { productId: "tee", blueprintId: 1317, complete: true, label: "Next Level 6210" },
      { productId: "unfinished", blueprintId: 5000, complete: false, label: "Gildan 18000" },
      { productId: "unknown", blueprintId: 9999, complete: false, label: null },
      { productId: "unreadable", blueprintId: null, complete: false, label: null },
    ])
  })

  // `for share` needs the UPDATE privilege and policy on garment_models, not just select, and this is
  // the only place the real writers meet the real login.
  it("lets the gated writers take their garment lock as the production login", async () => {
    await insertProduct("tee", 1317, { hiddenAt: hiddenAt() })
    await insertProduct("unknown", 9999, { hiddenAt: hiddenAt() })
    expect(await publishing.setProductHidden("unknown", false)).toBe("garment-incomplete")
    expect(await publishing.setProductHidden("tee", false)).toMatchObject({ status: "saved" })
    expect(await garment(1317)).toMatchObject({ shownCount: 1 })
  })
})
