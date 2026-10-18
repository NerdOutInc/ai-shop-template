import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { expect, userEvent, within } from "storybook/test"
import type { GalleryEditorData } from "@/features/product-gallery/read-gallery-editor.server"
import { ProductPhotoEditor } from "./product-photo-editor"

const savedRevision = "00000000-0000-4000-8000-000000000010"
const uploadedAsset = "00000000-0000-4000-8000-000000000001"
const base: GalleryEditorData = {
  productId: "sample-tee",
  title: "Sample tee",
  revision: null,
  productRevision: "1",
  active: true,
  draft: { version: 1, coverColor: null, colors: [] },
  diagnostic: null,
  assets: [],
  history: [],
  artwork: null,
  colors: [
    {
      key: "10",
      title: "Black",
      hex: "#222222",
      available: true,
      recoverySelection: null,
      variantIds: [101],
      binding: { version: "gallery-v1/v2", digest: "a".repeat(64), sourceRevision: "1" },
      draftCurrent: false,
      activeMode: "Printify",
      activeStale: false,
      activeInvalid: false,
      providerImages: [
        { src: "/images/cart-hanger.svg", alt: "Synthetic garment placeholder", viewKey: "front", selectable: true },
        { src: "/images/store-mark.svg", alt: "Synthetic back placeholder", viewKey: "back", selectable: true },
      ],
    },
  ],
}
const savedDraft: GalleryEditorData = {
  ...base,
  revision: savedRevision,
  draft: {
    version: 1,
    coverColor: "10",
    colors: [
      {
        colorKey: "10",
        reviewedBinding: null,
        entries: [
          {
            source: "provider",
            src: "/images/cart-hanger.svg",
            sha256: "b".repeat(64),
            sourceRevision: "1",
            alt: "Sample tee front",
            role: "garment",
            viewKey: "front",
          },
          {
            source: "provider",
            src: "/images/store-mark.svg",
            sha256: "c".repeat(64),
            sourceRevision: "1",
            alt: "Sample tee back",
            role: "garment",
            viewKey: "back",
          },
        ],
      },
    ],
  },
  history: [{ revision: savedRevision, action: "save", createdAt: "2026-10-17T15:00:00.000Z" }],
}

/** Replays the gallery API in memory: activation prepares once, then completes. */
function galleryApi(initial: GalleryEditorData, options: { changedElsewhere?: boolean } = {}) {
  return () => {
    let state = initial,
      activations = 0
    const original = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const url = String(input)
      if (url.endsWith("/assets") && init?.method === "POST")
        return Response.json({ id: uploadedAsset, width: 1200, height: 1500 })
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { action: string }
        if (body.action === "activate" && activations++ === 0)
          return Response.json({ status: "preparing", completed: 1, total: 2 })
        state = {
          ...savedDraft,
          revision: "00000000-0000-4000-8000-000000000011",
          colors: savedDraft.colors.map((c) => ({ ...c, draftCurrent: body.action === "activate" })),
        }
        return Response.json(body.action === "activate" ? { status: "active", cacheRefreshed: true } : {})
      }
      return Response.json(
        options.changedElsewhere ? { ...state, revision: "00000000-0000-4000-8000-000000000012" } : state
      )
    }
    return () => {
      globalThis.fetch = original
    }
  }
}

const meta = {
  title: "Admin/Product photos",
  component: ProductPhotoEditor,
  parameters: { layout: "padded" },
  args: { initial: base },
  beforeEach: galleryApi(base),
} satisfies Meta<typeof ProductPhotoEditor>
export default meta
type Story = StoryObj<typeof meta>

export const ProviderOnly: Story = {}

export const SavedDraft: Story = { args: { initial: savedDraft }, beforeEach: galleryApi(savedDraft) }

export const ChooseAndReorder: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Choose photos for this color" }))
    await expect(canvas.getByText(/waiting for its close-up/)).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: /Add Printify photo 1/ }))
    await userEvent.click(canvas.getByRole("button", { name: /Add Printify photo 2/ }))
    const up = canvas.getByRole("button", { name: "Move photo 2 up" })
    up.focus()
    await userEvent.keyboard("{Enter}")
    // The moved photo is now first; its button stays focused so the keyboard keeps its place.
    await expect(canvas.getByRole("button", { name: "Move photo 1 up" })).toHaveFocus()
    await expect(canvas.getByRole("textbox", { name: "Photo 1 description" })).toHaveValue("Synthetic back placeholder")
    await userEvent.click(canvas.getByRole("button", { name: "Save draft" }))
    await canvas.findByText("Draft saved. The shop is unchanged.")
  },
}

export const FieldValidation: Story = {
  args: { initial: savedDraft },
  beforeEach: galleryApi(savedDraft),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.clear(canvas.getByRole("textbox", { name: "Photo 1 description" }))
    await expect(await canvas.findByText(/Photo 1, enter a description/)).toBeVisible()
    await expect(canvas.getByRole("button", { name: "Save draft" })).toBeDisabled()
  },
}

export const UploadPhoto: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvasElement.querySelector<HTMLInputElement>('input[type="file"]')!
    await userEvent.upload(input, new File(["synthetic"], "sample.png", { type: "image/png" }))
    await canvas.findByText("Photo uploaded privately. Add it to the correct color below.")
    await userEvent.click(canvas.getByRole("button", { name: "Choose photos for this color" }))
    await expect(canvas.getByRole("button", { name: /Add uploaded photo 1/ })).toBeEnabled()
  },
}

export const ReviewAndActivate: Story = {
  args: { initial: savedDraft },
  beforeEach: galleryApi(savedDraft),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Preview draft" }))
    await expect(canvas.getByText(/Private draft preview/)).toBeVisible()
    await userEvent.click(canvas.getByRole("checkbox", { name: /I reviewed Black/ }))
    await userEvent.click(canvas.getByRole("button", { name: "Activate gallery" }))
    await canvas.findByText(/Prepared 1 of 2 photos\. Nothing activated yet/)
    await userEvent.click(canvas.getByRole("button", { name: "Activate gallery" }))
    await canvas.findByText("Gallery activated. Your selections now belong to the store.")
  },
}

export const RefreshConflict: Story = {
  args: { initial: savedDraft },
  beforeEach: galleryApi(savedDraft, { changedElsewhere: true }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Move photo 2 up" }))
    await userEvent.click(canvas.getByRole("button", { name: "Refresh product" }))
    await canvas.findByText(/Another change was saved to this gallery/)
    await userEvent.click(canvas.getByRole("button", { name: "Keep my edits over latest draft" }))
    await canvas.findByText("Your edits are preserved. Review them before saving over the latest draft.")
    await expect(canvas.getByRole("textbox", { name: "Photo 1 description" })).toHaveValue("Sample tee back")
  },
}

export const RestoreHistory: Story = {
  args: { initial: savedDraft },
  beforeEach: galleryApi(savedDraft),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByText("Saved history"))
    await userEvent.selectOptions(canvas.getByRole("combobox", { name: "Saved revision" }), savedRevision)
    await userEvent.click(canvas.getByRole("button", { name: "Restore to draft" }))
    await canvas.findByText("Restored to draft. Review before activating.")
  },
}

export const NeedsReview: Story = {
  args: {
    initial: {
      ...base,
      diagnostic: "The active gallery cannot be read. Restore a saved revision or use Printify photos.",
      colors: base.colors.map((c) => ({ ...c, activeMode: "Mixed", activeStale: true })),
    },
  },
}

export const ColorUnavailable: Story = {
  args: {
    initial: {
      ...savedDraft,
      colors: savedDraft.colors.map((c) => ({ ...c, available: false, binding: null, variantIds: [] })),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/This color is currently unavailable/)).toBeVisible()
    await expect(canvas.getByRole("textbox", { name: "Photo 1 description" })).toBeDisabled()
  },
}

export const UnavailablePhotos: Story = {
  args: {
    initial: {
      ...base,
      colors: base.colors.map((c) => ({ ...c, activeMode: "Store photos only", activeInvalid: true })),
    },
  },
}
