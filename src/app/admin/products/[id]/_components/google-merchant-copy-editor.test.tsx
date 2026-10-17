import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type {
  GoogleCopyEditorState,
  GoogleCopyPreview,
} from "@/features/merchant-feed/google-merchant-copy-editor-state"
import { GoogleMerchantCopyEditor } from "./google-merchant-copy-editor"

let state: GoogleCopyEditorState
let preview: GoogleCopyPreview
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>
function methodCalls(method: string) {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === method)
}
async function ready() {
  const result = render(<GoogleMerchantCopyEditor productId="tee" />)
  await screen.findByText(/Saved revision 7/)
  return result
}
async function review() {
  await userEvent.click(screen.getByRole("button", { name: "Preview Google copy" }))
  await screen.findByRole("heading", { name: "Final Google descriptions" })
}
async function confirm() {
  await userEvent.click(screen.getByRole("checkbox", { name: /I have owner authorization/ }))
}
beforeEach(() => {
  state = {
    expectedRevision: "7",
    blocked: null,
    content: "Saved human wording.",
    origin: "human",
    originLocked: false,
    metadata: { pattern: "Graphic", materials: {} },
    issues: [],
    variants: [
      { id: 11, label: "Navy / M", selectable: true, selected: true, reason: null },
      { id: 12, label: "Navy / L", selectable: true, selected: false, reason: "UNCOVERED_VARIANT" },
      { id: 13, label: "Disabled", selectable: false, selected: false, reason: "DISABLED_VARIANT" },
    ],
    savedCopy: {
      version: 1,
      content: "Saved human wording.",
      origin: "human",
      shared_facts_hash: "a".repeat(64),
      reviewed_variants: [{ id: 11, fingerprint: "exact", label: "Navy / M", color: "Navy", size: "M" }],
      pattern: "Graphic",
      materials: {},
    },
  }
  preview = {
    expectedRevision: "7",
    copy: state.savedCopy!,
    digest: "b".repeat(64),
    descriptions: [
      {
        id: 11,
        label: "Navy / M",
        content: "Saved human wording. Color: Navy. Size: M.",
        previousContent: "Story.",
        origin: "human",
        effect: "retained",
        pattern: "Graphic",
      },
    ],
  }
  fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method === "POST") return Response.json(preview)
    if (init?.method === "PUT") {
      state = { ...state, expectedRevision: "8", savedCopy: preview.copy }
      return Response.json({ newRevision: "8" })
    }
    return Response.json(state)
  })
  vi.stubGlobal("fetch", fetchMock)
})

describe("Google copy client safety", () => {
  it("keeps one live region mounted from the initial read through an empty notice", async () => {
    render(<GoogleMerchantCopyEditor productId="tee" />)
    const status = screen.getByRole("status")
    expect(status).toHaveTextContent("Reading saved copy…")
    await screen.findByText(/Saved revision 7/)
    expect(screen.getAllByRole("status")).toEqual([status])
    expect(status).toBeEmptyDOMElement()
  })
  it.each([
    { reason: "a stale revision", code: "GOOGLE_COPY_REVISION_CHANGED", blocked: null, generated: false },
    {
      reason: "a pending job",
      code: "GOOGLE_COPY_WRITE_BLOCKED",
      blocked: "GOOGLE_COPY_WRITE_BLOCKED",
      generated: false,
    },
    { reason: "a concurrent generated save", code: "GOOGLE_COPY_REVISION_CHANGED", blocked: null, generated: true },
  ])("retains the draft and refreshes guards after $reason refuses Apply", async ({ code, blocked, generated }) => {
    await ready()
    const status = screen.getByRole("status")
    const wording = "Draft for a geometric graphic."
    await userEvent.clear(screen.getByRole("textbox"))
    await userEvent.type(screen.getByRole("textbox"), wording)
    await userEvent.click(screen.getByRole("radio", { name: /Human/ }))
    await userEvent.click(screen.getByRole("checkbox", { name: /Navy \/ L/ }))
    await review()
    await confirm()
    fetchMock.mockImplementationOnce(async () => {
      state = {
        ...state,
        expectedRevision: "8",
        blocked,
        content: "Another editor's saved wording.",
        origin: generated ? "generated" : "human",
        originLocked: generated,
        metadata: { pattern: "Updated graphic", materials: {} },
        savedCopy: {
          ...state.savedCopy!,
          content: "Another editor's saved wording.",
          origin: generated ? "generated" : "human",
          pattern: "Updated graphic",
          reviewed_variants: [{ id: 14, fingerprint: "fresh", label: "Clay / M", color: "Clay", size: "M" }],
        },
        variants: blocked
          ? []
          : [
              { ...state.variants[0]!, selectable: false, selected: false, reason: "DISABLED_VARIANT" },
              state.variants[1]!,
              { id: 14, label: "Clay / M", selectable: true, selected: true, reason: null },
            ],
      }
      return Response.json({ code }, { status: 409 })
    })
    await userEvent.click(screen.getByRole("button", { name: "Apply Google copy" }))
    await screen.findByText(/Apply refused/)
    await waitFor(() => expect(screen.getByRole("button", { name: "Read saved state" })).toBeEnabled())
    expect(screen.getAllByRole("status")).toEqual([status])
    expect(status).toHaveTextContent(code)
    expect(screen.getByRole("textbox")).toHaveValue(wording)
    expect(screen.getByText(/Saved revision 8/)).toBeVisible()
    expect(screen.getByText("Pattern: Updated graphic")).toBeVisible()
    expect(screen.getByRole("radio", { name: /Human/ })).not.toBeChecked()
    expect(screen.queryByRole("button", { name: "Apply Google copy" })).not.toBeInTheDocument()
    expect(screen.queryByText(/Committed revision/)).not.toBeInTheDocument()
    expect(methodCalls("PUT")).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([, init]) => !init?.method)).toHaveLength(2)
    if (blocked) {
      expect(screen.getByRole("textbox")).toBeDisabled()
      expect(screen.getByRole("alert")).toHaveTextContent(blocked)
      expect(screen.queryByRole("checkbox", { name: /Navy/ })).not.toBeInTheDocument()
    } else {
      expect(screen.getByRole("checkbox", { name: /Navy \/ M/ })).not.toBeChecked()
      expect(screen.getByRole("checkbox", { name: /Navy \/ L/ })).toBeChecked()
      expect(screen.getByRole("checkbox", { name: /Clay \/ M/ })).not.toBeChecked()
      if (generated) {
        expect(screen.getByRole("radio", { name: /Generated/ })).toBeChecked()
        expect(screen.getByRole("radio", { name: /Human/ })).toBeDisabled()
      } else {
        expect(screen.getByRole("radio", { name: /Generated/ })).not.toBeChecked()
        expect(screen.getByRole("button", { name: "Preview Google copy" })).toBeDisabled()
        await userEvent.click(screen.getByRole("radio", { name: /Human/ }))
      }
      await review()
      expect(JSON.parse(String(methodCalls("POST").at(-1)![1]!.body))).toEqual({
        expectedRevision: "8",
        content: wording,
        origin: generated ? "generated" : "human",
        variantIds: [12],
      })
    }
  })
  it("leaves absent copy blank, unchecked and requiring explicit origin", async () => {
    state = {
      ...state,
      content: "",
      origin: null,
      savedCopy: null,
      variants: state.variants.map((v) => ({ ...v, selected: false })),
    }
    await ready()
    expect(screen.getByRole("textbox", { name: "Shared base wording" })).toHaveValue("")
    expect(screen.getByRole("button", { name: "Preview Google copy" })).toBeDisabled()
    expect(screen.getByRole("checkbox", { name: /Navy \/ M/ })).not.toBeChecked()
    expect(screen.getByRole("radio", { name: /Human/ })).not.toBeChecked()
  })
  it("invalidates preview and human attestation on edits, and confirmation on origin or selection edits", async () => {
    await ready()
    await review()
    await confirm()
    await userEvent.type(screen.getByRole("textbox"), " Edited")
    expect(screen.queryByRole("heading", { name: "Final Google descriptions" })).not.toBeInTheDocument()
    expect(screen.getByRole("radio", { name: /Human/ })).not.toBeChecked()
    expect(screen.getByRole("button", { name: "Preview Google copy" })).toBeDisabled()
    await userEvent.click(screen.getByRole("radio", { name: /Human/ }))
    await review()
    await confirm()
    await userEvent.click(screen.getByRole("checkbox", { name: /Navy \/ L/ }))
    expect(screen.queryByRole("button", { name: "Apply Google copy" })).not.toBeInTheDocument()
    await review()
    expect(screen.getByRole("checkbox", { name: /I have owner authorization/ })).not.toBeChecked()
    await userEvent.click(screen.getByRole("radio", { name: /Generated/ }))
    expect(screen.queryByRole("button", { name: "Apply Google copy" })).not.toBeInTheDocument()
  })
  it("keeps known generated origin after human edits and displays immutable metadata", async () => {
    state = { ...state, origin: "generated", originLocked: true }
    await ready()
    await userEvent.type(screen.getByRole("textbox"), " Edited")
    expect(screen.getByRole("radio", { name: /Generated/ })).toBeChecked()
    expect(screen.getByRole("radio", { name: /Human/ })).toBeDisabled()
    expect(screen.getByText("Pattern: Graphic")).toBeVisible()
    expect(screen.getByText("Materials: {}")).toBeVisible()
    expect(screen.getAllByRole("textbox")).toHaveLength(1)
  })
  it("blocks malformed recovery, unusable identities, and human labels with incomplete history", async () => {
    state = { ...state, origin: null, issues: [{ code: "GOOGLE_COPY_PROVENANCE_INCOMPLETE" }] }
    const result = await ready()
    expect(screen.getByRole("radio", { name: /Human/ })).toBeDisabled()
    expect(screen.getByRole("checkbox", { name: /Disabled/ })).toBeDisabled()
    result.unmount()
    state.blocked = "GOOGLE_COPY_INVALID_RECORD"
    await ready()
    expect(screen.getByRole("alert")).toHaveTextContent("separately authorized")
    expect(screen.getByRole("textbox")).toBeDisabled()
  })
  it.each(["cancel", "edit", "navigate", "unmount"])("ignores a late preview after %s", async (kind) => {
    const result = await ready()
    const pending = Promise.withResolvers<Response>()
    fetchMock.mockImplementationOnce(async () => pending.promise)
    await userEvent.click(screen.getByRole("button", { name: "Preview Google copy" }))
    if (kind === "cancel") await userEvent.click(screen.getByRole("button", { name: "Cancel preview" }))
    if (kind === "edit") await userEvent.type(screen.getByRole("textbox"), "Changed")
    if (kind === "navigate") result.rerender(<GoogleMerchantCopyEditor productId="other" />)
    if (kind === "unmount") result.unmount()
    await act(async () => {
      pending.resolve(Response.json(preview))
      await pending.promise
    })
    expect(screen.queryByRole("heading", { name: "Final Google descriptions" })).not.toBeInTheDocument()
    expect(methodCalls("PUT")).toHaveLength(0)
  })
  it("applies once with the frozen object and confirmation, shows committed revision, reloads and removes the old preview", async () => {
    await ready()
    const status = screen.getByRole("status")
    await review()
    await confirm()
    const apply = screen.getByRole("button", { name: "Apply Google copy" })
    fireEvent.click(apply)
    fireEvent.click(apply)
    await screen.findByText(/Committed revision 8/)
    await screen.findByText(/Saved revision 8/)
    expect(screen.getAllByRole("status")).toEqual([status])
    expect(status).toHaveTextContent("Committed revision 8")
    expect(methodCalls("PUT")).toHaveLength(1)
    expect(JSON.parse(String(methodCalls("PUT")[0]![1]!.body))).toEqual({
      expectedRevision: "7",
      copy: preview.copy,
      digest: preview.digest,
      confirmation: "APPLY_GOOGLE_COPY",
    })
    expect(screen.queryByRole("button", { name: "Apply Google copy" })).not.toBeInTheDocument()
  })
  it.each(["503", "lost", "invalid-success"])(
    "reads saved state after %s without optimism, attribution or automatic retry",
    async (kind) => {
      await ready()
      const status = screen.getByRole("status")
      await review()
      await confirm()
      fetchMock.mockImplementationOnce(async () => {
        if (kind === "lost") throw new Error("connection lost")
        return Response.json(kind === "503" ? { error: "unknown" } : {}, { status: kind === "503" ? 503 : 200 })
      })
      await userEvent.click(screen.getByRole("button", { name: "Apply Google copy" }))
      await screen.findByText(/does not prove which request saved it/)
      await waitFor(() => expect(screen.getByRole("button", { name: "Read saved state" })).toBeEnabled())
      expect(screen.getAllByRole("status")).toEqual([status])
      expect(status).toHaveTextContent("Apply outcome unknown")
      expect(fetchMock.mock.calls.filter(([, init]) => !init?.method)).toHaveLength(2)
      expect(methodCalls("PUT")).toHaveLength(1)
      expect(screen.queryByText(/Committed revision/)).not.toBeInTheDocument()
      expect(screen.queryByRole("button", { name: "Apply Google copy" })).not.toBeInTheDocument()
    }
  )
  it("keeps all decisions blocked if unknown-outcome readback fails", async () => {
    await ready()
    await review()
    await confirm()
    fetchMock.mockRejectedValueOnce(new Error("lost")).mockRejectedValueOnce(new Error("read failed"))
    await userEvent.click(screen.getByRole("button", { name: "Apply Google copy" }))
    await screen.findByText(/Saved state is unavailable/)
    expect(screen.getByRole("textbox")).toBeDisabled()
    expect(methodCalls("PUT")).toHaveLength(1)
  })
  it("cancellation and ordinary keyboard Enter never submit Apply", async () => {
    await ready()
    await userEvent.click(screen.getByRole("textbox"))
    await userEvent.keyboard("{Enter}")
    await userEvent.click(screen.getByRole("radio", { name: /Human/ }))
    await review()
    await confirm()
    await userEvent.click(screen.getByRole("button", { name: "Cancel preview" }))
    expect(screen.queryByRole("button", { name: "Apply Google copy" })).not.toBeInTheDocument()
    expect(methodCalls("PUT")).toHaveLength(0)
  })
})
