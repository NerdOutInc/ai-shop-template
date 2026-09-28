import { describe, expect, it } from "vitest"
import { getDesignAgentCommandScope } from "./get-design-agent-command-scope"
describe("command permission routing", () => {
  // The `never` arm is a compile-time guard; this is the same guard once the types are gone.
  it("refuses a command it does not name instead of answering with a scope", () => {
    const bogus = "products.publish" as unknown as Parameters<typeof getDesignAgentCommandScope>[0]
    expect(() => getDesignAgentCommandScope(bogus)).toThrow(
      expect.objectContaining({ name: "DesignAgentError", code: "INVALID_INPUT" })
    )
  })
  it("retains generation, download and draft permissions", () => {
    expect(getDesignAgentCommandScope("slot.register")).toBe("library:write")
    expect(getDesignAgentCommandScope("library.get")).toBe("library:read")
    expect(getDesignAgentCommandScope("drafts.create")).toBe("drafts:create")
  })

  it("reads the published catalogue under the read scope, since it touches no token", () => {
    expect(getDesignAgentCommandScope("products.recipes")).toBe("library:read")
  })

  // It writes nothing, but it spends the store's drafts token on a catalogue read, and only an agent
  // that may create a draft needs the answer.
  it("proposes drafts under the draft scope, not the read scope every default grant holds", () => {
    expect(getDesignAgentCommandScope("drafts.propose")).toBe("drafts:create")
    expect(getDesignAgentCommandScope("drafts.propose")).not.toBe("library:read")
  })
})
