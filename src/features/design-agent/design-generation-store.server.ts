import "server-only"
import { createHash, randomUUID } from "node:crypto"
import type { Pool, PoolClient } from "pg"
import { createPostgresLibraryStore } from "@/features/design-library/postgres-library-store.server"
import { validateLibraryDesign } from "@/features/design-library/validate-library-design"
import type { LibraryDesignInput } from "@/features/design-library/library-types"
import { DesignAgentError } from "./design-agent-error"
import { DesignAgentGrantStore } from "./design-agent-grant-store.server"
import type { DesignAgentActor, DesignDirection, DesignNeighbor } from "./design-agent-types"

const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex")
const conflict = (message: string): never => {
  throw new DesignAgentError("CONFLICT", message)
}

export class DesignGenerationStore {
  private readonly grants: DesignAgentGrantStore
  private readonly library: ReturnType<typeof createPostgresLibraryStore>
  constructor(private readonly database: Pool) {
    this.grants = new DesignAgentGrantStore(database)
    this.library = createPostgresLibraryStore({ database })
  }

  private async transaction<T>(actor: DesignAgentActor, work: (client: PoolClient) => Promise<T>) {
    const client = await this.database.connect()
    try {
      await client.query("begin")
      await this.grants.requireActive(actor, "library:write", client)
      const result = await work(client)
      await client.query("commit")
      return result
    } catch (error) {
      await client.query("rollback")
      throw error
    } finally {
      client.release()
    }
  }

  private async owned(client: Pool | PoolClient, actor: DesignAgentActor, batchId: string, lock = false) {
    const row = (
      await client.query(
        `select * from public.design_generation_batches where id=$1 and user_id=$2${lock ? " for update" : ""}`,
        [batchId, actor.userId]
      )
    ).rows[0]
    if (!row) throw new DesignAgentError("NOT_FOUND", "Batch not found for this administrator")
    return row
  }

  async create(actor: DesignAgentActor, input: { requestId: string; title: string; brief: string; count: number }) {
    if (
      !Number.isInteger(input.count) ||
      input.count < 1 ||
      input.count > 200 ||
      !input.title.trim() ||
      !input.brief.trim()
    )
      throw new DesignAgentError("INVALID_INPUT", "A batch needs a title, brief, and exact count between 1 and 200")
    return this.transaction(actor, async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`${actor.userId}:${input.requestId}`])
      const existing = (
        await client.query("select * from public.design_generation_batches where user_id=$1 and request_id=$2", [
          actor.userId,
          input.requestId,
        ])
      ).rows[0]
      if (existing) {
        if (existing.request_hash !== hash(input))
          conflict("Request ID already belongs to a different batch brief or count")
        return { batchId: existing.id, collectionId: existing.collection_id, count: existing.requested_count }
      }
      const id = randomUUID(),
        collectionId = `batch:${id}`
      await client.query(
        "insert into public.library_collections(id,title,description,review_state) values($1,$2,$3,'draft')",
        [collectionId, input.title, input.brief]
      )
      await client.query(
        "insert into public.design_generation_batches(id,user_id,request_id,collection_id,title,brief,requested_count,request_hash) values($1,$2,$3,$4,$5,$6,$7,$8)",
        [id, actor.userId, input.requestId, collectionId, input.title, input.brief, input.count, hash(input)]
      )
      await client.query(
        "insert into public.design_generation_slots(batch_id,slot) select $1,generate_series(1,$2::int)",
        [id, input.count]
      )
      return { batchId: id, collectionId, count: input.count }
    })
  }

  async status(actor: DesignAgentActor, batchId: string) {
    await this.grants.requireActive(actor, "library:read")
    const batch = await this.owned(this.database, actor, batchId)
    const slots = (
      await this.database.query(
        "select slot,direction,status,lease_owner,lease_expires_at,candidate_id from public.design_generation_slots where batch_id=$1 order by slot",
        [batchId]
      )
    ).rows
    const candidates = (
      await this.database.query(
        "select id,slot,status,rejection_reason,review,payload from public.design_generation_candidates where batch_id=$1 order by created_at",
        [batchId]
      )
    ).rows
    return {
      batch,
      slots,
      candidates,
      galleryUrl: `/admin/concepts?collection=${encodeURIComponent(batch.collection_id)}`,
    }
  }

  async plan(actor: DesignAgentActor, batchId: string, directions: DesignDirection[]) {
    return this.transaction(actor, async (client) => {
      const batch = await this.owned(client, actor, batchId, true)
      const sorted = [...directions].sort((a, b) => a.slot - b.slot)
      if (sorted.length !== batch.requested_count || sorted.some((value, index) => value.slot !== index + 1))
        conflict("Record exactly one direction for each requested slot")
      const identities = sorted.map((value) =>
        hash(
          [value.subject, value.mechanism, value.composition, value.lettering].map((text) =>
            text.trim().replace(/\s+/g, " ").toLowerCase()
          )
        )
      )
      if (new Set(identities).size !== identities.length) conflict("Proposed directions must be distinct")
      const planHash = hash(sorted)
      if (batch.plan_hash) {
        if (batch.plan_hash !== planHash) conflict("The saved generation plan is immutable; resume its slots")
        return { planned: sorted.length }
      }
      for (const direction of sorted) {
        const references = [
          ...direction.avoidDesignNumbers,
          ...(direction.parentDesignNumber ? [direction.parentDesignNumber] : []),
        ]
        if (references.length) {
          const found = (
            await client.query(
              "select display_number from public.library_designs where display_number=any($1::bigint[])",
              [references]
            )
          ).rows
          if (new Set(found.map((row) => Number(row.display_number))).size !== new Set(references).size)
            conflict("A referenced prior design number is missing")
        }
        await client.query("update public.design_generation_slots set direction=$3 where batch_id=$1 and slot=$2", [
          batchId,
          direction.slot,
          direction,
        ])
      }
      await client.query("update public.design_generation_batches set plan_hash=$2,status='generating' where id=$1", [
        batchId,
        planHash,
      ])
      return { planned: sorted.length }
    })
  }

  async claim(actor: DesignAgentActor, batchId: string, slot: number, workerId: string) {
    return this.transaction(actor, async (client) => {
      const batch = await this.owned(client, actor, batchId, true)
      if (!batch.plan_hash || batch.status === "ready")
        conflict("Plan every slot before generation; completed batches cannot generate again")
      const row = (
        await client.query(
          "select *,coalesce(lease_expires_at>now(),false) as lease_active from public.design_generation_slots where batch_id=$1 and slot=$2 for update",
          [batchId, slot]
        )
      ).rows[0]
      if (!row) throw new DesignAgentError("NOT_FOUND", "Slot not found")
      if (["registering", "registered", "ready"].includes(row.status))
        return { slot, status: row.status, candidateId: row.candidate_id, resume: true }
      if (row.lease_active && row.lease_owner !== workerId) conflict("Another worker holds this generation slot")
      const claimed = (
        await client.query(
          "update public.design_generation_slots set status='generating',lease_owner=$3,lease_expires_at=now()+interval '15 minutes' where batch_id=$1 and slot=$2 returning slot,direction,status,lease_expires_at",
          [batchId, slot, workerId]
        )
      ).rows[0]
      return { ...claimed, workerId, resume: row.status === "generating" }
    })
  }

  async register(
    actor: DesignAgentActor,
    input: { batchId: string; slot: number; workerId: string; design: LibraryDesignInput }
  ) {
    const design = validateLibraryDesign(input.design)
    if (
      design.displayNumber ||
      design.state !== "active" ||
      design.revision.printReadiness === "ready" ||
      design.revision.assets.some((asset) => asset.status !== "pending" || asset.pathname || asset.sourcePath)
    )
      throw new DesignAgentError(
        "INVALID_INPUT",
        "New candidates require pending private assets, unverified print assessment, and new canonical identities"
      )
    if (
      !design.revision.assets.some((asset) => asset.kind === "preview") ||
      !design.revision.assets.some((asset) => asset.kind === "print")
    )
      throw new DesignAgentError(
        "INVALID_INPUT",
        "A generated candidate requires original, preview, and transparent print assets"
      )
    const print = design.revision.assets.find((asset) => asset.kind === "print")!
    if (print.mimeType !== "image/png" || !print.hasAlpha || !print.hasTransparency)
      throw new DesignAgentError("INVALID_INPUT", "The prepared print asset must be a transparent PNG")
    await this.transaction(actor, async (client) => {
      const batch = await this.owned(client, actor, input.batchId, true)
      if (design.collectionIds.length !== 1 || design.collectionIds[0] !== batch.collection_id)
        conflict("Candidate must belong only to its registered batch collection")
      const slot = (
        await client.query(
          "select *,coalesce(lease_expires_at>now(),false) as lease_active from public.design_generation_slots where batch_id=$1 and slot=$2 for update",
          [input.batchId, input.slot]
        )
      ).rows[0]
      if (!slot) throw new DesignAgentError("NOT_FOUND", "Slot not found")
      // Receipt admission has its own lock; artwork saving/completion keep the existing identity lock ordering.
      await client.query("select pg_advisory_xact_lock(731952002)")
      const existing = (
        await client.query("select * from public.design_generation_candidates where id=$1", [design.id])
      ).rows[0]
      if (existing) {
        if (
          existing.batch_id !== input.batchId ||
          existing.slot !== input.slot ||
          existing.payload_hash !== hash(design) ||
          existing.status === "rejected"
        )
          conflict("Candidate identity or immutable payload conflicts")
        return
      }
      if (
        slot.candidate_id ||
        slot.status !== "generating" ||
        slot.lease_owner !== input.workerId ||
        !slot.lease_active
      )
        conflict("Claim this slot before recording a new candidate")
      if (
        (
          await client.query(
            "select 1 from public.library_designs where id=$1 union all select 1 from public.library_artwork_revisions where id=$2 union all select 1 from public.library_assets where id=any($3::uuid[]) limit 1",
            [design.id, design.revision.id, design.revision.assets.map((asset) => asset.id)]
          )
        ).rows.length
      )
        conflict("This design, revision, or asset identity already exists outside the candidate receipt")
      await client.query(
        "insert into public.design_generation_candidates(id,batch_id,slot,payload,payload_hash) values($1,$2,$3,$4,$5)",
        [design.id, input.batchId, input.slot, design, hash(design)]
      )
      await client.query(
        "update public.design_generation_slots set candidate_id=$3,status='registering' where batch_id=$1 and slot=$2",
        [input.batchId, input.slot, design.id]
      )
    })
    // Replay uses one transaction/client for the library write and final receipt. Rejection locks the same batch.
    try {
      return await this.transaction(actor, async (client) => {
        const batch = await this.owned(client, actor, input.batchId, true)
        const candidate = (
          await client.query("select status from public.design_generation_candidates where id=$1", [design.id])
        ).rows[0]
        if (!candidate || candidate.status === "rejected")
          conflict("Candidate was rejected; its original registration cannot resume")
        const receipt = {
          designId: design.id,
          canonicalDesignId: design.id,
          assetIds: design.revision.assets.map((asset) => asset.id),
        }
        if (candidate.status === "registered" || candidate.status === "ready") return receipt
        if (batch.status === "ready") conflict("Completed batches cannot register additional artwork")
        await createPostgresLibraryStore({ database: this.database, transactionClient: client }).saveDesign(
          actor.userId,
          design
        )
        await client.query("update public.design_generation_candidates set status='registered' where id=$1", [
          design.id,
        ])
        await client.query("update public.design_generation_slots set status='registered' where candidate_id=$1", [
          design.id,
        ])
        return receipt
      })
    } catch (error) {
      await this.transaction(actor, async (client) => {
        await this.owned(client, actor, input.batchId, true)
        await client.query(
          "update public.design_generation_candidates set status='failed' where id=$1 and status='registering'",
          [design.id]
        )
      }).catch(() => undefined)
      throw error
    }
  }

  async ownedAsset(actor: DesignAgentActor, batchId: string, assetId: string) {
    await this.grants.requireActive(actor, "library:write")
    await this.owned(this.database, actor, batchId)
    const row = (
      await this.database.query(
        `select c.id from public.design_generation_candidates c join public.design_generation_slots s on s.candidate_id=c.id
      join public.library_assets a on a.revision_id=(c.payload->'revision'->>'id')::uuid
      where c.batch_id=$1 and a.id=$2 and c.status in ('registered','ready')`,
        [batchId, assetId]
      )
    ).rows[0]
    if (!row)
      throw new DesignAgentError("FORBIDDEN", "Upload must target an asset registered to this active batch candidate")
    const asset = await this.library.getAsset(actor.userId, assetId)
    if (!asset) throw new DesignAgentError("NOT_FOUND", "Registered asset is missing")
    return asset
  }

  private async neighbors(client: Pool | PoolClient, design: LibraryDesignInput): Promise<DesignNeighbor[]> {
    const original = design.revision.assets.find((asset) => asset.kind === "original")!
    if (!original.perceptualHash) conflict("An original perceptual fingerprint is required for visual comparison")
    const rows = (
      await client.query(
        `select distinct d.canonical_design_id as design_id,d.display_number,a.id as asset_id,a.perceptual_hash,a.sha256,a.pixel_sha256
      from public.library_designs d join public.library_artwork_revisions r on r.design_id=d.id join public.library_assets a on a.revision_id=r.id
      where a.kind='original' and a.status<>'unavailable' and d.canonical_design_id<>$1 order by d.canonical_design_id,d.display_number,a.id`,
        [design.id]
      )
    ).rows
    const seen = new Map<string, DesignNeighbor>()
    for (const row of rows) {
      if (row.sha256 === original.sha256 || row.pixel_sha256 === original.pixelSha256)
        conflict("Exact duplicate artwork exists in retained history")
      if (!row.perceptual_hash) continue
      let difference = BigInt(`0x${row.perceptual_hash}`) ^ BigInt(`0x${original.perceptualHash}`),
        distance = 0
      while (difference) {
        distance += Number(difference & 1n)
        difference >>= 1n
      }
      if (distance <= 8) {
        const key = `${row.design_id}:${row.perceptual_hash}`
        if (!seen.has(key))
          seen.set(key, {
            designId: row.design_id,
            displayNumber: Number(row.display_number),
            assetId: row.asset_id,
            distance,
            fingerprint: row.perceptual_hash,
          })
      }
    }
    return [...seen.values()].sort(
      (a, b) => a.designId.localeCompare(b.designId) || a.fingerprint.localeCompare(b.fingerprint)
    )
  }

  async inspect(actor: DesignAgentActor, batchId: string, slotNumber: number) {
    await this.grants.requireActive(actor, "library:read")
    await this.owned(this.database, actor, batchId)
    const row = (
      await this.database.query(
        `select c.* from public.design_generation_slots s join public.design_generation_candidates c on c.id=s.candidate_id where s.batch_id=$1 and s.slot=$2`,
        [batchId, slotNumber]
      )
    ).rows[0]
    if (!row) throw new DesignAgentError("NOT_FOUND", "No candidate has been registered for this slot")
    const neighbors = await this.neighbors(this.database, row.payload)
    return { candidateId: row.id, neighbors, comparisonHash: hash(neighbors) }
  }

  async review(
    actor: DesignAgentActor,
    input: {
      batchId: string
      slot: number
      comparisonHash: string
      reviewedAssetIds: string[]
      notes: string
      contactSheetReviewed: boolean
    }
  ) {
    return this.transaction(actor, async (client) => {
      const batch = await this.owned(client, actor, input.batchId, true)
      if (batch.status === "ready") conflict("Completed batch review evidence is immutable")
      const candidate = (
        await client.query(
          `select c.* from public.design_generation_slots s join public.design_generation_candidates c on c.id=s.candidate_id where s.batch_id=$1 and s.slot=$2 for update of s,c`,
          [input.batchId, input.slot]
        )
      ).rows[0]
      if (!candidate || candidate.status === "registering")
        conflict("Register the candidate and finish its uploads before review")
      const assets = (
        await client.query("select id,status from public.library_assets where revision_id=$1", [
          candidate.payload.revision.id,
        ])
      ).rows
      if (
        assets.length !== candidate.payload.revision.assets.length ||
        assets.some((asset) => asset.status !== "ready")
      )
        conflict("Every promised download must be byte-verified before review")
      const neighbors = await this.neighbors(client, candidate.payload)
      if (
        !input.contactSheetReviewed ||
        !input.notes.trim() ||
        input.comparisonHash !== hash(neighbors) ||
        neighbors.some((neighbor) => !input.reviewedAssetIds.includes(neighbor.assetId))
      )
        conflict(
          "Inspect the current flagged neighbor images and batch contact sheet, then record the comparison hash and visual decision"
        )
      const review = {
        comparisonHash: hash(neighbors),
        neighbors,
        reviewedAssetIds: input.reviewedAssetIds,
        notes: input.notes,
        contactSheetReviewed: true,
        reviewedBy: actor.userId,
        reviewedAt: new Date().toISOString(),
      }
      await client.query("update public.design_generation_candidates set review=$2,status='ready' where id=$1", [
        candidate.id,
        review,
      ])
      await client.query("update public.design_generation_slots set status='ready' where candidate_id=$1", [
        candidate.id,
      ])
      return { reviewed: true, nearDuplicates: neighbors.length }
    })
  }

  async reject(actor: DesignAgentActor, batchId: string, slot: number, reason: string) {
    if (!reason.trim()) throw new DesignAgentError("INVALID_INPUT", "Keep the reason for rejecting this candidate")
    return this.transaction(actor, async (client) => {
      const batch = await this.owned(client, actor, batchId, true)
      if (batch.status === "ready") conflict("Completed collections retain their final slot history")
      const row = (
        await client.query(
          "select candidate_id from public.design_generation_slots where batch_id=$1 and slot=$2 for update",
          [batchId, slot]
        )
      ).rows[0]
      if (!row?.candidate_id) conflict("No candidate is available to reject")
      const candidate = (
        await client.query("select status from public.design_generation_candidates where id=$1", [row.candidate_id])
      ).rows[0]
      if (candidate?.status === "registering")
        conflict("Replay the saved registration before rejecting an interrupted attempt")
      await client.query(
        "update public.design_generation_candidates set status='rejected',rejection_reason=$2 where id=$1",
        [row.candidate_id, reason]
      )
      await client.query("update public.library_designs set state='rejected' where id=$1", [row.candidate_id])
      await client.query("delete from public.library_collection_designs where collection_id=$1 and design_id=$2", [
        batch.collection_id,
        row.candidate_id,
      ])
      await client.query(
        "update public.design_generation_slots set candidate_id=null,status='planned',lease_owner=null,lease_expires_at=null where batch_id=$1 and slot=$2",
        [batchId, slot]
      )
      return { rejected: true }
    })
  }

  async complete(actor: DesignAgentActor, batchId: string) {
    return this.transaction(actor, async (client) => {
      const batch = await this.owned(client, actor, batchId, true)
      if (batch.status === "ready" && batch.completion_receipt) return batch.completion_receipt
      await client.query("select pg_advisory_xact_lock(731952001)")
      const slots = (
        await client.query(
          `select s.slot,s.status,c.id,c.payload,c.review from public.design_generation_slots s left join public.design_generation_candidates c on c.id=s.candidate_id where s.batch_id=$1 order by s.slot for update of s`,
          [batchId]
        )
      ).rows
      if (slots.length !== batch.requested_count || slots.some((slot) => slot.status !== "ready"))
        conflict("The exact requested count is not yet ready for review")
      for (const slot of slots) {
        const neighbors = await this.neighbors(client, slot.payload)
        if (slot.review?.comparisonHash !== hash(neighbors))
          conflict(`Slot ${slot.slot} has new similar neighbors; inspect and review it again`)
        const ready = (
          await client.query(
            "select count(*)::int as count from public.library_assets where revision_id=$1 and status='ready'",
            [slot.payload.revision.id]
          )
        ).rows[0].count
        if (ready !== slot.payload.revision.assets.length) conflict("A promised asset is no longer available")
      }
      const designs = (
        await client.query(
          "select id,display_number,canonical_design_id from public.library_designs where id=any($1::uuid[])",
          [slots.map((slot) => slot.id)]
        )
      ).rows
      if (new Set(designs.map((design) => design.canonical_design_id)).size !== batch.requested_count)
        conflict("Aliases and repeated canonical artwork cannot fill new-design slots")
      const members = (
        await client.query("select design_id from public.library_collection_designs where collection_id=$1", [
          batch.collection_id,
        ])
      ).rows.map((row) => row.design_id)
      if (members.length !== batch.requested_count || members.some((id) => !slots.some((slot) => slot.id === id)))
        conflict("Collection membership differs from the exact accepted generation slots")
      await client.query("update public.library_collections set review_state='ready' where id=$1", [
        batch.collection_id,
      ])
      const receipt = {
        status: "ready",
        count: designs.length,
        designNumbers: designs.map((design) => Number(design.display_number)).sort((a, b) => a - b),
        galleryUrl: `/admin/concepts?collection=${encodeURIComponent(batch.collection_id)}`,
      }
      await client.query(
        "update public.design_generation_batches set status='ready',completed_at=coalesce(completed_at,now()),completion_receipt=$2 where id=$1",
        [batchId, receipt]
      )
      return receipt
    })
  }

  async history(
    actor: DesignAgentActor,
    input: { search?: string; offset?: number; limit?: number; pendingOffset?: number }
  ) {
    await this.grants.requireActive(actor, "library:read")
    // Every retained design, whatever its state: this answers "have we drawn this before?",
    // and the response promises includesArchivedAndRejected below.
    const library = await this.library.listDesigns(actor.userId, {
      ...input,
      includePending: true,
      designState: "all",
    })
    const pending = (
      await this.database.query(
        `select b.id as batch_id,b.title,s.slot,s.direction,s.status from public.design_generation_batches b join public.design_generation_slots s on s.batch_id=b.id where b.status<>'ready' and ($1='' or s.direction::text ilike '%'||$1||'%') order by b.created_at,b.id,s.slot limit 200 offset $2`,
        [input.search ?? "", input.pendingOffset ?? 0]
      )
    ).rows
    const total = (
      await this.database.query(
        "select count(*)::int as count from public.design_generation_batches b join public.design_generation_slots s on s.batch_id=b.id where b.status<>'ready' and ($1='' or s.direction::text ilike '%'||$1||'%')",
        [input.search ?? ""]
      )
    ).rows[0].count
    return {
      ...library,
      pendingDirections: pending,
      pendingTotal: total,
      pendingOffset: input.pendingOffset ?? 0,
      includesArchivedAndRejected: true,
    }
  }
}
