// @vitest-environment node
import { randomUUID, createHash } from "node:crypto"
import type { Pool } from "pg"
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from "vitest"
import { applyAllMigrations } from "../../../test/apply-all-migrations"
import { createAdminDatabaseFixture } from "../../../test/create-admin-database-fixture"
import { createRuntimeLoginPool } from "../../../test/create-runtime-login-pool"
import { createPostgresLibraryStore } from "@/features/design-library/postgres-library-store.server"
import type { LibraryDesignInput } from "@/features/design-library/library-types"
import { DesignGenerationStore } from "./design-generation-store.server"
import { DesignAgentGrantStore } from "./design-agent-grant-store.server"
import { DesignAgentError } from "./design-agent-error"
import type { DesignAgentActor, DesignDirection } from "./design-agent-types"
vi.mock("server-only", () => ({}))
const databaseUrl = process.env.AGENT_TEST_DATABASE_URL
const hash = (value: string) => createHash("sha256").update(value).digest("hex")
const directions = (count: number): DesignDirection[] =>
  Array.from({ length: count }, (_, i) => ({
    slot: i + 1,
    subject: `Subject ${i}`,
    mechanism: `Joke ${i}`,
    composition: `Composition ${i}`,
    lettering: "",
    avoidDesignNumbers: [],
  }))
function artwork(collectionId: string, seed = randomUUID()): LibraryDesignInput {
  return {
    id: randomUUID(),
    title: seed,
    family: "Botanical",
    summary: "Flat botanical illustration",
    mechanism: "Unexpected hold",
    prompt: "Source generation prompt",
    background: null,
    state: "active",
    collectionIds: [collectionId],
    revision: {
      id: randomUUID(),
      printReadiness: "unverified",
      printNotes: "Native review size",
      widthInches: null,
      heightInches: null,
      nativePpi: null,
      assets: (["original", "print", "preview"] as const).map((kind) => {
        const id = randomUUID()
        return {
          id,
          url: `/api/admin/assets/${id}`,
          kind,
          status: "pending" as const,
          mimeType: "image/png",
          width: 100,
          height: 100,
          bytes: 100,
          sha256: hash(seed + kind),
          pixelSha256: hash(seed + kind + "pixels"),
          perceptualHash: hash(seed).slice(0, 16),
          hasAlpha: true,
          hasTransparency: true,
          enlarged: false,
          pathname: null,
          sourcePath: null,
          originalFilename: kind + ".png",
        }
      }),
    },
  }
}

describe.skipIf(!databaseUrl)("scoped agents and resumable design generation database boundaries", () => {
  let database: Pool,
    runtime: Pool,
    store: DesignGenerationStore,
    grants: DesignAgentGrantStore,
    actor: DesignAgentActor,
    token: string
  let library: ReturnType<typeof createPostgresLibraryStore>
  beforeAll(async () => {
    database = await createAdminDatabaseFixture(databaseUrl!)
    await applyAllMigrations(database)
    // Stores run as the production login so privileges and policies are real, not superuser defaults.
    runtime = await createRuntimeLoginPool(database, databaseUrl!)
    store = new DesignGenerationStore(runtime)
    grants = new DesignAgentGrantStore(runtime)
    library = createPostgresLibraryStore({ database: runtime })
  })
  afterAll(async () => {
    await runtime?.end()
    await database?.end()
  })
  beforeEach(async () => {
    await database.query(
      "truncate public.library_collections,public.library_designs,private.design_agent_grants,public.design_generation_batches cascade;delete from public.admin_memberships;alter sequence public.library_designs_display_number_seq restart with 1"
    )
    const userId = randomUUID()
    await database.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,'agent-owner@example.test',now())",
      [userId]
    )
    await database.query("insert into public.admin_memberships(user_id) values($1)", [userId])
    const grant = await grants.issue(userId, {
      label: "test agent",
      hours: 1,
      scopes: ["library:read", "library:write", "drafts:create"],
    })
    actor = { userId, grantId: grant.id }
    token = grant.token
  })
  async function batch(count = 1) {
    const result = await store.create(actor, {
      requestId: randomUUID(),
      title: "New concepts",
      brief: "Botanical patterns",
      count,
    })
    await store.plan(actor, result.batchId, directions(count))
    return result
  }
  async function register(batchId: string, collectionId: string, slot = 1, design = artwork(collectionId)) {
    const workerId = randomUUID()
    await store.claim(actor, batchId, slot, workerId)
    await store.register(actor, { batchId, slot, workerId, design })
    return design
  }
  async function upload(design: LibraryDesignInput) {
    for (const asset of design.revision.assets)
      await library.finalizeAsset(actor.userId, {
        assetId: asset.id,
        pathname: `concepts/${asset.id}/${asset.sha256}.png`,
        sha256: asset.sha256!,
        pixelSha256: asset.pixelSha256!,
        bytes: asset.bytes!,
      })
  }
  async function review(batchId: string, slot = 1) {
    const inspection = await store.inspect(actor, batchId, slot)
    return store.review(actor, {
      batchId,
      slot,
      comparisonHash: inspection.comparisonHash,
      reviewedAssetIds: inspection.neighbors.map((n) => n.assetId),
      notes: "Inspected exact candidate and neighboring images; distinct composition and joke.",
      contactSheetReviewed: true,
    })
  }

  it("stores only hashes, attributes favorites to the issuing actor, and omits plaintext from listings", async () => {
    expect(await grants.authenticate(token, "library:read")).toEqual(actor)
    const rows = (await database.query("select * from private.design_agent_grants")).rows
    expect(JSON.stringify(rows)).not.toContain(token)
    expect(rows[0].token_hash).toBe(hash(token))
    expect(JSON.stringify(await grants.list(actor.userId))).not.toContain("token_hash")
    expect(await grants.authenticate(token.slice(0, -1) + "x", "library:read")).toBeNull()
  })
  it("rejects publishing scopes and overly long grants", async () => {
    await expect(
      grants.issue(actor.userId, { label: "unsafe", hours: 169, scopes: ["library:read"] })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" })
    await expect(
      grants.issue(actor.userId, { label: "unsafe", hours: 1, scopes: ["publish" as never] })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" })
  })
  it.each(["revoked", "inactive", "expired", "unconfirmed"])("rechecks %s access before writes", async (mode) => {
    const work = await batch()
    if (mode === "revoked") await grants.revoke(actor.userId, actor.grantId)
    if (mode === "inactive")
      await database.query("update public.admin_memberships set active=false where user_id=$1", [actor.userId])
    if (mode === "expired")
      await database.query(
        "update private.design_agent_grants set created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where id=$1",
        [actor.grantId]
      )
    if (mode === "unconfirmed")
      await database.query("update auth.users set email_confirmed_at=null where id=$1", [actor.userId])
    expect(await grants.authenticate(token, "library:read")).toBeNull()
    await expect(store.claim(actor, work.batchId, 1, randomUUID())).rejects.toMatchObject({ code: "FORBIDDEN" })
  })
  it("enforces scope and administrator ownership separately", async () => {
    const work = await batch(),
      readonly = await grants.issue(actor.userId, { label: "reader", hours: 1, scopes: ["library:read"] })
    await expect(
      store.claim({ userId: actor.userId, grantId: readonly.id }, work.batchId, 1, randomUUID())
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
    const other = randomUUID()
    await database.query("insert into auth.users(id,email,email_confirmed_at) values($1,'other@example.test',now())", [
      other,
    ])
    await database.query("insert into public.admin_memberships(user_id) values($1)", [other])
    const otherGrant = await grants.issue(other, {
      label: "other",
      hours: 1,
      scopes: ["library:read", "library:write"],
    })
    await expect(store.status({ userId: other, grantId: otherGrant.id }, work.batchId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    })
  })
  it("registers exactly 50 slots atomically and resumes the same request instead of creating another collection", async () => {
    const input = { requestId: randomUUID(), title: "Fifty", brief: "50 distinct concepts", count: 50 }
    const results = await Promise.all(Array.from({ length: 8 }, () => store.create(actor, input)))
    expect(new Set(results.map((result) => result.batchId)).size).toBe(1)
    expect((await store.status(actor, results[0]!.batchId)).slots).toHaveLength(50)
    await expect(store.create(actor, { ...input, count: 51 })).rejects.toMatchObject({ code: "CONFLICT" })
    await expect(store.plan(actor, results[0]!.batchId, directions(49))).rejects.toMatchObject({ code: "CONFLICT" })
  })
  it("serializes conflicting plans and worker claims, permits lease renewal, and resumes a recorded candidate after expiry", async () => {
    const work = await store.create(actor, { requestId: randomUUID(), title: "Plan", brief: "Immutable", count: 1 })
    const plans = await Promise.allSettled([
      store.plan(actor, work.batchId, directions(1)),
      store.plan(actor, work.batchId, [{ ...directions(1)[0]!, subject: "Other" }]),
    ])
    expect(plans.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    const workers = [randomUUID(), randomUUID()]
    const claims = await Promise.allSettled(workers.map((worker) => store.claim(actor, work.batchId, 1, worker)))
    expect(claims.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    const worker = workers[claims.findIndex((result) => result.status === "fulfilled")]!
    await store.claim(actor, work.batchId, 1, worker)
    const design = artwork(work.collectionId)
    await store.register(actor, { batchId: work.batchId, slot: 1, workerId: worker, design })
    await database.query("update public.design_generation_slots set lease_expires_at=now()-interval '1 minute'")
    expect(await store.claim(actor, work.batchId, 1, randomUUID())).toMatchObject({
      candidateId: design.id,
      resume: true,
      status: "registered",
    })
  })
  it("replays registration and finalization while blocking changed payloads and unrelated asset uploads", async () => {
    const work = await batch(),
      workerId = randomUUID(),
      design = artwork(work.collectionId)
    await store.claim(actor, work.batchId, 1, workerId)
    const input = { batchId: work.batchId, slot: 1, workerId, design }
    await store.register(actor, input)
    await store.register(actor, input)
    await expect(store.register(actor, { ...input, design: { ...design, title: "Changed" } })).rejects.toMatchObject({
      code: "CONFLICT",
    })
    await upload(design)
    await upload(design)
    expect((await store.ownedAsset(actor, work.batchId, design.revision.assets[0]!.id)).status).toBe("ready")
    await expect(store.ownedAsset(actor, work.batchId, randomUUID())).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect((await database.query("select count(*)::int as count from public.library_designs")).rows[0].count).toBe(1)
  })
  it("rejects exact repeats instead of counting them as new designs", async () => {
    const work = await batch(2),
      first = await register(work.batchId, work.collectionId, 1)
    const duplicate = artwork(work.collectionId)
    duplicate.revision.assets[0]!.sha256 = first.revision.assets[0]!.sha256
    const workerId = randomUUID()
    await store.claim(actor, work.batchId, 2, workerId)
    await expect(
      store.register(actor, { batchId: work.batchId, slot: 2, workerId, design: duplicate })
    ).rejects.toMatchObject({ code: "CONFLICT" })
    await expect(store.complete(actor, work.batchId)).rejects.toMatchObject({ code: "CONFLICT" })
  })
  it("keeps missing uploads pending and flags near neighbors until their exact images are reviewed", async () => {
    const work = await batch(2),
      first = await register(work.batchId, work.collectionId, 1),
      second = artwork(work.collectionId)
    second.revision.assets[0]!.perceptualHash = first.revision.assets[0]!.perceptualHash
    await register(work.batchId, work.collectionId, 2, second)
    const inspection = await store.inspect(actor, work.batchId, 1)
    expect(inspection.neighbors).toHaveLength(1)
    await expect(review(work.batchId, 1)).rejects.toMatchObject({ code: "CONFLICT" })
    await upload(first)
    await expect(
      store.review(actor, {
        batchId: work.batchId,
        slot: 1,
        comparisonHash: inspection.comparisonHash,
        reviewedAssetIds: [],
        notes: "Looked",
        contactSheetReviewed: true,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" })
    expect(await review(work.batchId, 1)).toMatchObject({ nearDuplicates: 1 })
  })
  it("rechecks new concurrent neighbors before marking a collection complete", async () => {
    const work = await batch(),
      design = await register(work.batchId, work.collectionId)
    await upload(design)
    await review(work.batchId)
    const other = await batch(),
      neighbor = artwork(other.collectionId)
    neighbor.revision.assets[0]!.perceptualHash = design.revision.assets[0]!.perceptualHash
    await register(other.batchId, other.collectionId, 1, neighbor)
    await expect(store.complete(actor, work.batchId)).rejects.toMatchObject({ code: "CONFLICT" })
    await review(work.batchId)
    expect(await store.complete(actor, work.batchId)).toMatchObject({ status: "ready", count: 1 })
  })
  it("retains rejected work, releases only its slot, and preserves history outside collection favorites", async () => {
    const work = await batch(),
      design = await register(work.batchId, work.collectionId)
    await store.reject(actor, work.batchId, 1, "Too close to an earlier composition")
    expect((await store.status(actor, work.batchId)).candidates[0]).toMatchObject({
      status: "rejected",
      rejection_reason: "Too close to an earlier composition",
    })
    expect((await store.history(actor, {})).designs.find((value) => value.id === design.id)?.state).toBe("rejected")
    await register(work.batchId, work.collectionId, 1)
    expect((await store.status(actor, work.batchId)).candidates).toHaveLength(2)
  })
  it("delivers exactly 50 verified unique slots and replays completion without another collection", async () => {
    const work = await batch(50)
    for (let slot = 1; slot <= 50; slot++) {
      const design = await register(work.batchId, work.collectionId, slot)
      await upload(design)
      await review(work.batchId, slot)
    }
    const complete = await store.complete(actor, work.batchId)
    expect(complete.count).toBe(50)
    expect(new Set(complete.designNumbers).size).toBe(50)
    expect(await store.complete(actor, work.batchId)).toEqual(complete)
    await expect(store.claim(actor, work.batchId, 1, randomUUID())).rejects.toMatchObject({ code: "CONFLICT" })
  }, 20000)
  it("denies direct browser grant access and generation mutation while enforcing active-admin reads", async () => {
    await batch()
    const client = await database.connect()
    try {
      await client.query("begin")
      await client.query("set local role authenticated")
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [actor.userId])
      expect((await client.query("select * from public.design_generation_batches")).rows).toHaveLength(1)
      await expect(client.query("select * from private.design_agent_grants")).rejects.toMatchObject({ code: "42501" })
    } finally {
      await client.query("rollback")
      client.release()
    }
    const denied = await database.connect()
    try {
      await denied.query("begin")
      await denied.query("set local role authenticated")
      await expect(denied.query("update public.design_generation_slots set status='ready'")).rejects.toMatchObject({
        code: "42501",
      })
    } finally {
      await denied.query("rollback")
      denied.release()
    }
  })
  it("serializes an in-flight registration with rejection without resurrecting an extra collection member", async () => {
    const work = await batch(),
      workerId = randomUUID(),
      design = artwork(work.collectionId)
    await store.claim(actor, work.batchId, 1, workerId)
    const barrier = await database.connect()
    await barrier.query("select pg_advisory_lock(731952001)")
    try {
      const registering = store.register(actor, { batchId: work.batchId, slot: 1, workerId, design })
      await vi.waitFor(async () =>
        expect(
          (await database.query("select 1 from pg_locks where locktype='advisory' and not granted and objid=731952001"))
            .rows.length
        ).toBeGreaterThan(0)
      )
      let settled = false
      const rejecting = store.reject(actor, work.batchId, 1, "Replace the candidate").finally(() => {
        settled = true
      })
      await vi.waitFor(async () =>
        expect(
          settled ||
            (
              await database.query(
                "select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%design_generation_batches%'"
              )
            ).rows.length > 0
        ).toBe(true)
      )
      await barrier.query("select pg_advisory_unlock(731952001)")
      await registering
      await rejecting
      expect((await store.status(actor, work.batchId)).slots[0]).toMatchObject({
        status: "planned",
        candidate_id: null,
      })
      expect(
        (
          await database.query("select * from public.library_collection_designs where collection_id=$1", [
            work.collectionId,
          ])
        ).rows
      ).toHaveLength(0)
      expect(
        (await database.query("select state from public.library_designs where id=$1", [design.id])).rows[0].state
      ).toBe("rejected")
    } finally {
      await barrier.query("select pg_advisory_unlock(731952001)")
      barrier.release()
    }
  })
  it("rechecks completed batch status after rejection waits on a concurrent completion", async () => {
    const work = await batch(),
      design = await register(work.batchId, work.collectionId)
    await upload(design)
    await review(work.batchId)
    const barrier = await database.connect()
    await barrier.query("begin")
    await barrier.query("select * from public.design_generation_slots where batch_id=$1 for update", [work.batchId])
    try {
      const completing = store.complete(actor, work.batchId)
      await vi.waitFor(async () =>
        expect(
          (
            await database.query(
              "select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'select s.slot,s.status%'"
            )
          ).rows.length
        ).toBeGreaterThan(0)
      )
      const rejecting = store.reject(actor, work.batchId, 1, "Too late").then(
        () => ({ code: "accepted" }),
        (error: unknown) => ({ code: error instanceof DesignAgentError ? error.code : "unexpected" })
      )
      await vi.waitFor(async () =>
        expect(
          (
            await database.query(
              "select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and (query like '%design_generation_batches%' or query like 'select candidate_id%')"
            )
          ).rows.length
        ).toBeGreaterThan(0)
      )
      await barrier.query("commit")
      await completing
      expect(await rejecting).toEqual({ code: "CONFLICT" })
      expect((await store.status(actor, work.batchId)).slots[0]).toMatchObject({ status: "ready" })
    } finally {
      await barrier.query("rollback")
      barrier.release()
    }
  })
  it("detects extra collection members and preserves a completed receipt when later designs resemble it", async () => {
    const work = await batch(),
      design = await register(work.batchId, work.collectionId)
    await upload(design)
    await review(work.batchId)
    const extra = artwork(work.collectionId)
    await library.saveDesign(actor.userId, extra)
    await expect(store.complete(actor, work.batchId)).rejects.toMatchObject({ code: "CONFLICT" })
    await database.query("delete from public.library_collection_designs where collection_id=$1 and design_id=$2", [
      work.collectionId,
      extra.id,
    ])
    const receipt = await store.complete(actor, work.batchId),
      other = await batch(),
      neighbor = artwork(other.collectionId)
    neighbor.revision.assets[0]!.perceptualHash = design.revision.assets[0]!.perceptualHash
    await register(other.batchId, other.collectionId, 1, neighbor)
    expect(await store.complete(actor, work.batchId)).toEqual(receipt)
  })
  it("rechecks a concurrent registration committed before completion against the saved visual review", async () => {
    const work = await batch(),
      design = await register(work.batchId, work.collectionId)
    await upload(design)
    await review(work.batchId)
    const other = await batch(),
      neighbor = artwork(other.collectionId),
      workerId = randomUUID()
    neighbor.revision.assets[0]!.perceptualHash = design.revision.assets[0]!.perceptualHash
    await store.claim(actor, other.batchId, 1, workerId)
    const barrier = await database.connect()
    await barrier.query("select pg_advisory_lock(731952001)")
    try {
      const registering = store.register(actor, { batchId: other.batchId, slot: 1, workerId, design: neighbor })
      const waiting = async () =>
        (await database.query("select 1 from pg_locks where locktype='advisory' and not granted and objid=731952001"))
          .rows.length
      await vi.waitFor(async () => expect(await waiting()).toBe(1))
      const completing = store.complete(actor, work.batchId).then(
        () => ({ code: "accepted" }),
        (error: unknown) => ({ code: error instanceof DesignAgentError ? error.code : "unexpected" })
      )
      await vi.waitFor(async () => expect(await waiting()).toBe(2))
      await barrier.query("select pg_advisory_unlock(731952001)")
      await registering
      expect(await completing).toEqual({ code: "CONFLICT" })
      expect((await store.status(actor, work.batchId)).batch.status).not.toBe("ready")
      const inspection = await store.inspect(actor, work.batchId, 1)
      expect(inspection.neighbors.map((item) => item.designId)).toContain(neighbor.id)
      await review(work.batchId)
      expect(await store.complete(actor, work.batchId)).toMatchObject({ status: "ready", count: 1 })
    } finally {
      await barrier.query("select pg_advisory_unlock(731952001)")
      barrier.release()
    }
  })
  it("keeps failed registrations rejectable and interrupted receipts replayable", async () => {
    const work = await batch(2),
      original = await register(work.batchId, work.collectionId, 1),
      duplicate = artwork(work.collectionId),
      workerId = randomUUID()
    duplicate.revision.assets[0]!.sha256 = original.revision.assets[0]!.sha256
    await store.claim(actor, work.batchId, 2, workerId)
    await expect(
      store.register(actor, { batchId: work.batchId, slot: 2, workerId, design: duplicate })
    ).rejects.toMatchObject({ code: "CONFLICT" })
    expect(
      (await store.status(actor, work.batchId)).candidates.find((candidate) => candidate.id === duplicate.id)?.status
    ).toBe("failed")
    await store.reject(actor, work.batchId, 2, "Exact repeat")
    const replacement = await register(work.batchId, work.collectionId, 2)
    await database.query("update public.design_generation_candidates set status='registering' where id=$1", [
      replacement.id,
    ])
    await database.query("update public.design_generation_slots set status='registering' where candidate_id=$1", [
      replacement.id,
    ])
    expect(
      await store.register(actor, { batchId: work.batchId, slot: 2, workerId: randomUUID(), design: replacement })
    ).toMatchObject({ designId: replacement.id })
  })
  it("keeps completed review evidence immutable", async () => {
    const work = await batch(),
      candidate = await register(work.batchId, work.collectionId)
    await upload(candidate)
    await review(work.batchId)
    const receipt = await store.complete(actor, work.batchId)
    const before = (await store.status(actor, work.batchId)).candidates[0]!.review
    await expect(review(work.batchId)).rejects.toThrow("immutable")
    expect((await store.status(actor, work.batchId)).candidates[0]!.review).toEqual(before)
    expect(await store.complete(actor, work.batchId)).toEqual(receipt)
  })
  it("uses the database clock for claims and registration despite application clock skew", async () => {
    const work = await batch(),
      workerId = randomUUID(),
      candidate = artwork(work.collectionId)
    await store.claim(actor, work.batchId, 1, workerId)
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2099-01-01"))
    try {
      await expect(store.claim(actor, work.batchId, 1, randomUUID())).rejects.toThrow("Another worker")
      expect(
        await store.register(actor, { batchId: work.batchId, slot: 1, workerId, design: candidate })
      ).toMatchObject({ designId: candidate.id })
    } finally {
      vi.useRealTimers()
    }
    const expired = await batch(),
      expiredWorker = randomUUID()
    await store.claim(actor, expired.batchId, 1, expiredWorker)
    await database.query(
      "update public.design_generation_slots set lease_expires_at=now()-interval '1 minute' where batch_id=$1",
      [expired.batchId]
    )
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2000-01-01"))
    try {
      await expect(
        store.register(actor, {
          batchId: expired.batchId,
          slot: 1,
          workerId: expiredWorker,
          design: artwork(expired.collectionId),
        })
      ).rejects.toThrow("Claim")
      await expect(store.claim(actor, expired.batchId, 1, randomUUID())).resolves.toMatchObject({
        status: "generating",
      })
    } finally {
      vi.useRealTimers()
    }
  })
  it("does not block Auth user updates while an agent transaction holds membership and grant locks", async () => {
    const client = await database.connect(),
      auth = await database.connect()
    try {
      await client.query("begin")
      await grants.requireActive(actor, "library:write", client)
      await auth.query("begin; set local lock_timeout='100ms'")
      await auth.query("update auth.users set email='updated@example.test' where id=$1", [actor.userId])
    } finally {
      await auth.query("rollback")
      auth.release()
      await client.query("rollback")
      client.release()
    }
  })
})
