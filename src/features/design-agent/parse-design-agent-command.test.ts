import { describe, it, expect } from "vitest"
import { parseDesignAgentCommand } from "./parse-design-agent-command"
import { designDraftInput } from "../../../test/design-draft-input"
const batchId = "4d2d7850-7360-40fb-bbe3-32d5a1c9dbb8"
describe("agent command contract", () => {
  it.each(["publish", "products.publish", "drafts.publish", "membership.grant", "grant.issue", "unsupported.command"])(
    "keeps %s outside delegated agent commands",
    (command) => {
      expect(() => parseDesignAgentCommand({ command })).toThrow()
    }
  )
  it("rejects missing visual decisions and oversized batches", () => {
    expect(() =>
      parseDesignAgentCommand({
        command: "slot.review",
        batchId,
        slot: 1,
        comparisonHash: "a".repeat(64),
        reviewedAssetIds: [],
        notes: "Checked",
        contactSheetReviewed: false,
      })
    ).toThrow()
    expect(() =>
      parseDesignAgentCommand({
        command: "batch.create",
        requestId: batchId,
        title: "Too many",
        brief: "Sloths",
        count: 201,
      })
    ).toThrow()
  })
  it("keeps personal favorite identity server-owned and explicit generation request IDs intact", () => {
    expect(() => parseDesignAgentCommand({ command: "library.favorites", userId: batchId })).toThrow()
    expect(parseDesignAgentCommand({ command: "batch.status", batchId })).toEqual({
      command: "batch.status",
      batchId,
    })
  })
  it("requires a complete delegated recipe and rejects a caller-selected favorite owner", () => {
    const valid = { command: "drafts.create", input: designDraftInput }
    expect(parseDesignAgentCommand(valid)).toEqual(valid)
    expect(() =>
      parseDesignAgentCommand({ command: "drafts.create", input: { selection: { kind: "favorites" } } })
    ).toThrow()
    expect(() => parseDesignAgentCommand({ ...valid, userId: batchId })).toThrow()
    expect(() =>
      parseDesignAgentCommand({
        ...valid,
        input: { ...designDraftInput, selection: { kind: "favorites", userId: batchId } },
      })
    ).toThrow()
  })

  it("takes a page of design numbers to propose drafts for, and nothing that could steer the recipe", () => {
    const valid = { command: "drafts.propose", numbers: [149, 211] }
    expect(parseDesignAgentCommand(valid)).toEqual(valid)
    expect(() => parseDesignAgentCommand({ command: "drafts.propose", numbers: [] })).toThrow()
    expect(() => parseDesignAgentCommand({ command: "drafts.propose", numbers: [0] })).toThrow()
    expect(() => parseDesignAgentCommand({ command: "drafts.propose", numbers: [1.5] })).toThrow()
    // One catalogue read serves the page, so the page is capped rather than the library dumped.
    expect(() =>
      parseDesignAgentCommand({ command: "drafts.propose", numbers: Array.from({ length: 51 }, (_, i) => i + 1) })
    ).toThrow()
    // Strict: the colors come from the design and the owner from the grant, never from the caller.
    expect(() => parseDesignAgentCommand({ ...valid, colors: ["Black"] })).toThrow()
    expect(() => parseDesignAgentCommand({ ...valid, userId: batchId })).toThrow()
  })

  it("takes the published-catalogue read with no arguments at all", () => {
    expect(parseDesignAgentCommand({ command: "products.recipes" })).toEqual({ command: "products.recipes" })
    expect(() => parseDesignAgentCommand({ command: "products.recipes", limit: 5 })).toThrow()
  })
})
