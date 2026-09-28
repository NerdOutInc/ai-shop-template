import { getDesignAgentCommandScope } from "./get-design-agent-command-scope"
import "server-only"
import type { Pool } from "pg"
import { createPostgresLibraryStore } from "@/features/design-library/postgres-library-store.server"
import { validateLibraryDesign } from "@/features/design-library/validate-library-design"
import { validateLibraryRevision } from "@/features/design-library/validate-library-revision"
import { issuePrivateAssetUpload } from "@/features/design-library/issue-private-asset-upload.server"
import { verifyPrivateAssetUpload } from "@/features/design-library/verify-private-asset-upload.server"
import { getDesignDraftServices } from "@/features/design-products/get-design-draft-services.server"
import { listPublishedProductRecipes } from "@/features/design-products/list-published-product-recipes.server"
import { proposeDesignDrafts } from "@/features/design-products/propose-design-drafts.server"

import { DesignAgentError } from "./design-agent-error"
import { DesignAgentGrantStore } from "./design-agent-grant-store.server"
import { DesignGenerationStore } from "./design-generation-store.server"
import type { DesignAgentActor } from "./design-agent-types"
import { parseDesignAgentCommand } from "./parse-design-agent-command"

export async function executeDesignAgentCommand(
  database: Pool,
  actor: DesignAgentActor,
  command: ReturnType<typeof parseDesignAgentCommand>,
  options: { signal?: AbortSignal } = {}
) {
  const store = new DesignGenerationStore(database),
    grants = new DesignAgentGrantStore(database),
    library = createPostgresLibraryStore({ database })
  const scope = getDesignAgentCommandScope(command.command)
  await grants.requireActive(actor, scope)
  if (scope === "drafts:create") {
    // Answered before the draft services exist, because it reserves and writes nothing. The recipe
    // goes back to the agent; the drafts token that read the catalogue for it does not.
    if (command.command === "drafts.propose")
      return proposeDesignDrafts(
        actor.userId,
        { numbers: command.numbers },
        {
          signal: options.signal,
          getDesign: (userId, number) => library.getDesign(userId, number, { includePending: true }),
        }
      )
    const drafts = getDesignDraftServices({
      ...actor,
      database,
      signal: options.signal,
      authorize: () => grants.requireActive(actor, "drafts:create"),
    })
    switch (command.command) {
      case "drafts.create":
        return drafts.create(command.input)
      case "drafts.reconcile":
        return drafts.reconcile({ requestId: command.requestId })
      case "drafts.reconcileBinding":
        return drafts.reconcileBinding({ bindingId: command.bindingId })
    }
  }
  async function preparedAsset(revisionId: string, assetId: string) {
    const asset = await library.getRevisionAsset(actor.userId, revisionId, assetId)
    if (!asset) throw new DesignAgentError("NOT_FOUND", "That asset does not belong to this artwork revision")
    return asset
  }
  switch (command.command) {
    case "artwork.assess":
      return library.finalizePrintAssessment(actor.userId, command)
    case "library.search":
      return store.history(actor, command)
    case "library.get":
      return library.getDesign(actor.userId, command.number, { includePending: true })
    case "revision.prepare":
      return library.prepareRevision(actor.userId, {
        designId: command.designId,
        revision: validateLibraryRevision(command.revision),
      })
    case "revision.upload": {
      const asset = await preparedAsset(command.revisionId, command.assetId)
      if (asset.status === "ready") return { assetId: asset.id, status: "ready" }
      await grants.requireActive(actor, "library:write")
      return { ...(await issuePrivateAssetUpload(asset)), assetId: asset.id, sha256: asset.sha256, bytes: asset.bytes }
    }
    case "revision.finalize": {
      const asset = await preparedAsset(command.revisionId, command.assetId)
      await grants.requireActive(actor, "library:write")
      const verified = await verifyPrivateAssetUpload(asset)
      await grants.requireActive(actor, "library:write")
      await library.finalizeAsset(actor.userId, verified)
      return { assetId: asset.id, status: "ready" }
    }
    case "design.colors":
      return library.setDesignColors(actor.userId, {
        designId: command.designId,
        colors: command.colors.map((name) => ({ name, source: "assigned" as const })),
      })
    case "library.favorites":
      // The owner's complete saved selection, independent of the library's own filters:
      // a favorite the owner later archived is still a favorite, and dropping it silently
      // would hand product creation a shorter list than the owner saved.
      return library.listDesigns(actor.userId, {
        favoritesOnly: true,
        designState: "all",
        offset: command.offset,
        limit: command.limit,
      })
    case "batch.create":
      return store.create(actor, command)
    case "batch.status":
      return store.status(actor, command.batchId)
    case "batch.plan":
      return store.plan(actor, command.batchId, command.directions)
    case "slot.claim":
      return store.claim(actor, command.batchId, command.slot, command.workerId)
    case "slot.register":
      return store.register(actor, { ...command, design: validateLibraryDesign(command.design) })
    case "slot.inspect":
      return store.inspect(actor, command.batchId, command.slot)
    case "slot.review":
      return store.review(actor, command)
    case "slot.reject":
      return store.reject(actor, command.batchId, command.slot, command.reason)
    case "batch.complete":
      return store.complete(actor, command.batchId)
    case "asset.upload": {
      const asset = await store.ownedAsset(actor, command.batchId, command.assetId)
      if (asset.status === "ready") return { assetId: asset.id, status: "ready" }
      await grants.requireActive(actor, "library:write")
      return { ...(await issuePrivateAssetUpload(asset)), assetId: asset.id, sha256: asset.sha256, bytes: asset.bytes }
    }
    case "asset.finalize": {
      const asset = await store.ownedAsset(actor, command.batchId, command.assetId)
      await grants.requireActive(actor, "library:write")
      const verified = await verifyPrivateAssetUpload(asset)
      await grants.requireActive(actor, "library:write")
      await library.finalizeAsset(actor.userId, verified)
      return { assetId: asset.id, status: "ready" }
    }
    // The shop's own published product models, so the agent offers a short real list rather than the
    // whole Printify catalogue. Read-only, and it touches no Printify token.
    case "products.recipes":
      return listPublishedProductRecipes()
    // Handled above, under the drafts:create scope, which returns before reaching here. Named so the
    // exhaustiveness check below can be a real guard rather than a comment.
    case "drafts.create":
    case "drafts.propose":
    case "drafts.reconcile":
    case "drafts.reconcileBinding":
      throw new DesignAgentError("INVALID_INPUT", "Draft commands are handled under their own scope")
    // `satisfies never` makes an unmapped command a compile error. The throw covers what the compiler
    // cannot see: without it such a command would be answered with HTTP 200, not refused.
    default:
      command satisfies never
      throw new DesignAgentError("INVALID_INPUT", "Unknown command")
  }
}
