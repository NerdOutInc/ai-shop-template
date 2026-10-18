import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { expect, userEvent, within } from "storybook/test"
import {
  type GalleryActivation,
  type GalleryMutation,
  galleryMutationSchema,
} from "@/features/product-gallery/gallery-mutation-schema"
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

type SentRequest = { url: string; headers: Headers; body: unknown }
/** Requests the in-memory API accepted during the current story, newest last. */
const sent: SentRequest[] = []
const rejected = (error: string) => Response.json({ error }, { status: 400 })

/**
 * Replays the gallery API in memory and enforces the same client contracts as the server: the upload byte
 * header, current revisions, the mutation schema and per-color binding digests. Activation prepares once,
 * then completes.
 */
function galleryApi(initial: GalleryEditorData, options: { changedElsewhere?: boolean } = {}) {
  let state = options.changedElsewhere ? { ...initial, revision: "00000000-0000-4000-8000-000000000012" } : initial,
    activations = 0
  sent.length = 0
  const original = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (init?.method !== "POST") return Response.json(state)
    const headers = new Headers(init.headers)
    if (url.endsWith("/assets")) {
      const file = init.body
      if (!(file instanceof Blob)) return rejected("Upload the photo file itself.")
      if (headers.get("x-photo-bytes") !== String(file.size)) return rejected("Photo size header does not match.")
      if (headers.get("content-type") !== file.type) return rejected("Photo type header does not match.")
      sent.push({ url, headers, body: file })
      return Response.json({ id: uploadedAsset, width: 1200, height: 1500 })
    }
    const parsed = galleryMutationSchema.safeParse(JSON.parse(String(init.body)))
    if (!parsed.success) return rejected("The gallery request is malformed.")
    const body = parsed.data
    if (body.revision !== state.revision || body.productRevision !== state.productRevision)
      return rejected("The gallery changed. Reload before retrying.")
    if (body.action === "activate") {
      const expected = Object.fromEntries(
        state.draft.colors.flatMap((c) => {
          const current = state.colors.find((v) => v.key === c.colorKey)
          return current?.available && !current.draftCurrent && current.binding
            ? [[c.colorKey, current.binding.digest]]
            : []
        })
      )
      if (JSON.stringify(body.confirmations) !== JSON.stringify(expected))
        return rejected("Review every changed color against its current production details.")
    }
    if (body.action === "restore" && !state.history.some((h) => h.revision === body.fromRevision))
      return rejected("That saved revision is unavailable.")
    sent.push({ url, headers, body })
    if (body.action === "activate" && activations++ === 0)
      return Response.json({ status: "preparing", completed: 1, total: 2 })
    state = {
      ...savedDraft,
      revision: "00000000-0000-4000-8000-000000000011",
      colors: savedDraft.colors.map((c) => ({ ...c, draftCurrent: body.action === "activate" })),
    }
    return Response.json(body.action === "activate" ? { status: "active", cacheRefreshed: true } : {})
  }
  return () => {
    globalThis.fetch = original
  }
}

const meta = {
  title: "Admin/Product photos",
  component: ProductPhotoEditor,
  parameters: { layout: "padded" },
  args: { initial: base },
  // One mock per story, seeded from the story's own initial data.
  beforeEach: ({ args, parameters }) => galleryApi(args.initial, parameters.galleryApi),
} satisfies Meta<typeof ProductPhotoEditor>
export default meta
type Story = StoryObj<typeof meta>

export const ProviderOnly: Story = {}

export const SavedDraft: Story = { args: { initial: savedDraft } }

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
    const saved = sent.at(-1)?.body as Extract<GalleryMutation, { action: "save" }>
    await expect(saved.manifest.colors[0]?.entries.map((e) => (e.source === "provider" ? e.src : e.assetId))).toEqual([
      "/images/store-mark.svg",
      "/images/cart-hanger.svg",
    ])
  },
}

export const FieldValidation: Story = {
  args: { initial: savedDraft },
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
    const file = new File(["synthetic"], "sample.png", { type: "image/png" })
    await userEvent.upload(input, file)
    await canvas.findByText("Photo uploaded privately. Add it to the correct color below.")
    await expect(sent[0]?.headers.get("x-photo-bytes")).toBe(String(file.size))
    await userEvent.click(canvas.getByRole("button", { name: "Choose photos for this color" }))
    await expect(canvas.getByRole("button", { name: /Add uploaded photo 1/ })).toBeEnabled()
  },
}

export const ReviewAndActivate: Story = {
  args: { initial: savedDraft },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/Private draft preview/)).toBeVisible()
    await userEvent.click(canvas.getByRole("checkbox", { name: /I reviewed Black/ }))
    await userEvent.click(canvas.getByRole("button", { name: "Activate gallery" }))
    await canvas.findByText(/Prepared 1 of 2 photos\. Nothing activated yet/)
    await userEvent.click(canvas.getByRole("button", { name: "Activate gallery" }))
    await canvas.findByText("Gallery activated. Your selections now belong to the store.")
    // Both the preparing call and the resumed call confirm the reviewed color's current binding digest.
    await expect(sent.map((r) => (r.body as GalleryActivation).confirmations)).toEqual([
      { "10": "a".repeat(64) },
      { "10": "a".repeat(64) },
    ])
  },
}

export const RefreshConflict: Story = {
  args: { initial: savedDraft },
  parameters: { galleryApi: { changedElsewhere: true } },
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

export const RefreshDiscard: Story = {
  args: { initial: savedDraft },
  parameters: { galleryApi: { changedElsewhere: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Move photo 2 up" }))
    await userEvent.click(canvas.getByRole("button", { name: "Refresh product" }))
    await userEvent.click(await canvas.findByRole("button", { name: "Discard my edits and load saved draft" }))
    await canvas.findByText("Discarded local edits and loaded the saved draft.")
    await expect(canvas.getByRole("textbox", { name: "Photo 1 description" })).toHaveValue("Sample tee front")
    await expect(canvas.getByRole("button", { name: "Save draft" })).toBeDisabled()
  },
}

export const RestoreHistory: Story = {
  args: { initial: savedDraft },
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
    await expect(canvas.getByText("No colors are currently available")).toBeVisible()
    await expect(canvas.queryByRole("textbox", { name: "Photo 1 description" })).not.toBeInTheDocument()
    await expect(canvas.getByRole("button", { name: "Restore last active selection for Black" })).toBeVisible()
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

const matchingColors = [
  { key: "10", title: "Black", hex: "#222222", views: ["front", "back"] },
  { key: "20", title: "Green", hex: "#285645", views: ["back", "front", "back"] },
  { key: "30", title: "Blue", hex: "#315789", views: ["front"] },
].map(({ views, ...color }, index) => ({
  ...base.colors[0]!,
  ...color,
  variantIds: [101 + index],
  providerImages: views.map((viewKey, photoIndex) => ({
    src: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#f5f5f5"/><path d="M270 180 160 260 230 370 280 340V620H520V340L570 370 640 260 530 180 460 210H340Z" fill="${color.hex}"/><text x="400" y="710" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#333">Illustrative image: ${color.title} ${viewKey} ${photoIndex + 1}</text></svg>`)}`,
    alt: `${color.title} ${viewKey} ${photoIndex + 1}`,
    viewKey,
    selectable: true,
  })),
}))

export const MatchingViews: Story = {
  args: {
    initial: {
      ...base,
      colors: [
        {
          ...base.colors[0]!,
          key: "40",
          title: "Cream",
          available: false,
          binding: null,
          variantIds: [],
          providerImages: [],
        },
        ...matchingColors,
      ],
      artwork: { src: "/images/cart-hanger.svg", alt: "Illustrative artwork placeholder", backgroundColor: "#222222" },
      draft: {
        version: 1,
        coverColor: "10",
        colors: matchingColors.map((color) => ({
          colorKey: color.key,
          reviewedBinding: null,
          entries: color.providerImages.map((image) => ({
            source: "provider" as const,
            src: image.src,
            alt: image.alt,
            role: "garment" as const,
            viewKey: image.viewKey,
            sha256: "a".repeat(64),
            sourceRevision: "1",
          })),
        })),
      },
    },
  },
}
