import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { expect, userEvent, within } from "storybook/test"

import { displayColorName } from "@/lib/display-color-name"
import type {
  GoogleCopyEditorState,
  GoogleCopyPreview,
} from "@/features/merchant-feed/google-merchant-copy-editor-state"

import { GoogleMerchantCopyEditor } from "./google-merchant-copy-editor"

function controlledResponses(outcome: "success" | "unknown" | "delayed") {
  return () => {
    let state: GoogleCopyEditorState = {
      expectedRevision: "7",
      blocked: null,
      content: "",
      origin: null,
      originLocked: false,
      metadata: {},
      savedCopy: null,
      issues: [],
      variants: [
        { id: 11, label: "Navy / M", selectable: true, selected: false, reason: "UNCOVERED_VARIANT" },
        { id: 12, label: "Blue / L", selectable: true, selected: false, reason: "UNCOVERED_VARIANT" },
        { id: 13, label: "Disabled color / M", selectable: false, selected: false, reason: "DISABLED_VARIANT" },
      ],
    }
    const original = globalThis.fetch
    globalThis.fetch = async (_input, init) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as {
          content: string
          origin: "generated" | "human"
          variantIds: number[]
        }
        const copy: GoogleCopyPreview["copy"] = {
          version: 1,
          content: body.content,
          origin: body.origin,
          shared_facts_hash: "a".repeat(64),
          reviewed_variants: body.variantIds.map((id) => ({
            id,
            fingerprint: `exact-${id}`,
            label: state.variants.find((v) => v.id === id)!.label,
            color: id === 11 ? "Navy" : "Blue",
            size: id === 11 ? "M" : "L",
          })),
        }
        if (outcome === "delayed") await new Promise((resolve) => setTimeout(resolve, 1500))
        return Response.json({
          expectedRevision: "7",
          copy,
          digest: "b".repeat(64),
          descriptions: state.variants
            .filter((v) => v.selectable)
            .map((v) => {
              const identity = copy.reviewed_variants.find((p) => p.id === v.id)
              return {
                id: v.id,
                label: v.label,
                content: identity
                  ? `${body.content} Color: ${displayColorName(identity.color)}. Size: ${identity.size}.`
                  : "Published description fallback.",
                origin: identity ? body.origin : "fallback",
                effect: identity ? "added" : "fallback",
                previousContent: "Published description fallback.",
              }
            }),
        } satisfies GoogleCopyPreview)
      }
      if (init?.method === "PUT") {
        if (outcome === "unknown") return Response.json({ code: "GOOGLE_COPY_UNKNOWN" }, { status: 503 })
        const body = JSON.parse(String(init.body)) as { copy: GoogleCopyPreview["copy"] }
        state = {
          ...state,
          expectedRevision: "8",
          content: body.copy.content,
          origin: body.copy.origin,
          originLocked: body.copy.origin === "generated",
          savedCopy: body.copy,
          variants: state.variants.map((v) => ({
            ...v,
            selected: body.copy.reviewed_variants.some((p) => p.id === v.id),
          })),
        }
        return Response.json({ newRevision: "8" })
      }
      return Response.json(state)
    }
    return () => {
      globalThis.fetch = original
    }
  }
}
const meta = {
  title: "Admin/Google Merchant copy",
  component: GoogleMerchantCopyEditor,
  args: { productId: "story-tee" },
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <main className="mx-auto max-w-4xl px-4">
        <Story />
      </main>
    ),
  ],
  beforeEach: controlledResponses("success"),
} satisfies Meta<typeof GoogleMerchantCopyEditor>
export default meta
type Story = StoryObj<typeof meta>

async function fillAndPreview(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  const textbox = await canvas.findByRole("textbox", { name: "Shared base wording" })
  await userEvent.click(canvas.getByRole("radio", { name: /Generated/ }))
  await userEvent.type(textbox, "A geometric graphic on a crewneck tee.")
  await expect(canvas.getByRole("radio", { name: /Generated/ })).toBeChecked()
  await userEvent.click(canvas.getByRole("checkbox", { name: /Navy/ }))
  await userEvent.click(canvas.getByRole("button", { name: "Preview Google copy" }))
  return canvas
}
export const ReviewAndApply: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await fillAndPreview(canvasElement)
    await canvas.findByRole("heading", { name: "Final Google descriptions" })
    await expect(canvas.getByText("A geometric graphic on a crewneck tee. Color: Navy. Size: M.")).toBeVisible()
    await expect(canvas.getByText("Published description fallback.")).toBeVisible()
    await expect(canvas.getByRole("button", { name: "Apply Google copy" })).toBeDisabled()
    await userEvent.click(canvas.getByRole("checkbox", { name: /I have owner authorization/ }))
    await userEvent.click(canvas.getByRole("button", { name: "Apply Google copy" }))
    await canvas.findByText(/Committed revision 8/)
    await canvas.findByText(/Saved revision 8/)
  },
}
export const UnknownOutcome: Story = {
  beforeEach: controlledResponses("unknown"),
  play: async ({ canvasElement }) => {
    const canvas = await fillAndPreview(canvasElement)
    await canvas.findByRole("heading", { name: "Final Google descriptions" })
    await userEvent.click(canvas.getByRole("checkbox", { name: /I have owner authorization/ }))
    await userEvent.click(canvas.getByRole("button", { name: "Apply Google copy" }))
    await canvas.findByText(/does not prove which request saved it/)
    await expect(canvas.queryByRole("button", { name: "Apply Google copy" })).not.toBeInTheDocument()
  },
}
export const CancelLatePreview: Story = {
  beforeEach: controlledResponses("delayed"),
  play: async ({ canvasElement }) => {
    const canvas = await fillAndPreview(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Cancel preview" }))
    await expect(canvas.queryByRole("heading", { name: "Final Google descriptions" })).not.toBeInTheDocument()
  },
}
export const BlankEditor: Story = {}
