import { DesignAgentError } from "./design-agent-error"
import type { DesignAgentScope } from "./design-agent-types"
import type { parseDesignAgentCommand } from "./parse-design-agent-command"

/** Keep the HTTP boundary and worker authorization on the same command policy. */
export function getDesignAgentCommandScope(
  command: ReturnType<typeof parseDesignAgentCommand>["command"]
): DesignAgentScope {
  switch (command) {
    case "drafts.create":
    case "drafts.reconcile":
    case "drafts.reconcileBinding":
    // drafts.propose writes nothing, but it reads Printify's catalogue with the store's drafts token,
    // and only an agent that may create a draft needs the answer. products.recipes stays under
    // library:read because it touches no token at all.
    case "drafts.propose":
      return "drafts:create"
    case "library.search":
    case "library.get":
    case "library.favorites":
    case "batch.status":
    case "slot.inspect":
    case "products.recipes":
      return "library:read"
    // Every write is named, and the `never` arm makes an unmapped command a compile error and a
    // runtime refusal. A `default` that returned a scope would silently authorize a typo under one
    // that is granted by default.
    case "artwork.assess":
    case "revision.prepare":
    case "revision.upload":
    case "revision.finalize":
    case "design.colors":
    case "batch.create":
    case "batch.plan":
    case "batch.complete":
    case "slot.claim":
    case "slot.register":
    case "slot.review":
    case "slot.reject":
    case "asset.upload":
    case "asset.finalize":
      return "library:write"
    default:
      command satisfies never
      throw new DesignAgentError("INVALID_INPUT", "Unknown command")
  }
}
