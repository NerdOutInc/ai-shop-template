// @vitest-environment node
import { randomUUID } from "node:crypto"

import { Pool, type PoolClient } from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { applyAllMigrations } from "../../../test/apply-all-migrations"
import { createAdminDatabaseFixture } from "../../../test/create-admin-database-fixture"
import { createRuntimeLoginPool } from "../../../test/create-runtime-login-pool"

import type { LibraryDesignInput } from "./library-types"

import { createPostgresLibraryStore } from "./postgres-library-store.server"

vi.mock("server-only", () => ({}))
vi.mock("@/features/admin/get-admin-database.server", () => ({ getAdminDatabase: vi.fn() }))
const databaseUrl = process.env.LIBRARY_TEST_DATABASE_URL

function design(number?: number, hash = randomUUID().replaceAll("-", "").repeat(2)): LibraryDesignInput {
  const id = randomUUID(),
    revisionId = randomUUID(),
    assetId = randomUUID()
  return {
    id,
    displayNumber: number,
    title: "Sample Character",
    family: "Funny",
    summary: "Tiny beard joke",
    mechanism: "Hidden joke",
    prompt: "Draw flat art",
    background: null,
    state: "active",
    collectionIds: ["test-collection"],
    revision: {
      id: revisionId,
      printReadiness: "needs-preparation",
      printNotes: null,
      widthInches: null,
      heightInches: null,
      nativePpi: null,
      assets: [
        {
          id: assetId,
          url: `/api/admin/assets/${assetId}`,
          kind: "original",
          status: "pending",
          pathname: null,
          sourcePath: "concepts/a.png",
          originalFilename: "a.png",
          mimeType: "image/png",
          width: 2,
          height: 2,
          bytes: 80,
          sha256: hash,
          pixelSha256: hash,
          perceptualHash: "0".repeat(16),
          hasAlpha: true,
          hasTransparency: false,
          enlarged: false,
        },
      ],
    },
  }
}

describe.skipIf(!databaseUrl)("durable private design library", () => {
  let pool: Pool, runtime: Pool, store: ReturnType<typeof createPostgresLibraryStore>
  const owner = randomUUID(),
    other = randomUUID(),
    normal = randomUUID()
  let first: LibraryDesignInput
  beforeAll(async () => {
    pool = await createAdminDatabaseFixture(databaseUrl!)
    await applyAllMigrations(pool)
    // The store runs as the production login so privileges and policies are real, not superuser defaults.
    runtime = await createRuntimeLoginPool(pool, databaseUrl!)
    for (const id of [owner, other, normal])
      await pool.query("insert into auth.users(id,email,email_confirmed_at) values ($1,'library@example.test',now())", [
        id,
      ])
    for (const id of [owner, other]) await pool.query("insert into public.admin_memberships(user_id) values ($1)", [id])
    store = createPostgresLibraryStore({ database: runtime })
    await store.createCollection(owner, { id: "test-collection", title: "Test collection", description: null })
    first = design(149)
    await store.saveDesign(owner, first)
  })
  afterAll(async () => {
    await runtime?.end()
    await pool?.end()
  })
  it("allocates permanent numbers atomically for concurrent new designs", async () => {
    const designs = [design(), design()]
    await Promise.all(designs.map((input) => store.saveDesign(owner, input)))
    const rows = (
      await pool.query<{ display_number: string }>(
        "select display_number from public.library_designs where id=any($1::uuid[])",
        [designs.map((input) => input.id)]
      )
    ).rows
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((row) => row.display_number)).size).toBe(2)
    const saved = rows.map((row) => Number(row.display_number))
    await Promise.all(designs.map((input) => store.saveDesign(owner, input)))
    expect(
      (
        await pool.query<{ display_number: string }>(
          "select display_number from public.library_designs where id=any($1::uuid[])",
          [designs.map((input) => input.id)]
        )
      ).rows
        .map((row) => Number(row.display_number))
        .sort()
    ).toEqual(saved.sort())
  })
  it("rejects concurrent duplicate originals instead of admitting a second canonical design", async () => {
    const hash = randomUUID().replaceAll("-", "").repeat(2)
    const results = await Promise.allSettled([
      store.saveDesign(owner, design(undefined, hash)),
      store.saveDesign(owner, design(undefined, hash)),
    ])
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
    expect(
      (
        await pool.query(
          "select distinct canonical_design_id from public.library_artwork_fingerprints where fingerprint=$1",
          [hash]
        )
      ).rows
    ).toHaveLength(1)
  })
  it("serves assets with current membership and session state in one read", async () => {
    const sessionId = randomUUID()
    const assetId = first.revision.assets[0]!.id
    await pool.query("insert into auth.sessions(id,user_id) values ($1,$2)", [sessionId, owner])
    const query = vi.spyOn(runtime, "query")
    expect((await store.getAsset(owner, assetId, sessionId))?.id).toBe(assetId)
    expect(query).toHaveBeenCalledTimes(1)
    query.mockRestore()
    expect(await store.getAsset(owner, randomUUID(), sessionId)).toBeNull()
    await expect(store.getAsset(other, assetId, sessionId)).rejects.toMatchObject({ code: "FORBIDDEN" })
    await pool.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1", [sessionId])
    await expect(store.getAsset(owner, assetId, sessionId)).rejects.toMatchObject({ code: "FORBIDDEN" })
    await pool.query("delete from auth.sessions where id=$1", [sessionId])
    await expect(store.getAsset(owner, assetId, sessionId)).rejects.toMatchObject({ code: "FORBIDDEN" })
  })
  it("does not wait on an unrelated GoTrue user update to read an asset", async () => {
    const client = await pool.connect()
    try {
      await client.query("begin")
      await client.query("select id from auth.users where id=$1 for update", [owner])
      const reader = new Pool({ connectionString: databaseUrl!, statement_timeout: 500 })
      try {
        const readingStore = createPostgresLibraryStore({ database: reader })
        expect((await readingStore.getAsset(owner, first.revision.assets[0]!.id))?.id).toBe(
          first.revision.assets[0]!.id
        )
      } finally {
        await reader.end()
      }
    } finally {
      await client.query("rollback")
      client.release()
    }
  })
  async function asUser<T>(userId: string, work: (client: PoolClient) => Promise<T>, role = "authenticated") {
    const client = await pool.connect()
    try {
      await client.query("begin")
      await client.query(`set local role ${role}`)
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId])
      return await work(client)
    } finally {
      await client.query("rollback")
      client.release()
    }
  }
  it.each([
    ["unconfirmed", "email_confirmed_at=null"],
    ["anonymous", "is_anonymous=true"],
    ["banned", "banned_until=now()+interval '1 day'"],
  ])("denies privileged reads and writes plus direct RLS access for a currently %s admin", async (_name, update) => {
    const userId = randomUUID()
    await pool.query("insert into auth.users(id,email,email_confirmed_at) values($1,'restricted@example.test',now())", [
      userId,
    ])
    await pool.query("insert into public.admin_memberships(user_id) values($1)", [userId])
    expect(await store.getDesign(userId, 149)).not.toBeNull()
    await asUser(userId, async (client) => {
      expect((await client.query("select * from public.library_designs")).rows.length).toBeGreaterThan(0)
      await pool.query(`update auth.users set ${update} where id=$1`, [userId])
      expect((await client.query("select * from public.library_designs")).rows).toHaveLength(0)
      await expect(
        client.query("insert into public.library_favorites(user_id,design_id,revision_id) values($1,$2,$3)", [
          userId,
          first.id,
          first.revision.id,
        ])
      ).rejects.toMatchObject({ code: "42501" })
    })
    await expect(store.getDesign(userId, 149)).rejects.toMatchObject({ code: "FORBIDDEN" })
    await expect(
      store.createCollection(userId, { id: randomUUID(), title: "Denied", description: null })
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
  })
  it("keeps unfinished collections out of the gallery while retained history can inspect them", async () => {
    await store.createCollection(owner, { id: "generating", title: "A new exploration", description: null })
    await pool.query("update public.library_collections set review_state='draft' where id='generating'")
    const candidate = { ...design(), collectionIds: ["generating"] }
    await store.saveDesign(owner, candidate)
    const number = Number(
      (await pool.query("select display_number from public.library_designs where id=$1", [candidate.id])).rows[0]
        .display_number
    )
    expect(await store.getDesign(owner, number)).toBeNull()
    expect((await store.getDesign(owner, number, { includePending: true }))?.id).toBe(candidate.id)
    expect((await store.listCollections(owner)).some((collection) => collection.id === "generating")).toBe(false)
    expect(
      (await store.listDesigns(owner, { includePending: true })).designs.some((item) => item.id === candidate.id)
    ).toBe(true)
    await pool.query("update public.library_collections set review_state='ready' where id='generating'")
    expect((await store.getDesign(owner, number))?.id).toBe(candidate.id)
  })

  it("assesses verified print files once without replacing the favorited artwork revision", async () => {
    const candidate = design()
    const printId = randomUUID()
    candidate.revision.assets.push({
      ...candidate.revision.assets[0]!,
      id: printId,
      url: `/api/admin/assets/${printId}`,
      kind: "print",
      hasTransparency: true,
      sha256: "a".repeat(64),
      pixelSha256: "b".repeat(64),
    })
    await store.saveDesign(owner, candidate)
    await store.setFavorite(owner, { designId: candidate.id, revisionId: candidate.revision.id, selected: true })
    const assessment = {
      revisionId: candidate.revision.id,
      widthInches: 1,
      heightInches: 1,
      nativePpi: 2,
      notes: "Tiny synthetic fixture, not real print artwork.",
    }
    await expect(store.finalizePrintAssessment(owner, assessment)).rejects.toThrow("Upload and verify")
    for (const asset of candidate.revision.assets)
      await store.finalizeAsset(owner, {
        assetId: asset.id,
        pathname: `concepts/${asset.id}/${asset.sha256}.png`,
        sha256: asset.sha256!,
        pixelSha256: asset.pixelSha256!,
        bytes: asset.bytes!,
      })
    await expect(store.finalizePrintAssessment(owner, { ...assessment, nativePpi: 300 })).rejects.toThrow(
      "source dimensions"
    )
    await store.finalizePrintAssessment(owner, assessment)
    await store.finalizePrintAssessment(owner, assessment)
    await expect(store.finalizePrintAssessment(owner, { ...assessment, widthInches: 0.5 })).rejects.toThrow(
      "different completed"
    )
    await store.saveDesign(owner, candidate)
    const saved = (await store.listDesigns(owner, { favoritesOnly: true })).designs.find(
      (item) => item.id === candidate.id
    )!
    expect(saved.favoriteRevisionId).toBe(candidate.revision.id)
    expect(saved.revision).toMatchObject({ id: candidate.revision.id, printReadiness: "ready", nativePpi: 2 })
    expect(
      (
        await pool.query("select assessed_by from public.library_artwork_revisions where id=$1", [
          candidate.revision.id,
        ])
      ).rows[0].assessed_by
    ).toBe(owner)
    await store.setFavorite(owner, { designId: candidate.id, revisionId: candidate.revision.id, selected: false })
  })

  it("pins each user's favorites to a revision, validates ownership, and keeps old selections", async () => {
    await store.setFavorite(owner, { designId: first.id, revisionId: first.revision.id, selected: true })
    expect((await store.getDesign(other, 149))?.favoriteRevisionId).toBeNull()
    const revised = {
      ...first,
      revision: {
        ...first.revision,
        id: randomUUID(),
        assets: first.revision.assets.map((asset) => {
          const id = randomUUID()
          return { ...asset, id, url: `/api/admin/assets/${id}` }
        }),
      },
    }
    await store.saveDesign(owner, revised)
    await store.selectRevision(owner, first.id, revised.revision.id)
    expect((await store.getDesign(owner, 149))?.favoriteRevisionId).toBe(first.revision.id)
    expect((await store.getDesign(owner, 149))?.revision?.id).toBe(revised.revision.id)
    await expect(
      store.setFavorite(other, { designId: randomUUID(), revisionId: first.revision.id, selected: true })
    ).rejects.toThrow("belong")
    const favorites = await store.listDesigns(owner, { favoritesOnly: true, limit: 1 })
    expect(favorites.total).toBe(1)
    expect(favorites.designs[0]?.id).toBe(first.id)
  })
  it("gives an existing design a prepared revision without disturbing an older favorite", async () => {
    const subject = design()
    await store.saveDesign(owner, subject)
    await store.setFavorite(owner, { designId: subject.id, revisionId: subject.revision.id, selected: true })
    const printId = randomUUID(),
      preparedId = randomUUID()
    await store.prepareRevision(owner, {
      designId: subject.id,
      revision: {
        id: preparedId,
        printReadiness: "unverified",
        printNotes: "Prepared transparent master.",
        widthInches: null,
        heightInches: null,
        nativePpi: null,
        assets: [
          {
            id: printId,
            url: `/api/admin/assets/${printId}`,
            kind: "print",
            status: "pending",
            mimeType: "image/png",
            width: 4200,
            height: 4800,
            bytes: 2_000_000,
            sha256: "c".repeat(64),
            pixelSha256: "d".repeat(64),
            perceptualHash: null,
            hasAlpha: true,
            hasTransparency: true,
            enlarged: true,
            pathname: null,
            sourcePath: null,
            originalFilename: "prepared-print.png",
          },
        ],
      },
    })
    const saved = (await store.listDesigns(owner, { limit: 200 })).designs.find((item) => item.id === subject.id)!
    expect(saved.revision?.id).toBe(preparedId)
    expect(saved.revision?.print?.status).toBe("pending")
    // A favorite pins the artwork it was saved against; preparation must not move it.
    expect(saved.favoriteRevisionId).toBe(subject.revision.id)
    expect(saved.revisions.map((item) => item.id)).toContain(subject.revision.id)
    expect((await store.getRevisionAsset(owner, preparedId, printId))?.id).toBe(printId)
    expect(await store.getRevisionAsset(owner, subject.revision.id, printId)).toBeNull()
    await expect(
      store.prepareRevision(owner, { designId: randomUUID(), revision: { ...subject.revision, id: randomUUID() } })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    await store.setFavorite(owner, { designId: subject.id, revisionId: subject.revision.id, selected: false })
  })

  it("keeps archived designs out of the library until they are asked for", async () => {
    const archived = design()
    await store.saveDesign(owner, archived)
    await store.setDesignState(owner, archived.id, "archived")
    const visible = async (filter: Parameters<typeof store.listDesigns>[1]) =>
      (await store.listDesigns(owner, { ...filter, limit: 200 })).designs.some((item) => item.id === archived.id)
    expect(await visible({})).toBe(false)
    expect(await visible({ designState: "archived" })).toBe(true)
    expect(await visible({ designState: "rejected" })).toBe(false)
    // The agent's duplicate check cannot avoid repeating an idea it is not allowed to see,
    // so library.search asks for every retained design.
    expect(await visible({ designState: "all" })).toBe(true)
    await store.setDesignState(owner, archived.id, "active")
    expect(await visible({})).toBe(true)
  })

  it("keeps an archived design in the owner's saved favorites", async () => {
    const shelved = design()
    await store.saveDesign(owner, shelved)
    await store.setFavorite(owner, { designId: shelved.id, revisionId: shelved.revision.id, selected: true })
    await store.setDesignState(owner, shelved.id, "archived")
    const saved = async (filter: Parameters<typeof store.listDesigns>[1]) =>
      (await store.listDesigns(owner, { favoritesOnly: true, limit: 200, ...filter })).designs.some(
        (item) => item.id === shelved.id
      )
    // The library hides it, but the agent's favorites command asks for every state: a
    // favorite the owner archived is still a favorite, and product creation must see it.
    expect(await saved({})).toBe(false)
    expect(await saved({ designState: "all" })).toBe(true)
    await store.setFavorite(owner, { designId: shelved.id, revisionId: shelved.revision.id, selected: false })
  })

  it("offers five garment colors per design and refuses a sixth until one is removed", async () => {
    const subject = design()
    await store.saveDesign(owner, subject)
    await store.setDesignColors(owner, {
      designId: subject.id,
      colors: [
        { name: "CVC Black", source: "printify" },
        { name: "CVC Cream", source: "printify" },
        { name: "CVC Sand", source: "assigned" },
        { name: "CVC Mint", source: "assigned" },
      ],
    })
    const read = async () =>
      (await store.listDesigns(owner, { limit: 200 })).designs.find((item) => item.id === subject.id)!.colors
    expect(await read()).toHaveLength(4)
    await store.promoteDesignColor(owner, { designId: subject.id, colorName: "CVC Royal" })
    // Promoting the same colour twice is the same decision, not a second slot.
    await store.promoteDesignColor(owner, { designId: subject.id, colorName: "CVC Royal" })
    await expect(
      store.promoteDesignColor(owner, { designId: subject.id, colorName: "CVC Orange" })
    ).rejects.toMatchObject({ code: "CONFLICT" })
    await expect(
      store.promoteDesignColor(owner, { designId: subject.id, colorName: "Vermilion Shrug" })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" })
    await store.removeDesignColor(owner, { designId: subject.id, colorName: "CVC Mint" })
    await store.promoteDesignColor(owner, { designId: subject.id, colorName: "CVC Orange" })
    const colors = await read()
    expect(colors.map((color) => color.name).toSorted()).toEqual([
      "CVC Black",
      "CVC Cream",
      "CVC Orange",
      "CVC Royal",
      "CVC Sand",
    ])
    expect(new Set(colors.map((color) => color.position)).size).toBe(5)
    await expect(store.removeDesignColor(owner, { designId: subject.id, colorName: "CVC Mint" })).rejects.toMatchObject(
      { code: "NOT_FOUND" }
    )
  })

  it("saves the garment a favorite was judged on and refuses one outside the palette", async () => {
    const subject = design()
    await store.saveDesign(owner, subject)
    await store.setFavorite(owner, {
      designId: subject.id,
      revisionId: subject.revision.id,
      selected: true,
      colorName: "CVC Espresso",
    })
    const saved = (await store.listDesigns(owner, { favoritesOnly: true, limit: 200 })).designs.find(
      (item) => item.id === subject.id
    )!
    expect(saved.favoriteColorName).toBe("CVC Espresso")
    await expect(
      store.setFavorite(owner, {
        designId: subject.id,
        revisionId: subject.revision.id,
        selected: true,
        colorName: "Chartreuse Regret",
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" })
    await store.setFavorite(owner, { designId: subject.id, revisionId: subject.revision.id, selected: false })
  })

  it("does not let a stale device remove a newer favorite revision", async () => {
    const newerRevision = (await store.getDesign(owner, 149))!.revision!.id
    const secondDevice = createPostgresLibraryStore({ database: runtime })
    await secondDevice.setFavorite(owner, { designId: first.id, revisionId: newerRevision, selected: true })
    await expect(
      store.setFavorite(owner, { designId: first.id, revisionId: first.revision.id, selected: false })
    ).rejects.toThrow("newer favorite")
    expect((await secondDevice.getDesign(owner, 149))?.favoriteRevisionId).toBe(newerRevision)
  })

  it("protects personal favorites with RLS and current membership on read, insert, update and delete", async () => {
    expect(
      await asUser(other, async (client) => (await client.query("select * from public.library_favorites")).rows)
    ).toHaveLength(0)
    await expect(
      asUser(other, (client) =>
        client.query("insert into public.library_favorites(user_id,design_id,revision_id) values($1,$2,$3)", [
          owner,
          first.id,
          first.revision.id,
        ])
      )
    ).rejects.toThrow(/row-level security/)
    expect(
      await asUser(
        other,
        async (client) =>
          (await client.query("delete from public.library_favorites where user_id=$1", [owner])).rowCount
      )
    ).toBe(0)
    expect(
      await asUser(owner, async (client) => (await client.query("select * from public.library_favorites")).rows)
    ).toHaveLength(1)
    await expect(
      asUser(owner, (client) =>
        client.query("update public.library_favorites set user_id=$1 where user_id=$2", [other, owner])
      )
    ).rejects.toThrow(/row-level security/)
    await pool.query("update public.admin_memberships set active=false where user_id=$1", [owner])
    try {
      expect(
        await asUser(owner, async (client) => (await client.query("select * from public.library_favorites")).rows)
      ).toHaveLength(0)
      expect(
        await asUser(owner, async (client) => (await client.query("delete from public.library_favorites")).rowCount)
      ).toBe(0)
      await expect(
        asUser(owner, (client) =>
          client.query("insert into public.library_favorites(user_id,design_id,revision_id) values($1,$2,$3)", [
            owner,
            first.id,
            first.revision.id,
          ])
        )
      ).rejects.toThrow(/row-level security/)
      await expect(store.getDesign(owner, 149)).rejects.toThrow("administrator")
    } finally {
      await pool.query("update public.admin_memberships set active=true where user_id=$1", [owner])
    }
  })
  it("denies anonymous/normal users and direct private asset or core writes", async () => {
    await expect(store.listDesigns(normal)).rejects.toThrow("administrator")
    expect(
      await asUser(normal, async (client) => (await client.query("select * from public.library_designs")).rows)
    ).toHaveLength(0)
    await expect(asUser(owner, (client) => client.query("select * from public.library_assets"))).rejects.toThrow(
      /permission denied/
    )
    await expect(asUser(owner, (client) => client.query("delete from public.library_designs"))).rejects.toThrow(
      /permission denied/
    )
    await expect(
      asUser(owner, (client) => client.query("select * from public.library_designs"), "anon")
    ).rejects.toThrow(/permission denied/)
  })
  it("finalizes only exact verified assets and hides private location fields in gallery DTOs", async () => {
    const asset = first.revision.assets[0]!
    await expect(
      store.finalizeAsset(owner, {
        assetId: asset.id,
        pathname: "public/anything.png",
        sha256: asset.sha256!,
        pixelSha256: asset.pixelSha256!,
        bytes: 80,
      })
    ).rejects.toThrow("pathname")
    const pathname = `concepts/${asset.id}/${asset.sha256}.png`
    await expect(
      store.finalizeAsset(owner, {
        assetId: asset.id,
        pathname,
        sha256: "0".repeat(64),
        pixelSha256: asset.pixelSha256!,
        bytes: 80,
      })
    ).rejects.toThrow("match")
    await store.finalizeAsset(owner, {
      assetId: asset.id,
      pathname,
      sha256: asset.sha256!,
      pixelSha256: asset.pixelSha256!,
      bytes: 80,
    })
    expect((await store.getAsset(owner, asset.id))?.pathname).toBe(pathname)
    const dto = JSON.stringify(await store.getDesign(owner, 149))
    expect(dto).not.toContain("sourcePath")
    expect(dto).not.toContain("pathname")
    expect(dto).not.toContain("concepts/a.png")
  })
  it("recovers an unavailable source into its same asset identity without replacing known bytes", async () => {
    const complete = design(),
      missing = structuredClone(complete),
      asset = missing.revision.assets[0]!
    Object.assign(asset, {
      status: "unavailable",
      sha256: null,
      pixelSha256: null,
      perceptualHash: null,
      bytes: null,
      width: null,
      height: null,
      hasAlpha: null,
      hasTransparency: null,
    })
    await store.saveDesign(owner, missing)
    await store.saveDesign(owner, complete)
    expect((await store.getAsset(owner, asset.id))?.status).toBe("pending")
    const changed = structuredClone(complete)
    changed.revision.assets[0]!.sha256 = "e".repeat(64)
    await expect(store.saveDesign(owner, changed)).rejects.toThrow("different bytes")
  })
  it("searches the full library safely and returns global facet options", async () => {
    await pool.query(
      "insert into public.library_product_bindings(canonical_design_id,shop_id,product_model_id,product_model_label,status) values($1,'12345','printify-blueprint:1317','Next Level 6210','reserved')",
      [first.id]
    )
    expect((await store.listDesigns(owner, { search: "Beard", family: "Funny", limit: 1 })).total).toBeGreaterThan(0)
    expect((await store.listDesigns(owner, { search: "%' OR true --" })).total).toBe(0)
    expect(await store.listFilterOptions(owner)).toMatchObject({
      families: ["Funny"],
      productModels: [{ id: "printify-blueprint:1317", label: "Next Level 6210" }],
    })
  })
})
