// @vitest-environment node
import { randomBytes, randomUUID } from "node:crypto"
import type { Pool } from "pg"
import sharp from "sharp"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { applyAllMigrations } from "../../../test/apply-all-migrations"
import { createAdminDatabaseFixture } from "../../../test/create-admin-database-fixture"
import { createRuntimeLoginPool } from "../../../test/create-runtime-login-pool"
import { inspectLibraryImage } from "@/features/design-library/inspect-library-image.server"
import type { LibraryDesignInput, LibraryStoredAsset } from "@/features/design-library/library-types"
import { createPostgresLibraryStore } from "@/features/design-library/postgres-library-store.server"
import type { DesignDraftClient, DesignDraftInput, DesignProductPayload } from "./design-draft-types"
import { DesignDraftError } from "./design-draft-error"
import { getDesignDraftServices } from "./get-design-draft-services.server"
import { PostgresDesignDraftStore } from "./postgres-design-draft-store.server"
import { readProviderArtworkCapability } from "./read-provider-artwork-capability.server"
import { productArtworkFingerprint } from "./product-artwork-fingerprint"
import { readApprovedProductArtwork } from "./read-approved-product-artwork.server"
import { resolvePublishedProductArtwork } from "./resolve-published-product-artwork.server"
import { markDesignProductPublished } from "./mark-design-product-published.server"
import { markDesignProductRemoved } from "./mark-design-product-removed.server"
import { markDesignProductUnverified } from "./mark-design-product-unverified.server"

vi.mock("server-only", () => ({}))
vi.mock("@/features/admin/get-admin-database.server", () => ({ getAdminDatabase: vi.fn() }))
vi.mock("@/features/design-library/read-private-asset.server", () => ({ readPrivateAsset: vi.fn() }))
vi.mock("@/lib/env", () => ({ env: { PRINTIFY_API_TOKEN: "fulfillment-only", PRINTIFY_SHOP_ID: "12345" } }))
// The published catalog policies admit only this store's Printify shop, so drafts use its real id.
const databaseUrl = process.env.DRAFTS_TEST_DATABASE_URL

function providerProduct(payload: DesignProductPayload, id: string): Record<string, unknown> {
  return {
    ...payload,
    id,
    shop_id: 12345,
    is_locked: false,
    visible: true,
    external: null,
    images: [],
    options: [
      {
        values: [
          { id: 1, title: "Black" },
          { id: 2, title: "M" },
        ],
      },
    ],
    variants: payload.variants.map((variant) => ({ ...variant, is_available: true, options: [1, 2] })),
  }
}

describe.skipIf(!databaseUrl)("durable design drafts and original artwork provenance", () => {
  let database: Pool,
    runtime: Pool,
    library: ReturnType<typeof createPostgresLibraryStore>,
    bytes: Buffer,
    asset: LibraryStoredAsset,
    design: LibraryDesignInput
  let provider: DesignDraftClient,
    products: Record<string, unknown>[],
    input: DesignDraftInput,
    active: boolean,
    services: ReturnType<typeof getDesignDraftServices>,
    uploadTokens: string[],
    imageId: string
  const userId = randomUUID(),
    grantId = randomUUID(),
    other = randomUUID()
  beforeAll(async () => {
    database = await createAdminDatabaseFixture(databaseUrl!)
    await applyAllMigrations(database)
    // Stores run as the production login so privileges and policies are real, not superuser defaults.
    runtime = await createRuntimeLoginPool(database, databaseUrl!)
    for (const id of [userId, other]) {
      await database.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [
        id,
        `${id}@example.test`,
      ])
      await database.query("insert into public.admin_memberships(user_id) values($1)", [id])
    }
    library = createPostgresLibraryStore({ database: runtime })
    await library.createCollection(userId, { id: "art", title: "Art", description: null })
  })
  afterAll(async () => {
    await runtime?.end()
    await database?.end()
  })
  beforeEach(async () => {
    vi.restoreAllMocks()
    // Tests isolate bindings, while keeping immutable artwork receipts as deliberate history.
    await database.query(
      "delete from private.design_draft_write_receipts; delete from private.design_product_candidates; delete from private.design_provider_source_evidence; delete from private.design_provider_capabilities; delete from private.design_product_attempts; delete from private.design_draft_items; delete from private.design_draft_requests; delete from public.library_product_bindings; delete from public.library_favorites"
    )
    const color = randomBytes(3)
    bytes = await sharp(Buffer.from([...color, 255, 0, 0, 0, 0, ...color, 255, 0, 0, 0, 0]), {
      raw: { width: 2, height: 2, channels: 4 },
    })
      .png()
      .toBuffer()
    const inspected = await inspectLibraryImage(bytes)
    const revisionId = randomUUID(),
      id = randomUUID()
    const assets = ["original", "print"].map((kind) => {
      const assetId = randomUUID()
      return {
        id: assetId,
        url: `/api/admin/assets/${assetId}`,
        kind: kind as "original" | "print",
        status: "ready" as const,
        pathname: `concepts/${assetId}/${inspected.sha256}.png`,
        sourcePath: null,
        originalFilename: "art.png",
        ...inspected,
        enlarged: false,
      }
    })
    asset = assets[1]!
    design = {
      id,
      title: "Good holds",
      family: "Funny",
      summary: "Joke",
      mechanism: "Climbing",
      prompt: "Flat",
      background: null,
      state: "active",
      collectionIds: ["art"],
      revision: {
        id: revisionId,
        assets,
        printReadiness: "ready",
        printNotes: "Inspected",
        widthInches: 1,
        heightInches: 1,
        nativePpi: 2,
      },
    }
    // Each test supplies distinct fixture bytes, using the normal fresh-design path.
    await library.saveDesign(userId, design)
    products = []
    active = true
    uploadTokens = []
    imageId = randomUUID()
    provider = {
      shopId: "12345",
      validateRecipe: vi.fn(async () => {}),
      listProducts: vi.fn(async () => structuredClone(products)),
      getProduct: vi.fn(async (id) => structuredClone(products.find((p) => p.id === id) ?? null)),
      uploadImage: vi.fn(async ({ url }) => {
        const token = new URL(url).pathname.split("/").at(-1)!
        uploadTokens.push(token)
        const found = await readProviderArtworkCapability(token, {
          database: runtime,
          authorize: async () => {
            if (!active) throw new Error("revoked")
          },
        })
        expect(found?.id).toBe(asset.id)
        return { id: imageId, width: 2, height: 2, mimeType: "image/png" }
      }),
      createProduct: vi.fn(async (payload) => {
        const id = randomUUID()
        products.push(providerProduct(payload, id))
        return { id }
      }),
    }
    services = getDesignDraftServices({
      userId,
      grantId,
      database: runtime,
      client: provider,
      authorize: async () => {
        if (!active) throw new Error("revoked")
      },
      readAssetBytes: async () => bytes,
      siteUrl: new URL("http://localhost:3000"),
      readArtworkSource: async () => bytes,
    })
    input = {
      requestId: randomUUID(),
      selection: { kind: "revisions", items: [{ designId: id, revisionId }] },
      recipe: {
        blueprintId: 145,
        productModelLabel: "Next Level 6210",
        printProviderId: 99,
        variants: [{ id: 1, price: 2500, color: "Black", size: "M" }],
        placement: { position: "front", x: 0.5, y: 0.5, scale: 1, angle: 0 },
        description: "Everyday tee",
        titleTemplate: "{title}",
      },
    }
  })
  it("concurrent same-model requests create one draft, and another model remains allowed", async () => {
    const [a, b] = await Promise.all([services.create(input), services.create({ ...input, requestId: randomUUID() })])
    expect(provider.createProduct).toHaveBeenCalledTimes(1)
    expect([...a.results, ...b.results].some((r) => r.status === "draft")).toBe(true)
    expect((await services.create(input)).results[0]?.status).toBe("draft")
    await services.create({
      ...input,
      requestId: randomUUID(),
      recipe: { ...input.recipe, blueprintId: 999, productModelLabel: "Other blank" },
    })
    expect(provider.createProduct).toHaveBeenCalledTimes(2)
  })
  it("retains exact requested revisions and personal favorites across other owner choices", async () => {
    await library.setFavorite(userId, { designId: design.id, revisionId: design.revision.id, selected: true })
    await library.setFavorite(other, { designId: design.id, revisionId: design.revision.id, selected: true })
    const favorites = { ...input, selection: { kind: "favorites" as const } }
    const result = await services.create(favorites)
    await library.setFavorite(userId, { designId: design.id, revisionId: design.revision.id, selected: false })
    expect((await services.create(favorites)).results).toEqual(result.results)
    await expect(
      services.create({ ...favorites, recipe: { ...input.recipe, description: "changed" } })
    ).rejects.toThrow("different")
  })
  it("cannot bypass a revision mismatch using provider, color, pricing or title changes", async () => {
    await services.create(input)
    const next = {
      ...design,
      revision: {
        ...design.revision,
        id: randomUUID(),
        assets: design.revision.assets.map((value) => {
          const id = randomUUID()
          return { ...value, id, url: `/api/admin/assets/${id}`, pathname: `concepts/${id}/${value.sha256}.png` }
        }),
      },
    }
    await library.saveDesign(userId, next)
    const result = await services.create({
      ...input,
      requestId: randomUUID(),
      selection: { kind: "revisions", items: [{ designId: design.id, revisionId: next.revision.id }] },
      recipe: { ...input.recipe, printProviderId: 77, description: "another price" },
    })
    expect(result.results[0]?.status).toBe("revision-mismatch")
    expect(result.results[0]?.boundRevisionId).toBe(design.revision.id)
    expect(provider.createProduct).toHaveBeenCalledTimes(1)
  })
  // Agents build a recipe per design, so they need to tell "my recipe made this draft" from "an
  // earlier draft was reused": both answer `draft`, and only the owning request differs.
  it("answers other colors for a drafted revision with the first draft, and names the request that made it", async () => {
    const first = await services.create(input)
    expect(first.results[0]).toMatchObject({ status: "draft", owningRequestId: input.requestId })
    const created = structuredClone(products)
    const second = await services.create({
      ...input,
      requestId: randomUUID(),
      recipe: { ...input.recipe, variants: [{ id: 2, price: 2500, color: "Sand", size: "M" }] },
    })
    expect(second).toMatchObject({ pending: 0 })
    expect(second.results[0]).toMatchObject({
      status: "draft",
      productId: first.results[0]!.productId,
      owningRequestId: input.requestId,
    })
    expect(provider.createProduct).toHaveBeenCalledTimes(1)
    expect(products).toEqual(created)
  })
  it("keeps published products linked to their actual revision without a provider write", async () => {
    await services.create(input)
    await database.query("update public.library_product_bindings set status='published',storefront_url='/shop/actual'")
    const result = await services.create({ ...input, requestId: randomUUID() })
    expect(result.results[0]).toMatchObject({
      status: "published",
      boundRevisionId: design.revision.id,
      storefrontUrl: "/shop/actual",
    })
    expect(provider.createProduct).toHaveBeenCalledTimes(1)
  })
  it("does not retry product creation after a lost successful response", async () => {
    vi.mocked(provider.createProduct).mockImplementationOnce(async (payload) => {
      products.push(providerProduct(payload, "lost-reply"))
      throw new Error("timeout secret response")
    })
    expect((await services.create(input)).results[0]?.status).toBe("needs-reconciliation")
    expect((await services.create(input)).results[0]?.status).toBe("needs-reconciliation")
    expect(provider.createProduct).toHaveBeenCalledTimes(1)
    expect((await services.reconcile({ requestId: input.requestId })).results[0]).toMatchObject({
      status: "draft",
      productId: "lost-reply",
    })
  })
  it("recovers a failed verified receipt save without another product create", async () => {
    vi.spyOn(PostgresDesignDraftStore.prototype, "verify").mockRejectedValueOnce(new Error("database connection lost"))
    expect((await services.create(input)).results[0]?.status).toBe("needs-reconciliation")
    expect((await services.reconcile({ requestId: input.requestId })).results[0]?.status).toBe("draft")
    expect(provider.createProduct).toHaveBeenCalledTimes(1)
  })
  it("keeps no-match and ambiguous matches blocked even after the creating lease expires", async () => {
    vi.mocked(provider.createProduct).mockRejectedValueOnce(new Error("timeout"))
    await services.create(input)
    await database.query("update private.design_product_attempts set lease_expires_at=now()-interval '1 hour'")
    expect((await services.reconcile({ requestId: input.requestId })).results[0]?.status).toBe("needs-reconciliation")
    const payload = (await database.query("select product_payload from private.design_product_attempts")).rows[0]
      .product_payload as DesignProductPayload
    products.push(providerProduct(payload, "ambiguous-a"), providerProduct(payload, "ambiguous-b"))
    expect((await services.reconcile({ requestId: input.requestId })).results[0]?.status).toBe("needs-reconciliation")
    expect(provider.createProduct).toHaveBeenCalledTimes(1)
  })
  it("a lost image response permits only image reupload and revokes its original capability", async () => {
    vi.mocked(provider.uploadImage).mockImplementationOnce(async ({ url }) => {
      uploadTokens.push(new URL(url).pathname.split("/").at(-1)!)
      throw new Error("timeout")
    })
    await expect(services.create(input)).rejects.toThrow("unused provider image")
    expect(provider.createProduct).not.toHaveBeenCalled()
    expect(await readProviderArtworkCapability(uploadTokens[0]!, { database, authorize: async () => {} })).toBeNull()
    expect((await services.create(input)).results[0]?.status).toBe("draft")
    expect(provider.uploadImage).toHaveBeenCalledTimes(2)
    expect(provider.createProduct).toHaveBeenCalledTimes(1)
  })
  it("matches an existing same-image same-model draft before any product POST", async () => {
    vi.mocked(provider.listProducts).mockImplementationOnce(async () => {
      const payload: DesignProductPayload = {
        title: design.title,
        description: input.recipe.description,
        blueprint_id: 145,
        print_provider_id: 99,
        variants: [{ id: 1, price: 2500, is_enabled: true }],
        print_areas: [
          {
            variant_ids: [1],
            placeholders: [{ position: "front", images: [{ id: imageId, x: 0.5, y: 0.5, scale: 1, angle: 0 }] }],
          },
        ],
      }
      products.push(providerProduct(payload, "existing"))
      return structuredClone(products)
    })
    expect((await services.create(input)).results[0]).toMatchObject({ status: "draft", productId: "existing" })
    expect(provider.createProduct).not.toHaveBeenCalled()
  })
  it("capabilities expire, require current membership/grant, and cannot substitute another asset", async () => {
    const store = new PostgresDesignDraftStore(runtime, userId, grantId, "12345")
    await store.freeze(input)
    const operation = (await store.next(input.requestId))!
    const token = await store.issueCapability(operation)
    const read = () =>
      readProviderArtworkCapability(token, {
        database: runtime,
        authorize: async () => {
          if (!active) throw new Error("revoked")
        },
      })
    expect((await read())?.id).toBe(asset.id)
    active = false
    await expect(read()).rejects.toThrow("revoked")
    active = true
    await database.query("update public.admin_memberships set active=false where user_id=$1", [userId])
    expect(await read()).toBeNull()
    await database.query("update public.admin_memberships set active=true where user_id=$1", [userId])
    await database.query("update private.design_provider_capabilities set asset_sha256=$1", ["0".repeat(64)])
    expect(await read()).toBeNull()
    await database.query(
      "update private.design_provider_capabilities set asset_sha256=$1,expires_at=now()-interval '1 second'",
      [asset.sha256]
    )
    expect(await read()).toBeNull()
  })
  it("stale upload workers cannot revoke the successor's capability or save its receipt", async () => {
    const store = new PostgresDesignDraftStore(runtime, userId, grantId, "12345")
    await store.freeze(input)
    const first = (await store.next(input.requestId))!
    await store.issueCapability(first)
    await database.query("update private.design_product_attempts set lease_expires_at=now()-interval '1 second'")
    const second = (await store.next(input.requestId))!,
      token = await store.issueCapability(second)
    expect(await store.saveUpload(first, "stale-image")).toBe(false)
    await store.retryUpload(first)
    await store.attention(first, "STALE")
    expect((await readProviderArtworkCapability(token, { database, authorize: async () => {} }))?.id).toBe(asset.id)
  })
  it("never claims an opaque or changed prepared source is verified", async () => {
    const bad = getDesignDraftServices({
      userId,
      grantId,
      database: runtime,
      client: provider,
      authorize: async () => {},
      readAssetBytes: async () => Buffer.from("invalid image"),
    })
    await expect(bad.create(input)).rejects.toThrow("could not be confirmed")
    expect(provider.uploadImage).not.toHaveBeenCalled()
    expect(provider.createProduct).not.toHaveBeenCalled()
  })
  it("blocks a binding until the full transparent original is verified", async () => {
    await services.create(input)
    const product = products[0]!,
      binding = (await database.query("select id from public.library_product_bindings")).rows[0].id as string
    await database.query("update public.library_product_bindings set status='unverified',verified_at=null")
    expect((await services.create({ ...input, requestId: randomUUID() })).results[0]?.status).toBe(
      "needs-reconciliation"
    )
    const areas = product.print_areas as DesignProductPayload["print_areas"]
    Object.assign(areas[0]!.placeholders[0]!.images[0]!, { src: "https://images.printify.com/full-original.png" })
    expect((await services.reconcileBinding({ bindingId: binding })).status).toBe("draft")
    expect(provider.createProduct).toHaveBeenCalledTimes(1)
  })
  it("records immutable approved art and guards published/removed badges with the current snapshot", async () => {
    await services.create(input)
    const product = products[0]!,
      productId = String(product.id),
      productionFingerprint = productArtworkFingerprint(product, { shopId: "12345", productId })!
    expect(
      (await readApprovedProductArtwork({ shopId: "12345", productId, productionFingerprint }, database))?.printAsset.id
    ).toBe(asset.id)
    await expect(
      database.query("update commerce.design_product_artwork set print_sha256=$1 where product_id=$2", [
        "0".repeat(64),
        productId,
      ])
    ).rejects.toThrow("immutable")
    const mark = {
      shopId: "12345",
      productId,
      revisionId: design.revision.id,
      productionFingerprint,
      storefrontUrl: "/shop/verified",
    }
    expect(await markDesignProductPublished(mark, database)).toBe(false)
    await database.query(
      "insert into commerce.printify_products(shop_id,product_id,active,snapshot) values('12345',$1,true,$2)",
      [productId, { storefront_artwork: { revisionId: design.revision.id, productionFingerprint } }]
    )
    expect(await markDesignProductPublished(mark, database)).toBe(true)
    expect(await markDesignProductRemoved(mark, database)).toBe(false)
    expect(await markDesignProductUnverified(mark, database)).toBe(false)
    await database.query("update commerce.printify_products set snapshot='{}' where product_id=$1", [productId])
    expect(await markDesignProductUnverified(mark, database)).toBe(true)
    expect(await markDesignProductPublished(mark, database)).toBe(false)
    await database.query("update commerce.printify_products set active=false where product_id=$1", [productId])
    expect(await markDesignProductRemoved(mark, database)).toBe(true)
  })
  it("aborts a stalled private read before any provider write", async () => {
    const controller = new AbortController()
    const slow = getDesignDraftServices({
      userId,
      grantId,
      database: runtime,
      client: provider,
      authorize: async () => {},
      signal: controller.signal,
      readAssetBytes: async () => {
        controller.abort(new Error("fixture deadline"))
        return new Promise<Buffer>(() => {})
      },
    })
    await expect(slow.create(input)).rejects.toThrow("could not be confirmed")
    expect(provider.uploadImage).not.toHaveBeenCalled()
    expect(provider.createProduct).not.toHaveBeenCalled()
  })
  it("a deadline after product submission remains uncertain and only GET recovery may follow", async () => {
    const controller = new AbortController()
    vi.mocked(provider.createProduct).mockImplementationOnce(async (payload) => {
      products.push(providerProduct(payload, "slow-success"))
      controller.abort(new Error("fixture deadline"))
      return new Promise<{ id: string }>(() => {})
    })
    const timed = getDesignDraftServices({
      userId,
      grantId,
      database: runtime,
      client: provider,
      authorize: async () => {},
      signal: controller.signal,
      readAssetBytes: async () => bytes,
      siteUrl: new URL("http://localhost:3000"),
    })
    expect((await timed.create(input)).results[0]?.status).toBe("needs-reconciliation")
    expect((await services.reconcile({ requestId: input.requestId })).results[0]?.status).toBe("draft")
    expect(provider.createProduct).toHaveBeenCalledTimes(1)
  })
  it("does not mistake a full source for approval of layered or different artwork", async () => {
    await services.create(input)
    const binding = (await database.query("select id from public.library_product_bindings")).rows[0].id as string
    const product = products[0]!,
      areas = product.print_areas as DesignProductPayload["print_areas"]
    const image = areas[0]!.placeholders[0]!.images[0]!
    Object.assign(image, { src: "https://images.printify.com/full.png" })
    areas[0]!.placeholders[0]!.images.push({ ...image })
    expect((await services.reconcileBinding({ bindingId: binding })).status).toBe("needs-reconciliation")
    areas[0]!.placeholders[0]!.images.pop()
    const different = getDesignDraftServices({
      userId,
      grantId,
      database: runtime,
      client: provider,
      authorize: async () => {},
      readAssetBytes: async () => bytes,
      readArtworkSource: async () =>
        sharp({ create: { width: 2, height: 2, channels: 4, background: "blue" } })
          .png()
          .toBuffer(),
    })
    expect((await different.reconcileBinding({ bindingId: binding })).status).toBe("needs-reconciliation")
    expect(provider.createProduct).toHaveBeenCalledTimes(1)
  })
  it("never collapses two provider products into one verified binding", async () => {
    await services.create(input)
    const binding = (await database.query("select id from public.library_product_bindings")).rows[0].id as string
    products.push({ ...structuredClone(products[0]!), id: "duplicate" })
    expect((await services.reconcileBinding({ bindingId: binding })).status).toBe("needs-reconciliation")
  })
  it.each([
    "private.design_provider_capabilities",
    "private.design_draft_write_receipts",
    "private.design_product_attempts",
    "commerce.design_product_artwork",
  ])("hides %s from direct browser clients", async (table) => {
    const client = await database.connect()
    try {
      await client.query("begin; set local role authenticated")
      await expect(client.query(`select * from ${table}`)).rejects.toThrow("permission denied")
    } finally {
      await client.query("rollback")
      client.release()
    }
  })
  function requestedPayload(imageId: string): DesignProductPayload {
    return {
      title: design.title,
      description: input.recipe.description,
      blueprint_id: 145,
      print_provider_id: 99,
      variants: [{ id: 1, price: 2500, is_enabled: true }],
      print_areas: [
        {
          variant_ids: [1],
          placeholders: [{ position: "front", images: [{ id: imageId, x: 0.5, y: 0.5, scale: 1, angle: 0 }] }],
        },
      ],
    }
  }
  it("finds an untracked identical original under another upload ID without another product POST", async () => {
    const manual = providerProduct(requestedPayload("manual-upload"), "manual-product")
    Object.assign((manual.print_areas as DesignProductPayload["print_areas"])[0]!.placeholders[0]!.images[0]!, {
      src: "https://images.printify.com/manual-original.png",
    })
    products.push(manual)
    const result = await services.create(input)
    expect(result.results[0]).toMatchObject({ status: "draft", productId: "manual-product" })
    expect(provider.createProduct).not.toHaveBeenCalled()
    expect(
      (
        await database.query(
          "select printify_image_id from commerce.design_product_artwork where product_id='manual-product'"
        )
      ).rows[0]?.printify_image_id
    ).toBe("manual-upload")
  })
  it("resumes original inspection from durable evidence and only later returns pre-create work to ready", async () => {
    const differentBytes = await sharp(Buffer.from([0, 255, 0, 255, 0, 0, 0, 0, 0, 255, 0, 255, 0, 0, 0, 0]), {
      raw: { width: 2, height: 2, channels: 4 },
    })
      .png()
      .toBuffer()
    for (const suffix of ["first", "second"]) {
      const product = providerProduct(requestedPayload(`upload-${suffix}`), `product-${suffix}`)
      Object.assign((product.print_areas as DesignProductPayload["print_areas"])[0]!.placeholders[0]!.images[0]!, {
        src: `https://images.printify.com/${suffix}.png`,
      })
      products.push(product)
    }
    let available = false
    const readSource = vi.fn(async (src: string) => {
      if (src.endsWith("second.png") && !available) throw new Error("source temporary failure")
      return differentBytes
    })
    const scan = getDesignDraftServices({
      userId,
      grantId,
      database: runtime,
      client: provider,
      authorize: async () => {},
      readAssetBytes: async () => bytes,
      siteUrl: new URL("http://localhost:3000"),
      readArtworkSource: readSource,
    })
    const blocked = await scan.create(input)
    expect(blocked.results[0]?.blockingProductIds).toContain("product-second")
    expect(provider.createProduct).not.toHaveBeenCalled()
    available = true
    expect((await scan.reconcile({ requestId: input.requestId })).pending).toBe(1)
    expect((await scan.create(input)).results[0]?.status).toBe("draft")
    expect(readSource.mock.calls.filter(([src]) => src.endsWith("first.png"))).toHaveLength(1)
    expect(provider.createProduct).toHaveBeenCalledTimes(1)
  })
  it("does not recreate a previously proven matching product after it disappears", async () => {
    products.push(
      providerProduct(requestedPayload(imageId), "duplicate-a"),
      providerProduct(requestedPayload(imageId), "duplicate-b")
    )
    expect((await services.create(input)).results[0]?.status).toBe("needs-reconciliation")
    products = []
    expect((await services.reconcile({ requestId: input.requestId })).results[0]?.status).toBe("needs-reconciliation")
    await services.create(input)
    expect(provider.createProduct).not.toHaveBeenCalled()
  })
  it("preserves published A and its URL while a later provider draft B differs", async () => {
    await services.create(input)
    const product = products[0]!,
      productId = String(product.id),
      fingerprint = productArtworkFingerprint(product, { shopId: "12345", productId })!
    await database.query(
      "insert into commerce.printify_products(shop_id,product_id,active,snapshot) values('12345',$1,true,$2)",
      [productId, { storefront_artwork: { revisionId: design.revision.id, productionFingerprint: fingerprint } }]
    )
    await markDesignProductPublished(
      {
        shopId: "12345",
        productId,
        revisionId: design.revision.id,
        productionFingerprint: fingerprint,
        storefrontUrl: "/shop/published-a",
      },
      database
    )
    const binding = (await database.query("select id from public.library_product_bindings")).rows[0].id as string
    const image = (product.print_areas as DesignProductPayload["print_areas"])[0]!.placeholders[0]!.images[0]!
    Object.assign(image, { src: "https://images.printify.com/draft-b.png", x: 0.4 })
    await services.reconcileBinding({ bindingId: binding })
    expect(
      (
        await database.query(
          "select status,revision_id,storefront_url from public.library_product_bindings where id=$1",
          [binding]
        )
      ).rows[0]
    ).toMatchObject({ status: "published", revision_id: design.revision.id, storefront_url: "/shop/published-a" })
    const changed = getDesignDraftServices({
      userId,
      grantId,
      database: runtime,
      client: provider,
      authorize: async () => {},
      readAssetBytes: async () => bytes,
      readArtworkSource: async () => Buffer.from("different unsupported artwork"),
    })
    expect((await changed.reconcileBinding({ bindingId: binding })).status).toBe("needs-reconciliation")
    expect(
      (await database.query("select status,storefront_url from public.library_product_bindings where id=$1", [binding]))
        .rows[0]
    ).toMatchObject({ status: "published", storefront_url: "/shop/published-a" })
  })
  it("restores a missed published badge and URL from the pinned snapshot", async () => {
    await services.create(input)
    const product = products[0]!,
      productId = String(product.id),
      fingerprint = productArtworkFingerprint(product, { shopId: "12345", productId })!
    await database.query(
      "insert into commerce.printify_products(shop_id,product_id,active,snapshot) values('12345',$1,true,$2)",
      [productId, { storefront_artwork: { revisionId: design.revision.id, productionFingerprint: fingerprint } }]
    )
    const binding = (await database.query("select id from public.library_product_bindings")).rows[0].id as string
    Object.assign((product.print_areas as DesignProductPayload["print_areas"])[0]!.placeholders[0]!.images[0]!, {
      src: "https://images.printify.com/draft-b.png",
      x: 0.4,
    })
    expect((await services.reconcileBinding({ bindingId: binding })).status).toBe("published")
    expect(
      (
        await database.query(
          "select status,revision_id,storefront_url from public.library_product_bindings where id=$1",
          [binding]
        )
      ).rows[0]
    ).toMatchObject({ status: "published", revision_id: design.revision.id, storefront_url: `/shop/${productId}` })
    await database.query(
      "update public.library_product_bindings set status='needs-reconciliation',storefront_url=null,verified_at=null where id=$1",
      [binding]
    )
    await new PostgresDesignDraftStore(runtime, userId, grantId, "12345").markBinding(binding, "needs-reconciliation")
    expect(
      (await database.query("select status,storefront_url from public.library_product_bindings where id=$1", [binding]))
        .rows[0]
    ).toMatchObject({ status: "published", storefront_url: `/shop/${productId}` })
  })
  it("does not overwrite a publication committed while reconciliation waits for the binding", async () => {
    await services.create(input)
    const product = products[0]!,
      productId = String(product.id),
      fingerprint = productArtworkFingerprint(product, { shopId: "12345", productId })!
    const binding = (await database.query("select id from public.library_product_bindings")).rows[0].id as string
    const publisher = await database.connect()
    let pending: Promise<void> | undefined
    try {
      await publisher.query("begin")
      await publisher.query("select id from public.library_product_bindings where id=$1 for update", [binding])
      await publisher.query(
        "insert into commerce.printify_products(shop_id,product_id,active,snapshot) values('12345',$1,true,$2)",
        [productId, { storefront_artwork: { revisionId: design.revision.id, productionFingerprint: fingerprint } }]
      )
      await publisher.query(
        "update public.library_product_bindings set status='published',storefront_url='/shop/concurrent',verified_at=now() where id=$1",
        [binding]
      )
      const publisherPid = (await publisher.query("select pg_backend_pid() as pid")).rows[0].pid as number
      pending = new PostgresDesignDraftStore(runtime, userId, grantId, "12345").markBinding(
        binding,
        "needs-reconciliation"
      )
      await vi.waitFor(async () => {
        const waiting = await database.query("select 1 from pg_stat_activity where $1=any(pg_blocking_pids(pid))", [
          publisherPid,
        ])
        expect(waiting.rows.length).toBeGreaterThan(0)
      })
      await publisher.query("commit")
      await pending
      expect(
        (
          await database.query("select status,storefront_url from public.library_product_bindings where id=$1", [
            binding,
          ])
        ).rows[0]
      ).toMatchObject({ status: "published", storefront_url: "/shop/concurrent" })
    } finally {
      await publisher.query("rollback")
      publisher.release()
      await pending
    }
  })
  it("rechecks grant authority after durable intent before sending a product POST", async () => {
    const original = PostgresDesignDraftStore.prototype.startCreate
    vi.spyOn(PostgresDesignDraftStore.prototype, "startCreate").mockImplementationOnce(async function (
      this: PostgresDesignDraftStore,
      ...args
    ) {
      const result = await original.apply(this, args)
      active = false
      return result
    })
    await expect(services.create(input)).rejects.toThrow("current owner grant")
    expect(provider.createProduct).not.toHaveBeenCalled()
    active = true
    expect((await services.create(input)).results[0]?.status).toBe("draft")
    expect(provider.createProduct).toHaveBeenCalledTimes(1)
    expect((await database.query("select kind from private.design_draft_write_receipts")).rows).toEqual([
      { kind: "product-not-sent" },
    ])
  })
  it("rechecks grant authority after capability issuance before uploading", async () => {
    const original = PostgresDesignDraftStore.prototype.issueCapability
    vi.spyOn(PostgresDesignDraftStore.prototype, "issueCapability").mockImplementationOnce(async function (
      this: PostgresDesignDraftStore,
      ...args
    ) {
      const result = await original.apply(this, args)
      active = false
      return result
    })
    await expect(services.create(input)).rejects.toThrow("current owner grant")
    expect(provider.uploadImage).not.toHaveBeenCalled()
    expect(provider.createProduct).not.toHaveBeenCalled()
  })
  it("retries a definitive rejection without confusing it with an uncertain response", async () => {
    vi.mocked(provider.createProduct).mockRejectedValueOnce(new DesignDraftError("PROVIDER_REJECTED", "sanitized", 403))
    expect((await services.create(input)).results[0]?.status).toBe("needs-input")
    expect(
      (await database.query("select product_payload,stage,lease_expires_at from private.design_product_attempts"))
        .rows[0]
    ).toMatchObject({ product_payload: null, stage: "ready", lease_expires_at: null })
    expect((await services.create(input)).results[0]?.status).toBe("draft")
    expect(provider.createProduct).toHaveBeenCalledTimes(2)
    expect(provider.uploadImage).toHaveBeenCalledTimes(1)
    expect(
      (await database.query("select kind,http_status,product_payload from private.design_draft_write_receipts")).rows[0]
    ).toMatchObject({ kind: "product-rejected", http_status: 403, product_payload: requestedPayload(imageId) })
  })
  it("allows corrected settings only after a same-owner definitive rejection", async () => {
    vi.mocked(provider.createProduct).mockRejectedValueOnce(new DesignDraftError("PROVIDER_REJECTED", "sanitized", 422))
    await services.create(input)
    const otherOwner = getDesignDraftServices({
      userId: other,
      grantId: randomUUID(),
      database: runtime,
      client: provider,
      authorize: async () => {},
      readAssetBytes: async () => bytes,
    })
    const blocked = await otherOwner.create({ ...input, requestId: randomUUID() })
    expect(blocked.results[0]).toMatchObject({ status: "reserved-elsewhere", owningRequestId: null })
    const corrected = {
      ...input,
      requestId: randomUUID(),
      recipe: { ...input.recipe, variants: input.recipe.variants.map((v) => ({ ...v, price: v.price + 100 })) },
    }
    expect((await services.create(corrected)).results[0]?.status).toBe("draft")
    expect(provider.createProduct).toHaveBeenCalledTimes(2)
    expect(vi.mocked(provider.createProduct).mock.calls[1]![0].variants[0]!.price).toBe(
      input.recipe.variants[0]!.price + 100
    )
    expect(
      (await database.query("select input from private.design_draft_requests where id=$1", [input.requestId])).rows[0]
        .input
    ).toEqual(input)
    expect(
      (await database.query("select request_id from private.design_draft_write_receipts")).rows[0].request_id
    ).toBe(input.requestId)
  })
  it("permits corrected settings after a proven pre-create recipe failure", async () => {
    vi.mocked(provider.validateRecipe).mockRejectedValueOnce(
      new DesignDraftError("INVALID_INPUT", "variant unavailable")
    )
    await expect(services.create(input)).rejects.toMatchObject({ code: "INVALID_INPUT" })
    expect(
      (await new PostgresDesignDraftStore(runtime, userId, grantId, "12345").results(input.requestId)).results[0]
        ?.status
    ).toBe("needs-input")
    expect(
      (
        await services.create({
          ...input,
          requestId: randomUUID(),
          recipe: { ...input.recipe, description: "Corrected recipe" },
        })
      ).results[0]?.status
    ).toBe("draft")
    expect(provider.createProduct).toHaveBeenCalledTimes(1)
  })
  it("cannot retry when saving definitive rejection evidence itself fails", async () => {
    vi.mocked(provider.createProduct).mockRejectedValueOnce(new DesignDraftError("PROVIDER_REJECTED", "sanitized", 422))
    vi.spyOn(PostgresDesignDraftStore.prototype, "resetUnsubmitted").mockRejectedValueOnce(
      new Error("receipt unavailable")
    )
    await expect(services.create(input)).rejects.toThrow("receipt unavailable")
    await database.query("update private.design_product_attempts set lease_expires_at=null")
    expect((await services.reconcile({ requestId: input.requestId })).results[0]?.status).toBe("needs-reconciliation")
    await services.create({ ...input, requestId: randomUUID() })
    expect(provider.createProduct).toHaveBeenCalledTimes(1)
  })
  it("retains mismatched upload evidence and immediately retries only the upload", async () => {
    vi.mocked(provider.uploadImage).mockResolvedValueOnce({
      id: "mismatched-image",
      width: 999,
      height: 2,
      mimeType: "image/png",
    })
    expect((await services.create(input)).results[0]?.status).toBe("needs-input")
    expect(
      (await database.query("select upload_receipt from private.design_draft_write_receipts")).rows[0].upload_receipt
    ).toMatchObject({ id: "mismatched-image", width: 999 })
    expect(
      (await database.query("select 1 from private.design_provider_capabilities where revoked_at is null")).rows
    ).toHaveLength(0)
    expect((await services.create(input)).results[0]?.status).toBe("draft")
    expect(provider.uploadImage).toHaveBeenCalledTimes(2)
    expect(provider.createProduct).toHaveBeenCalledTimes(1)
  })
  it("releases a pre-create provider-read failure for an immediate same-request retry", async () => {
    vi.mocked(provider.listProducts).mockRejectedValueOnce(new Error("read unavailable"))
    await expect(services.create(input)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" })
    expect(
      (await database.query("select stage,product_payload,lease_expires_at from private.design_product_attempts"))
        .rows[0]
    ).toMatchObject({ stage: "ready", product_payload: null, lease_expires_at: null })
    expect((await services.create(input)).results[0]?.status).toBe("draft")
    expect(provider.uploadImage).toHaveBeenCalledTimes(1)
  })
  it("returns the same owner's original request ID for an interrupted reservation", async () => {
    await new PostgresDesignDraftStore(runtime, userId, grantId, "12345").freeze(input)
    expect((await services.create({ ...input, requestId: randomUUID() })).results[0]).toMatchObject({
      status: "reserved-elsewhere",
      owningRequestId: input.requestId,
      productId: null,
    })
    expect(provider.createProduct).not.toHaveBeenCalled()
    expect((await services.create(input)).results[0]?.status).toBe("draft")
  })
  it("propagates revoked reconciliation authority without relabeling provider state", async () => {
    vi.mocked(provider.createProduct).mockRejectedValueOnce(new Error("response lost"))
    await services.create(input)
    const before = (await database.query("select stage,failure_code from private.design_product_attempts")).rows[0]
    const revoked = getDesignDraftServices({
      userId,
      grantId,
      database: runtime,
      client: provider,
      authorize: async () => {
        if (!active) throw new Error("revoked")
      },
      readAssetBytes: async () => {
        active = false
        return bytes
      },
    })
    await expect(revoked.reconcile({ requestId: input.requestId })).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect((await database.query("select stage,failure_code from private.design_product_attempts")).rows[0]).toEqual(
      before
    )
    expect(
      (await database.query("select lease_expires_at from private.design_product_attempts")).rows[0].lease_expires_at
    ).toBeNull()
  })
  it("does not block GoTrue's Auth user update while freezing a request", async () => {
    const auth = await database.connect()
    try {
      await auth.query("begin")
      await auth.query("update auth.users set email=email where id=$1", [userId])
      await new PostgresDesignDraftStore(runtime, userId, grantId, "12345").freeze(input)
    } finally {
      await auth.query("rollback")
      auth.release()
    }
  })
  it("keeps the known product recoverable after a real price mismatch is corrected", async () => {
    vi.mocked(provider.createProduct).mockImplementationOnce(async (payload) => {
      const id = randomUUID()
      products.push(
        providerProduct({ ...payload, variants: payload.variants.map((v) => ({ ...v, price: v.price + 1 })) }, id)
      )
      return { id }
    })
    const result = await services.create(input)
    expect(result.results[0]).toMatchObject({ status: "needs-reconciliation", productId: products[0]!.id })
    const observed = (await database.query("select provider_readback from private.design_product_attempts")).rows[0]
      .provider_readback
    expect(observed.variants[0].price).toBe(input.recipe.variants[0]!.price + 1)
    products[0]!.variants = (products[0]!.variants as { id: number; price: number }[]).map((variant) => ({
      ...variant,
      price: input.recipe.variants.find((value) => value.id === variant.id)!.price,
    }))
    expect((await services.reconcile({ requestId: input.requestId })).results[0]?.status).toBe("draft")
    expect(provider.createProduct).toHaveBeenCalledTimes(1)
  })
  describe("an administrator's own session, with no agent grant", () => {
    const grantCheck = vi.fn()
    const session = () =>
      getDesignDraftServices({
        userId,
        grantId: null,
        database: runtime,
        client: provider,
        authorize: async () => {},
        readAssetBytes: async () => bytes,
        siteUrl: new URL("http://localhost:3000"),
        readArtworkSource: async () => bytes,
      })
    beforeEach(() => grantCheck.mockReset())
    it("creates the draft, and Printify's artwork fetch asks about no grant", async () => {
      vi.mocked(provider.uploadImage).mockImplementation(async ({ url }) => {
        const found = await readProviderArtworkCapability(new URL(url).pathname.split("/").at(-1)!, {
          database: runtime,
          authorize: grantCheck,
        })
        expect(found?.id).toBe(asset.id)
        return { id: imageId, width: 2, height: 2, mimeType: "image/png" }
      })
      expect((await session().create(input)).results[0]?.status).toBe("draft")
      expect(grantCheck).not.toHaveBeenCalled()
      expect((await database.query("select grant_id from private.design_product_attempts")).rows).toEqual([
        { grant_id: null },
      ])
      expect(await session().frozenInput({ requestId: input.requestId })).toEqual(input)
      expect(await session().frozenInput({ requestId: randomUUID() })).toBeNull()
    })
    it.each([
      ["a membership that ended", "update public.admin_memberships set active=$2 where user_id=$1"],
      [
        "a banned sign-in",
        "update auth.users set banned_until=case when $2 then null else now()+interval '1 day' end where id=$1",
      ],
    ])("conceals the artwork link from %s", async (_reason, statement) => {
      let concealed: unknown = "not read"
      vi.mocked(provider.uploadImage).mockImplementation(async ({ url }) => {
        // With no grant to revoke, the administrator's own standing is all that guards the file.
        await database.query(statement, [userId, false])
        try {
          concealed = await readProviderArtworkCapability(new URL(url).pathname.split("/").at(-1)!, {
            database: runtime,
            authorize: grantCheck,
          })
        } finally {
          await database.query(statement, [userId, true])
        }
        throw new Error("Printify could not fetch the artwork")
      })
      await expect(session().create(input)).rejects.toThrow("Artwork upload was not confirmed")
      expect(concealed).toBeNull()
      expect(provider.createProduct).not.toHaveBeenCalled()
    })
  })

  describe("published artwork recovery through the restricted runtime login", () => {
    async function artworkFixture() {
      const pixels = randomBytes(16)
      pixels[3] = 255
      pixels[7] = 0
      const sourceBytes = await sharp(pixels, { raw: { width: 2, height: 2, channels: 4 } })
        .png()
        .toBuffer()
      const inspected = await inspectLibraryImage(sourceBytes)
      const designId = randomUUID(),
        revisionId = randomUUID(),
        assetId = randomUUID(),
        productId = randomUUID()
      await database.query(
        "insert into public.library_designs(id,canonical_design_id,title) values($1,$1,'Published fixture')",
        [designId]
      )
      await database.query(
        "insert into public.library_artwork_revisions(id,design_id,print_readiness) values($1,$2,'unverified')",
        [revisionId, designId]
      )
      await database.query(
        `insert into public.library_assets(id,revision_id,kind,status,pathname,original_filename,mime_type,width,height,bytes,sha256,pixel_sha256,has_alpha,has_transparency)
         values($1,$2,'print','ready',$3,'source.png','image/png',2,2,$4,$5,$6,true,true)`,
        [
          assetId,
          revisionId,
          `concepts/${assetId}/${inspected.sha256}.png`,
          sourceBytes.length,
          inspected.sha256,
          inspected.pixelSha256,
        ]
      )
      const image = {
        id: randomUUID(),
        src: "https://images.printify.com/source.png",
        width: 2,
        height: 2,
        x: 0.5,
        y: 0.5,
        scale: 1,
        angle: 0,
      }
      const source = providerProduct(
        {
          title: "Published fixture",
          description: "",
          blueprint_id: 1317,
          print_provider_id: 99,
          variants: [{ id: 1, price: 3000, is_enabled: true }],
          print_areas: [{ variant_ids: [1], placeholders: [{ position: "front", images: [image] }] }],
        },
        productId
      )
      const expected = { shopId: "12345", productId }
      const resolve = (readSource = async () => sourceBytes) =>
        resolvePublishedProductArtwork(
          {
            ...expected,
            source,
            productionFingerprint: productArtworkFingerprint(source, expected)!,
            deadline: Date.now() + 30_000,
          },
          { database: runtime, readSource }
        )
      const snapshot = {
        ...structuredClone(source),
        storefront_artwork_enabled: true,
        storefront_artwork: {
          src: `https://catalog.public.blob.vercel-storage.com/published-artwork/v1/${"a".repeat(64)}.webp`,
          sha256: "a".repeat(64),
          revisionId,
          sourceSha256: inspected.sha256,
          productionFingerprint: productArtworkFingerprint(source, expected)!,
          width: 1,
          height: 1,
        },
      }
      return { sourceBytes, inspected, revisionId, assetId, productId, image, source, expected, resolve, snapshot }
    }

    it("matches full original pixels to a ready print without changing its unverified assessment", async () => {
      const fixture = await artworkFixture()
      expect(await fixture.resolve()).toMatchObject({
        revisionId: fixture.revisionId,
        printAsset: { id: fixture.assetId },
      })
      expect(
        (
          await database.query("select print_readiness from public.library_artwork_revisions where id=$1", [
            fixture.revisionId,
          ])
        ).rows[0].print_readiness
      ).toBe("unverified")
      expect(
        (await database.query("select * from commerce.design_product_artwork where product_id=$1", [fixture.productId]))
          .rows
      ).toEqual([])
      await database.query("update public.library_assets set status='pending' where id=$1", [fixture.assetId])
      expect(await fixture.resolve()).toBeNull()
    })

    it("recovers the immutable upload receipt after placement changes without fetching a thumbnail", async () => {
      const fixture = await artworkFixture()
      await database.query(
        `insert into commerce.design_product_artwork(shop_id,product_id,production_fingerprint,revision_id,print_asset_id,print_sha256,printify_image_id,approved_by)
         values($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          fixture.expected.shopId,
          fixture.productId,
          fixture.snapshot.storefront_artwork.productionFingerprint,
          fixture.revisionId,
          fixture.assetId,
          fixture.inspected.sha256,
          fixture.image.id,
          userId,
        ]
      )
      fixture.image.y = 0.43
      const readSource = vi.fn(async () => {
        throw new Error("A preview is not the source")
      })
      expect(await fixture.resolve(readSource)).toMatchObject({
        revisionId: fixture.revisionId,
        productionFingerprint: productArtworkFingerprint(fixture.source, fixture.expected),
      })
      expect(readSource).not.toHaveBeenCalled()
    })

    it.each([true, false])("preserves an exact saved pin on image republish when active is %s", async (active) => {
      const fixture = await artworkFixture()
      await database.query(
        "insert into commerce.printify_products(shop_id,product_id,snapshot,active) values($1,$2,$3,$4)",
        [fixture.expected.shopId, fixture.productId, fixture.snapshot, active]
      )
      fixture.image.scale = 0.8
      const readSource = vi.fn(async () => {
        throw new Error("A preview is not the source")
      })
      expect(await fixture.resolve(readSource)).toMatchObject({
        revisionId: fixture.revisionId,
        productionFingerprint: productArtworkFingerprint(fixture.source, fixture.expected),
      })
      expect(readSource).not.toHaveBeenCalled()
      expect(
        (
          await database.query("select snapshot from commerce.printify_products where shop_id=$1 and product_id=$2", [
            fixture.expected.shopId,
            fixture.productId,
          ])
        ).rows[0].snapshot
      ).toEqual(fixture.snapshot)
    })

    it.each([true, false])(
      "reuses a different garment's verified upload when its publication is active: %s",
      async (active) => {
        const fixture = await artworkFixture()
        await database.query(
          "insert into commerce.printify_products(shop_id,product_id,snapshot,active) values($1,$2,$3,$4)",
          [fixture.expected.shopId, fixture.productId, fixture.snapshot, active]
        )
        const productId = randomUUID()
        const expected = { ...fixture.expected, productId }
        const source = { ...structuredClone(fixture.source), id: productId, blueprint_id: 1312 }
        const readSource = vi.fn(async () => {
          throw new Error("A preview is not the source")
        })
        expect(
          await resolvePublishedProductArtwork(
            {
              ...expected,
              source,
              productionFingerprint: productArtworkFingerprint(source, expected)!,
              deadline: Date.now() + 30_000,
            },
            { database: runtime, readSource }
          )
        ).toMatchObject({
          revisionId: fixture.revisionId,
          printAsset: { id: fixture.assetId },
          productionFingerprint: productArtworkFingerprint(source, expected),
        })
        expect(readSource).not.toHaveBeenCalled()
        expect(
          (
            await database.query("select snapshot from commerce.printify_products where shop_id=$1 and product_id=$2", [
              fixture.expected.shopId,
              fixture.productId,
            ])
          ).rows[0].snapshot
        ).toEqual(fixture.snapshot)
        expect(
          (
            await database.query("select 1 from commerce.printify_products where shop_id=$1 and product_id=$2", [
              expected.shopId,
              productId,
            ])
          ).rows
        ).toEqual([])
      }
    )

    it.each(["other-product", "other-shop", "stale-pin", "different-upload"])(
      "refuses saved publication provenance from %s",
      async (reason) => {
        const fixture = await artworkFixture()
        if (reason === "stale-pin")
          fixture.snapshot.storefront_artwork.productionFingerprint = `artwork-v1:${"b".repeat(64)}`
        await database.query(
          "insert into commerce.printify_products(shop_id,product_id,snapshot,active) values($1,$2,$3,false)",
          [
            reason === "other-shop" ? "123" : fixture.expected.shopId,
            reason === "other-product" ? randomUUID() : fixture.productId,
            fixture.snapshot,
          ]
        )
        if (reason === "different-upload") fixture.image.id = randomUUID()
        delete (fixture.image as Partial<typeof fixture.image>).src
        expect(await fixture.resolve()).toBeNull()
      }
    )
  })
})

it("requires a dedicated draft token even when fulfillment credentials exist", () => {
  expect(() =>
    getDesignDraftServices({ userId: randomUUID(), grantId: randomUUID(), authorize: async () => {} })
  ).toThrow("PRINTIFY_DRAFTS_API_TOKEN")
})
