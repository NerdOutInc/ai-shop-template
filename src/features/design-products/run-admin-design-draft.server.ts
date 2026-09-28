import "server-only"

import { AdminStore } from "@/features/admin/admin-store.server"
import { getAdminDatabase } from "@/features/admin/get-admin-database.server"

import type { DesignDraftInput } from "./design-draft-types"

import { DesignDraftError } from "./design-draft-error"
import { getDesignDraftServices } from "./get-design-draft-services.server"
import { proposeAdminDesignDraft } from "./propose-admin-design-draft.server"

type Services = Pick<ReturnType<typeof getDesignDraftServices>, "create" | "reconcile" | "frozenInput">

/**
 * One step of a signed-in administrator's draft: start it, continue it, or check an uncertain one.
 *
 * The draft pipeline advances one operation per call and insists on byte-identical instructions
 * for a request id. So a request that already exists is continued from its OWN frozen input, never
 * from a recipe rebuilt now: the provider's availability may have moved since, and a rebuilt
 * recipe that differs would be refused as different instructions.
 */
export async function runAdminDesignDraft(
  userId: string,
  input: {
    action: "create" | "reconcile"
    requestId: string
    designId: string
    displayNumber: number
    revisionId: string
  },
  options: {
    signal?: AbortSignal
    services?: Services
    propose?: typeof proposeAdminDesignDraft
  } = {}
) {
  const services =
    options.services ??
    getDesignDraftServices({
      userId,
      // No agent grant: the administrator's own standing is re-read before every provider write.
      grantId: null,
      signal: options.signal,
      authorize: async () => {
        if (!(await new AdminStore(getAdminDatabase()).isActiveMember(userId))) throw new Error("Not an administrator")
      },
    })

  if (input.action === "reconcile") return services.reconcile({ requestId: input.requestId })

  let frozen: DesignDraftInput | null = await services.frozenInput({ requestId: input.requestId })
  if (!frozen) {
    const { proposal } = await (options.propose ?? proposeAdminDesignDraft)(userId, input, { signal: options.signal })
    if (!proposal.recipe) throw new DesignDraftError("INVALID_INPUT", proposal.blockers.join(". "))
    frozen = {
      requestId: input.requestId,
      selection: { kind: "revisions", items: [{ designId: input.designId, revisionId: input.revisionId }] },
      recipe: proposal.recipe,
    }
  }
  const outcome = await services.create(frozen)

  // A reload loses the page's request id, and a second click then finds the model already reserved
  // by the first. That is this owner's own unfinished work, so carry it on rather than strand it.
  const owning = outcome.results[0]?.status === "reserved-elsewhere" ? outcome.results[0].owningRequestId : null
  const earlier = owning ? await services.frozenInput({ requestId: owning }) : null
  return earlier ? services.create(earlier) : outcome
}
