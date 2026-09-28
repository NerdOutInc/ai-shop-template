import "server-only"

import type { Pool, PoolClient } from "pg"

import { getAdminDatabase } from "@/features/admin/get-admin-database.server"

import type {
  LibraryArtworkRevision,
  LibraryCollection,
  LibraryDesign,
  LibraryDesignColor,
  LibraryDesignFilter,
  LibraryDesignInput,
  LibraryProductUse,
  LibraryRevisionInput,
  LibraryStoredAsset,
} from "./library-types"

import { GARMENT_COLORS } from "./garment-colors"
import { LibraryError } from "./library-error"
import { validateLibraryDesign } from "./validate-library-design"

type Row = Record<string, unknown>

function assetFromRow(row: Row): LibraryStoredAsset {
  return {
    id: String(row.id),
    url: `/api/admin/assets/${row.id}`,
    kind: row.kind as LibraryStoredAsset["kind"],
    status: row.status as LibraryStoredAsset["status"],
    pathname: row.pathname as string | null,
    sourcePath: row.source_path as string | null,
    originalFilename: String(row.original_filename),
    mimeType: String(row.mime_type),
    width: row.width as number | null,
    height: row.height as number | null,
    bytes: row.bytes === null ? null : Number(row.bytes),
    sha256: row.sha256 as string | null,
    pixelSha256: row.pixel_sha256 as string | null,
    perceptualHash: row.perceptual_hash as string | null,
    hasAlpha: row.has_alpha as boolean | null,
    hasTransparency: row.has_transparency as boolean | null,
    enlarged: row.enlarged as boolean | null,
  }
}

function publicAsset(row: Row) {
  const stored = assetFromRow(row)
  return {
    id: stored.id,
    url: stored.url,
    kind: stored.kind,
    status: stored.status,
    mimeType: stored.mimeType,
    width: stored.width,
    height: stored.height,
    bytes: stored.bytes,
    sha256: stored.sha256,
    pixelSha256: stored.pixelSha256,
    perceptualHash: stored.perceptualHash,
    hasAlpha: stored.hasAlpha,
    hasTransparency: stored.hasTransparency,
    enlarged: stored.enlarged,
  }
}

function date(value: unknown): string | null {
  return value instanceof Date ? value.toISOString() : value ? String(value) : null
}

function uuid(value: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))
    throw new LibraryError("INVALID_INPUT", "Expected a UUID")
}

async function saveRevision(client: PoolClient, designId: string, revision: LibraryRevisionInput) {
  const signature = [
    revision.id,
    designId,
    revision.printReadiness,
    revision.printNotes,
    revision.widthInches,
    revision.heightInches,
    revision.nativePpi,
  ]
  await client.query(
    `insert into public.library_artwork_revisions (id,design_id,print_readiness,print_notes,width_inches,height_inches,native_ppi)
     values ($1,$2,$3,$4,$5,$6,$7) on conflict (id) do nothing`,
    signature
  )
  const matches = await client.query<{ matches: boolean }>(
    `select design_id=$2 and (
       (assessed_at is not null and $3::text in ('unverified','needs-preparation')) or
       (print_readiness=$3 and print_notes is not distinct from $4::text
        and width_inches is not distinct from $5::float8 and height_inches is not distinct from $6::float8
        and native_ppi is not distinct from $7::float8)
     ) as matches from public.library_artwork_revisions where id=$1`,
    signature
  )
  if (!matches.rows[0]?.matches)
    throw new LibraryError("CONFLICT", "Artwork revision identity already has different content")
  for (const asset of revision.assets) {
    const values = [
      asset.id,
      revision.id,
      asset.kind,
      asset.status,
      asset.pathname,
      asset.sourcePath,
      asset.originalFilename,
      asset.mimeType,
      asset.width,
      asset.height,
      asset.bytes,
      asset.sha256,
      asset.pixelSha256,
      asset.hasAlpha,
      asset.hasTransparency,
      asset.enlarged,
      asset.perceptualHash,
    ]
    await client.query(
      `insert into public.library_assets (id,revision_id,kind,status,pathname,source_path,original_filename,mime_type,width,height,bytes,sha256,pixel_sha256,has_alpha,has_transparency,enlarged,perceptual_hash)
       values (${values.map((_, index) => `$${index + 1}`).join(",")}) on conflict (id) do update set
       status=excluded.status,width=excluded.width,height=excluded.height,bytes=excluded.bytes,sha256=excluded.sha256,
       pixel_sha256=excluded.pixel_sha256,perceptual_hash=excluded.perceptual_hash,has_alpha=excluded.has_alpha,
       has_transparency=excluded.has_transparency,enlarged=excluded.enlarged,pathname=excluded.pathname
       where library_assets.status='unavailable' and library_assets.sha256 is null
       and library_assets.revision_id=excluded.revision_id and library_assets.kind=excluded.kind
       and library_assets.source_path is not distinct from excluded.source_path`,
      values
    )
    const saved = (await client.query<Row>("select * from public.library_assets where id=$1", [asset.id])).rows[0]
    if (
      !saved ||
      saved.revision_id !== revision.id ||
      saved.kind !== asset.kind ||
      saved.sha256 !== asset.sha256 ||
      saved.pixel_sha256 !== asset.pixelSha256 ||
      saved.width !== asset.width ||
      saved.height !== asset.height ||
      saved.perceptual_hash !== asset.perceptualHash ||
      Number(saved.bytes) !== Number(asset.bytes)
    )
      throw new LibraryError("CONFLICT", "Asset identity already has different bytes or ownership")
  }
}

async function readDesigns(client: PoolClient, rows: Row[], userId: string): Promise<LibraryDesign[]> {
  if (!rows.length) return []
  const ids = rows.map((row) => String(row.id))
  const canonicals = rows.map((row) => String(row.canonical_design_id))
  const revisions = (
    await client.query<Row>(
      "select * from public.library_artwork_revisions where design_id=any($1::uuid[]) order by created_at,id",
      [ids]
    )
  ).rows
  const assets = (
    await client.query<Row>(
      "select a.* from public.library_assets a join public.library_artwork_revisions r on r.id=a.revision_id where r.design_id=any($1::uuid[])",
      [ids]
    )
  ).rows
  const collections = (
    await client.query<{ design_id: string; collection_id: string }>(
      "select * from public.library_collection_designs where design_id=any($1::uuid[])",
      [ids]
    )
  ).rows
  const favorites = (
    await client.query<{ design_id: string; revision_id: string; color_name: string | null }>(
      "select design_id,revision_id,color_name from public.library_favorites where user_id=$1 and design_id=any($2::uuid[])",
      [userId, ids]
    )
  ).rows
  const colors = (
    await client.query<{ design_id: string; color_name: string; position: number; source: string }>(
      "select design_id,color_name,position,source from public.library_design_colors where design_id=any($1::uuid[]) order by position",
      [ids]
    )
  ).rows
  const products = (
    await client.query<Row>(
      "select * from public.library_product_bindings where canonical_design_id=any($1::uuid[]) order by created_at,id",
      [canonicals]
    )
  ).rows
  return rows.map((row) => {
    const ownRevisions: LibraryArtworkRevision[] = revisions
      .filter((revision) => revision.design_id === row.id)
      .map((revision) => {
        const find = (kind: string) => {
          const asset = assets.find((candidate) => candidate.revision_id === revision.id && candidate.kind === kind)
          return asset ? publicAsset(asset) : null
        }
        return {
          id: String(revision.id),
          designId: String(row.id),
          original: find("original"),
          print: find("print"),
          preview: find("preview"),
          printReadiness: revision.print_readiness as LibraryArtworkRevision["printReadiness"],
          printNotes: revision.print_notes as string | null,
          widthInches: revision.width_inches as number | null,
          heightInches: revision.height_inches as number | null,
          nativePpi: revision.native_ppi as number | null,
          createdAt: date(revision.created_at)!,
        }
      })
    return {
      id: String(row.id),
      canonicalDesignId: String(row.canonical_design_id),
      displayNumber: Number(row.display_number),
      title: String(row.title),
      family: String(row.family),
      summary: String(row.summary),
      mechanism: String(row.mechanism),
      prompt: String(row.prompt),
      background: row.background as LibraryDesign["background"],
      state: row.state as LibraryDesign["state"],
      collectionIds: collections
        .filter((collection) => collection.design_id === row.id)
        .map((collection) => collection.collection_id),
      revisions: ownRevisions,
      revision: ownRevisions.find((revision) => revision.id === row.current_revision_id) ?? null,
      favoriteRevisionId: favorites.find((favorite) => favorite.design_id === row.id)?.revision_id ?? null,
      favoriteColorName: favorites.find((favorite) => favorite.design_id === row.id)?.color_name ?? null,
      colors: colors
        .filter((color) => color.design_id === row.id)
        .map((color) => ({
          name: color.color_name,
          position: Number(color.position),
          source: color.source as LibraryDesignColor["source"],
        })),
      products: products
        .filter((product) => product.canonical_design_id === row.canonical_design_id)
        .map((product): LibraryProductUse => ({
          id: String(product.id),
          shopId: String(product.shop_id),
          productId: product.product_id as string | null,
          productModelId: String(product.product_model_id),
          productModelLabel: String(product.product_model_label),
          revisionId: product.revision_id as string | null,
          status: product.status as LibraryProductUse["status"],
          verifiedAt: date(product.verified_at),
          storefrontUrl: product.storefront_url as string | null,
        })),
    }
  })
}

/** transactionClient must belong to a caller-owned active transaction; this store never commits or releases it. */
export function createPostgresLibraryStore(options: { database?: Pool; transactionClient?: PoolClient } = {}) {
  const database = () => options.database ?? getAdminDatabase()
  async function withAdmin<T>(userId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    uuid(userId)
    const client = options.transactionClient ?? (await database().connect())
    try {
      if (!options.transactionClient) await client.query("begin")
      const membership = await client.query(
        `select m.user_id from public.admin_memberships m join private.auth_user_identity u on u.id=m.user_id
         where m.user_id=$1 and m.active and u.email_confirmed_at is not null
           and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now())
         for share of m`,
        [userId]
      )
      if (!membership.rows.length) throw new LibraryError("FORBIDDEN", "Current administrator access is required")
      const result = await work(client)
      if (!options.transactionClient) await client.query("commit")
      return result
    } catch (error) {
      if (!options.transactionClient) await client.query("rollback")
      throw error
    } finally {
      if (!options.transactionClient) client.release()
    }
  }

  async function saveDesign(userId: string, value: LibraryDesignInput) {
    const input = validateLibraryDesign(value)
    const revisions = [input.revision]
    return withAdmin(userId, async (client) => {
      // Serialize identity/number allocation and fingerprint registration, never provider or image-generation I/O.
      await client.query("select pg_advisory_xact_lock(731952001)")
      const existing = (await client.query<Row>("select * from public.library_designs where id=$1", [input.id])).rows[0]
      if (input.displayNumber && existing && Number(existing.display_number) !== input.displayNumber)
        throw new LibraryError("CONFLICT", "A permanent design number cannot change")
      // Register the original before another design can claim its bytes as a new canonical.
      const originals = revisions.flatMap((revision) =>
        revision.assets.filter((asset) => asset.kind === "original" && asset.status !== "unavailable")
      )
      const matches = (
        await client.query<{ canonical_design_id: string }>(
          "select distinct canonical_design_id from public.library_artwork_fingerprints where (kind='bytes' and fingerprint=any($1::text[])) or (kind='pixels' and fingerprint=any($2::text[]))",
          [originals.map((asset) => asset.sha256), originals.map((asset) => asset.pixelSha256)]
        )
      ).rows
      if (matches.length > 1) throw new LibraryError("CONFLICT", "Artwork hashes disagree about canonical identity")
      const canonicalId = existing
        ? String(existing.canonical_design_id)
        : (matches[0]?.canonical_design_id ?? input.id)
      if (matches[0] && matches[0].canonical_design_id !== canonicalId)
        throw new LibraryError("CONFLICT", "This artwork belongs to another canonical design")
      if (!existing && canonicalId !== input.id)
        throw new LibraryError("CONFLICT", `Artwork already belongs to design ${canonicalId}`)
      if (!existing) {
        const values = [
          input.id,
          canonicalId,
          input.title,
          input.family,
          input.summary,
          input.mechanism,
          input.prompt,
          input.background,
          input.state,
        ]
        await client.query(
          `insert into public.library_designs (id,canonical_design_id,title,family,summary,mechanism,prompt,background,state${input.displayNumber ? ",display_number" : ""}) values ($1,$2,$3,$4,$5,$6,$7,$8,$9${input.displayNumber ? ",$10" : ""})`,
          input.displayNumber ? [...values, input.displayNumber] : values
        )
      }
      for (const collectionId of input.collectionIds)
        await client.query(
          "insert into public.library_collection_designs (collection_id,design_id) values ($1,$2) on conflict do nothing",
          [collectionId, input.id]
        )
      for (const revision of revisions) await saveRevision(client, input.id, revision)
      // A rerun must not replace a later selected revision.
      await client.query(
        "update public.library_designs set current_revision_id=$2 where id=$1 and current_revision_id is null",
        [input.id, input.revision.id]
      )
      for (const [kind, fingerprint] of originals.flatMap((original) => [
        ["bytes", original.sha256],
        ["pixels", original.pixelSha256],
      ]))
        if (fingerprint)
          await client.query(
            "insert into public.library_artwork_fingerprints (kind,fingerprint,canonical_design_id) values ($1,$2,$3) on conflict do nothing",
            [kind, fingerprint, canonicalId]
          )
      await client.query(
        "select setval('public.library_designs_display_number_seq', greatest((select coalesce(max(display_number),1) from public.library_designs), (select last_value from public.library_designs_display_number_seq)), true)"
      )
      return { designId: input.id, canonicalDesignId: canonicalId }
    })
  }

  return {
    saveDesign: (userId: string, input: LibraryDesignInput) => saveDesign(userId, input),
    async createCollection(userId: string, input: Omit<LibraryCollection, "designCount">) {
      if (
        ![input.id, input.title].every((value) => typeof value === "string" && value.length && value === value.trim())
      )
        throw new LibraryError("INVALID_INPUT", "Collection identity and title are required")
      return withAdmin(userId, async (client) => {
        await client.query(
          "insert into public.library_collections (id,title,description) values ($1,$2,$3) on conflict (id) do nothing",
          [input.id, input.title, input.description]
        )
        return input.id
      })
    },
    async listCollections(userId: string, options: { includePending?: boolean } = {}): Promise<LibraryCollection[]> {
      return withAdmin(userId, async (client) =>
        (
          await client.query<{ id: string; title: string; description: string | null; count: string }>(
            "select c.*,count(cd.design_id)::text as count from public.library_collections c left join public.library_collection_designs cd on cd.collection_id=c.id where ($1::boolean or c.review_state='ready') group by c.id order by c.created_at,c.id",
            [options.includePending === true]
          )
        ).rows.map((row) => ({
          id: row.id,
          title: row.title,
          description: row.description,
          designCount: Number(row.count),
        }))
      )
    },
    async listFilterOptions(userId: string) {
      return withAdmin(userId, async (client) => ({
        families: (
          await client.query<{ family: string }>(
            "select distinct d.family from public.library_designs d where d.family <> '' and exists (select 1 from public.library_collection_designs cd join public.library_collections c on c.id=cd.collection_id where cd.design_id=d.id and c.review_state='ready') order by d.family"
          )
        ).rows.map((row) => row.family),
        productModels: (
          await client.query<{ id: string; label: string }>(
            "select product_model_id as id,min(product_model_label) as label from public.library_product_bindings group by product_model_id order by label"
          )
        ).rows,
      }))
    },
    async listDesigns(userId: string, filter: LibraryDesignFilter = {}) {
      const limit = filter.limit ?? 48,
        offset = filter.offset ?? 0
      if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0)
        throw new LibraryError("INVALID_INPUT", "Invalid library page")
      return withAdmin(userId, async (client) => {
        const values: unknown[] = [userId]
        const bind = (value: unknown) => {
          values.push(value)
          return `$${values.length}`
        }
        const where: string[] =
          filter.includePending === true
            ? []
            : [
                "exists (select 1 from public.library_collection_designs cd join public.library_collections c on c.id=cd.collection_id where cd.design_id=d.id and c.review_state='ready')",
              ]
        if (filter.search?.trim()) {
          const value = bind(filter.search.trim().replace(/[\\%_]/g, "\\$&"))
          where.push(
            `(concat_ws(' ',d.title,d.family,d.summary,d.mechanism,d.prompt,d.display_number::text) ilike '%' || ${value} || '%' escape '\\')`
          )
        }
        if (filter.collectionId)
          where.push(
            `exists (select 1 from public.library_collection_designs c where c.design_id=d.id and c.collection_id=${bind(filter.collectionId)})`
          )
        if (filter.family) where.push(`d.family=${bind(filter.family)}`)
        // Archived and rejected concepts stay out of the default library view.
        if (filter.designState !== "all") where.push(`d.state=${bind(filter.designState ?? "active")}`)
        if (filter.favoritesOnly)
          where.push("exists (select 1 from public.library_favorites f where f.design_id=d.id and f.user_id=$1)")
        const model = filter.productModelId ? ` and p.product_model_id=${bind(filter.productModelId)}` : ""
        const product = `select 1 from public.library_product_bindings p where p.canonical_design_id=d.canonical_design_id${model}`
        if (filter.status === "no-product") where.push(`not exists (${product})`)
        else if (filter.status === "draft" || filter.status === "published")
          where.push(`exists (${product} and p.status=${bind(filter.status)} and p.verified_at is not null)`)
        else if (filter.status === "unverified")
          where.push(
            `exists (${product} and p.status in ('unverified','needs-reconciliation','reserved','creating','removed'))`
          )
        else if (filter.productModelId) where.push(`exists (${product})`)
        if (filter.status === "needs-artwork")
          where.push(
            "not exists (select 1 from public.library_artwork_revisions r where r.id=coalesce((select f.revision_id from public.library_favorites f where f.design_id=d.id and f.user_id=$1),d.current_revision_id) and r.print_readiness='ready')"
          )
        const clause = where.length ? `where ${where.join(" and ")}` : "where $1::uuid is not null"
        // $1 stays typed even when no favorites predicate is present.
        const prefix = "with actor as (select $1::uuid as id) "
        const count = await client.query<{ count: string }>(
          `${prefix}select count(*)::text as count from public.library_designs d ${clause}`,
          values
        )
        const rows = (
          await client.query<Row>(
            `${prefix}select d.* from public.library_designs d ${clause} order by d.display_number limit ${bind(limit)} offset ${bind(offset)}`,
            values
          )
        ).rows
        return { designs: await readDesigns(client, rows, userId), total: Number(count.rows[0]?.count ?? 0) }
      })
    },
    async getDesign(
      userId: string,
      displayNumber: number,
      options: { includePending?: boolean } = {}
    ): Promise<LibraryDesign | null> {
      if (!Number.isSafeInteger(displayNumber) || displayNumber < 1)
        throw new LibraryError("INVALID_INPUT", "Expected a permanent design number")
      return withAdmin(
        userId,
        async (client) =>
          (
            await readDesigns(
              client,
              (
                await client.query<Row>(
                  "select d.* from public.library_designs d where display_number=$1 and ($2::boolean or exists (select 1 from public.library_collection_designs cd join public.library_collections c on c.id=cd.collection_id where cd.design_id=d.id and c.review_state='ready'))",
                  [displayNumber, options.includePending === true]
                )
              ).rows,
              userId
            )
          )[0] ?? null
      )
    },
    /**
     * Every artwork revision in a design's canonical family.
     *
     * Products bind to the CANONICAL design, and a design re-imported under a second display number
     * keeps its own revisions, so asking one design for its revisions would miss its siblings' and
     * report that the design has no products at all.
     */
    async listCanonicalRevisionIds(userId: string, canonicalDesignId: string): Promise<string[]> {
      uuid(userId)
      uuid(canonicalDesignId)
      return withAdmin(userId, async (client) =>
        (
          await client.query<{ id: string }>(
            `select r.id from public.library_artwork_revisions r
               join public.library_designs d on d.id = r.design_id
              where d.canonical_design_id = $1 order by r.created_at`,
            [canonicalDesignId]
          )
        ).rows.map((row) => String(row.id))
      )
    },
    async getAsset(userId: string, assetId: string, sessionId?: string): Promise<LibraryStoredAsset | null> {
      uuid(userId)
      uuid(assetId)
      if (sessionId !== undefined) uuid(sessionId)
      // One snapshot checks authorization and fetches the asset, without holding a
      // transaction open or share-locking GoTrue's frequently updated user row.
      const row = (
        await (options.transactionClient ?? database()).query<Row>(
          `select a.* from public.admin_memberships m join private.auth_user_identity u on u.id=m.user_id
         left join public.library_assets a on a.id=$2
         where m.user_id=$1 and m.active and u.email_confirmed_at is not null
           and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now())
           and ($3::uuid is null or exists (select 1 from private.auth_session_identity s where s.id=$3 and s.user_id=u.id
             and (s.not_after is null or s.not_after>now())))`,
          [userId, assetId, sessionId ?? null]
        )
      ).rows[0]
      if (!row) throw new LibraryError("FORBIDDEN", "Current administrator access is required")
      return row.id ? assetFromRow(row) : null
    },
    /**
     * Adds a prepared artwork revision to an existing design and makes it current.
     *
     * Preparation happens outside the app: transparency is decided there and uploaded, so
     * this only records the revision and its pending assets. The earlier revision stays,
     * because a favorite pins the exact artwork it was saved against.
     */
    async prepareRevision(userId: string, input: { designId: string; revision: LibraryRevisionInput }) {
      uuid(input.designId)
      uuid(input.revision.id)
      if (!input.revision.assets.length) throw new LibraryError("INVALID_INPUT", "A revision needs its assets")
      return withAdmin(userId, async (client) => {
        const design = await client.query("select id from public.library_designs where id=$1 for update", [
          input.designId,
        ])
        if (!design.rows.length) throw new LibraryError("NOT_FOUND", "Design not found")
        await saveRevision(client, input.designId, input.revision)
        await client.query("update public.library_designs set current_revision_id=$2 where id=$1", [
          input.designId,
          input.revision.id,
        ])
        return { designId: input.designId, revisionId: input.revision.id }
      })
    },
    /** An asset looked up through the revision that owns it, for the upload handshake. */
    async getRevisionAsset(userId: string, revisionId: string, assetId: string): Promise<LibraryStoredAsset | null> {
      uuid(revisionId)
      uuid(assetId)
      return withAdmin(userId, async (client) => {
        const row = (
          await client.query<Row>("select * from public.library_assets where id=$1 and revision_id=$2", [
            assetId,
            revisionId,
          ])
        ).rows[0]
        return row ? assetFromRow(row) : null
      })
    },
    async setFavorite(
      userId: string,
      input: { designId: string; revisionId: string; selected: boolean; colorName?: string | null }
    ) {
      uuid(input.designId)
      uuid(input.revisionId)
      if (typeof input.selected !== "boolean")
        throw new LibraryError("INVALID_INPUT", "Favorite selection must be boolean")
      const colorName = input.colorName?.trim() || null
      if (colorName !== null && !GARMENT_COLORS.some((color) => color.name === colorName))
        throw new LibraryError("INVALID_INPUT", "Unknown garment color")
      return withAdmin(userId, async (client) => {
        const revision = await client.query(
          "select id from public.library_artwork_revisions where id=$1 and design_id=$2",
          [input.revisionId, input.designId]
        )
        if (!revision.rows.length) throw new LibraryError("NOT_FOUND", "Revision does not belong to this design")
        if (input.selected)
          await client.query(
            `insert into public.library_favorites (user_id,design_id,revision_id,color_name) values ($1,$2,$3,$4)
             on conflict (user_id,design_id) do update set revision_id=excluded.revision_id, color_name=excluded.color_name`,
            [userId, input.designId, input.revisionId, colorName]
          )
        else {
          const removed = await client.query(
            "delete from public.library_favorites where user_id=$1 and design_id=$2 and revision_id=$3 returning design_id",
            [userId, input.designId, input.revisionId]
          )
          if (
            !removed.rowCount &&
            (
              await client.query("select 1 from public.library_favorites where user_id=$1 and design_id=$2", [
                userId,
                input.designId,
              ])
            ).rowCount
          )
            throw new LibraryError("CONFLICT", "A newer favorite revision is saved. Reload before removing it.")
        }
        return {
          selected: input.selected,
          revisionId: input.selected ? input.revisionId : null,
          colorName: input.selected ? colorName : null,
        }
      })
    },
    /**
     * Adds a garment colour to a design's offered set. Five is the product rule, and a
     * full set refuses rather than dropping a colour the owner chose earlier; the detail
     * page asks for a removal first so the trade is always visible.
     */
    async promoteDesignColor(userId: string, input: { designId: string; colorName: string }) {
      uuid(input.designId)
      const colorName = input.colorName?.trim() ?? ""
      if (!GARMENT_COLORS.some((color) => color.name === colorName))
        throw new LibraryError("INVALID_INPUT", "Unknown garment color")
      return withAdmin(userId, async (client) => {
        const design = await client.query("select id from public.library_designs where id=$1 for update", [
          input.designId,
        ])
        if (!design.rows.length) throw new LibraryError("NOT_FOUND", "Design not found")
        const existing = (
          await client.query<{ color_name: string; position: number }>(
            "select color_name,position from public.library_design_colors where design_id=$1 order by position",
            [input.designId]
          )
        ).rows
        if (existing.some((color) => color.color_name === colorName))
          return { colorName, position: Number(existing.find((color) => color.color_name === colorName)!.position) }
        if (existing.length >= 5)
          throw new LibraryError("CONFLICT", "This design already offers five colors. Remove one first.")
        const taken = new Set(existing.map((color) => Number(color.position)))
        const position = [1, 2, 3, 4, 5].find((slot) => !taken.has(slot))!
        await client.query(
          "insert into public.library_design_colors (design_id,color_name,position,source) values ($1,$2,$3,'promoted')",
          [input.designId, colorName, position]
        )
        return { colorName, position }
      })
    },
    async removeDesignColor(userId: string, input: { designId: string; colorName: string }) {
      uuid(input.designId)
      return withAdmin(userId, async (client) => {
        const removed = await client.query(
          "delete from public.library_design_colors where design_id=$1 and color_name=$2 returning color_name",
          [input.designId, input.colorName]
        )
        if (!removed.rowCount) throw new LibraryError("NOT_FOUND", "That color is not offered for this design")
        return { colorName: input.colorName }
      })
    },
    /** Replaces a design's offered colours outright; used by assignment and Printify sync. */
    async setDesignColors(
      userId: string,
      input: { designId: string; colors: { name: string; source: LibraryDesignColor["source"] }[] }
    ) {
      uuid(input.designId)
      if (input.colors.length > 5) throw new LibraryError("INVALID_INPUT", "A design offers at most five colors")
      const names = input.colors.map((color) => color.name.trim())
      if (new Set(names).size !== names.length)
        throw new LibraryError("INVALID_INPUT", "Garment colors must be distinct")
      if (!names.every((name) => GARMENT_COLORS.some((color) => color.name === name)))
        throw new LibraryError("INVALID_INPUT", "Unknown garment color")
      return withAdmin(userId, async (client) => {
        const design = await client.query("select id from public.library_designs where id=$1 for update", [
          input.designId,
        ])
        if (!design.rows.length) throw new LibraryError("NOT_FOUND", "Design not found")
        await client.query("delete from public.library_design_colors where design_id=$1", [input.designId])
        for (const [index, color] of input.colors.entries())
          await client.query(
            "insert into public.library_design_colors (design_id,color_name,position,source) values ($1,$2,$3,$4)",
            [input.designId, color.name.trim(), index + 1, color.source]
          )
        return { designId: input.designId, colors: names }
      })
    },
    async finalizePrintAssessment(
      userId: string,
      input: {
        revisionId: string
        widthInches: number
        heightInches: number
        nativePpi: number
        notes: string
      }
    ) {
      uuid(input.revisionId)
      if (
        ![input.widthInches, input.heightInches, input.nativePpi].every(
          (value) => Number.isFinite(value) && value > 0
        ) ||
        input.widthInches > 100 ||
        input.heightInches > 100 ||
        typeof input.notes !== "string" ||
        !input.notes.trim() ||
        input.notes.length > 4000
      )
        throw new LibraryError("INVALID_INPUT", "Supply an assessed print size, native PPI and preparation notes")
      return withAdmin(userId, async (client) => {
        const revision = (
          await client.query<Row>("select * from public.library_artwork_revisions where id=$1 for update", [
            input.revisionId,
          ])
        ).rows[0]
        if (!revision) throw new LibraryError("NOT_FOUND", "Artwork revision not found")
        const assets = (
          await client.query<Row>(
            "select * from public.library_assets where revision_id=$1 and kind in ('original','print') for share",
            [input.revisionId]
          )
        ).rows.map(assetFromRow)
        const original = assets.find((asset) => asset.kind === "original")
        const print = assets.find((asset) => asset.kind === "print")
        if (
          !original ||
          !print ||
          assets.some((asset) => asset.status !== "ready" || !asset.sha256 || !asset.pixelSha256) ||
          print.mimeType !== "image/png" ||
          !print.hasAlpha ||
          !print.hasTransparency ||
          print.enlarged === null
        )
          throw new LibraryError(
            "CONFLICT",
            "Upload and verify the original and transparent print PNG, including enlargement status, before assessing readiness"
          )
        const sourcePpiLimit = Math.min(original.width! / input.widthInches, original.height! / input.heightInches)
        if (input.nativePpi > sourcePpiLimit + 0.5)
          throw new LibraryError(
            "INVALID_INPUT",
            "Native PPI exceeds the preserved source dimensions at this print size"
          )
        if (revision.assessed_at) {
          if (
            revision.width_inches !== input.widthInches ||
            revision.height_inches !== input.heightInches ||
            revision.native_ppi !== input.nativePpi ||
            revision.print_notes !== input.notes.trim()
          )
            throw new LibraryError("CONFLICT", "This revision already has a different completed print assessment")
        } else
          await client.query(
            "update public.library_artwork_revisions set print_readiness='ready',width_inches=$2,height_inches=$3,native_ppi=$4,print_notes=$5,assessed_by=$6,assessed_at=now() where id=$1",
            [input.revisionId, input.widthInches, input.heightInches, input.nativePpi, input.notes.trim(), userId]
          )
        return { ...input, notes: input.notes.trim(), printReadiness: "ready" as const }
      })
    },
    async selectRevision(userId: string, designId: string, revisionId: string) {
      uuid(designId)
      uuid(revisionId)
      return withAdmin(userId, async (client) => {
        const result = await client.query(
          "update public.library_designs set current_revision_id=$2 where id=$1 and exists (select 1 from public.library_artwork_revisions r where r.id=$2 and r.design_id=$1) returning id",
          [designId, revisionId]
        )
        if (!result.rows.length) throw new LibraryError("NOT_FOUND", "Revision does not belong to this design")
      })
    },
    async setDesignState(userId: string, designId: string, state: LibraryDesign["state"]) {
      uuid(designId)
      if (!["active", "archived", "rejected"].includes(state))
        throw new LibraryError("INVALID_INPUT", "Invalid design state")
      return withAdmin(userId, async (client) => {
        const result = await client.query("update public.library_designs set state=$2 where id=$1 returning id", [
          designId,
          state,
        ])
        if (!result.rows.length) throw new LibraryError("NOT_FOUND", "Design not found")
      })
    },
    async finalizeAsset(
      userId: string,
      input: { assetId: string; pathname: string; sha256: string; pixelSha256: string; bytes: number }
    ) {
      uuid(input.assetId)
      if (
        !input.pathname ||
        /^[a-z][a-z0-9+.-]*:/i.test(input.pathname) ||
        input.pathname.startsWith("/") ||
        input.pathname.split("/").includes("..") ||
        input.pathname.includes("\\")
      )
        throw new LibraryError("INVALID_INPUT", "Expected a private Blob pathname")
      return withAdmin(userId, async (client) => {
        const current = (
          await client.query<Row>("select mime_type,sha256 from public.library_assets where id=$1 for update", [
            input.assetId,
          ])
        ).rows[0]
        const extension =
          current?.mime_type === "image/jpeg" ? "jpg" : current?.mime_type === "image/webp" ? "webp" : "png"
        if (!current || input.pathname !== `concepts/${input.assetId}/${current.sha256}.${extension}`)
          throw new LibraryError("INVALID_INPUT", "Private asset pathname must match its immutable ID and hash")
        const result = await client.query(
          "update public.library_assets set pathname=$2,status='ready' where id=$1 and sha256=$3 and pixel_sha256=$4 and bytes=$5 and status in ('pending','ready') and (pathname is null or pathname=$2) returning id",
          [input.assetId, input.pathname, input.sha256, input.pixelSha256, input.bytes]
        )
        if (!result.rows.length)
          throw new LibraryError(
            "CONFLICT",
            "Stored bytes do not match the expected asset, or location already differs"
          )
      })
    },
  }
}
