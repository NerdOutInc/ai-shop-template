import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { expect, userEvent, within } from "storybook/test"

import { conceptDesignFixture } from "../../../test/concept-design-fixture"

import { ConceptGallery } from "./concept-gallery"

const first = conceptDesignFixture({ background: { name: "Dusty rose", hex: "#9b6871" } })
const second = conceptDesignFixture({
  id: "second-design",
  displayNumber: 416,
  title: "Orbit Friends",
  family: "Abstract characters",
  collectionIds: ["characters"],
  favoriteRevisionId: first.revision!.id,
  favoriteColorName: "CVC Cream",
  background: { name: "Natural", hex: "#fff8ec" },
})

const meta = {
  title: "Admin/Concept gallery",
  component: ConceptGallery,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <main className="page-width py-10">
        <Story />
      </main>
    ),
  ],
  args: {
    designs: [first, second],
    total: 2,
    filters: {},
    page: 1,
    pageSize: 48,
    collections: [
      { id: "sample-shirts", title: "Sample designs", description: null, designCount: 2 },
      { id: "characters", title: "Character collection", description: null, designCount: 10 },
    ],
    options: {
      families: ["Illustrated characters", "Abstract characters"],
      productModels: [{ id: "next-level-6210", label: "Next Level 6210" }],
    },
  },
} satisfies Meta<typeof ConceptGallery>

export default meta
type Story = StoryObj<typeof meta>

export const Library: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole("article")).toHaveLength(2)
    await expect(canvas.getByRole("link", { name: "My favorites" })).toHaveAttribute(
      "href",
      "/admin/concepts?favorites=1"
    )
    const colors = within(canvas.getByRole("group", { name: "Garment color for design #149" }))
    await expect(colors.getAllByRole("button")).toHaveLength(5)
    await expect(colors.getByRole("button", { name: "Midnight Navy" })).toHaveAttribute("aria-pressed", "true")
    const artwork = () => canvas.getByRole("img", { name: first.title }).parentElement
    await expect(artwork()).toHaveStyle({ backgroundColor: "#283244" })

    await userEvent.click(colors.getByRole("button", { name: "Cream" }))
    await expect(artwork()).toHaveStyle({ backgroundColor: "#ded1be" })
    // A saved favorite reopens on the garment it was judged against.
    await expect(canvas.getByRole("img", { name: second.title }).parentElement).toHaveStyle({
      backgroundColor: "#ded1be",
    })
    await userEvent.keyboard("{ArrowRight} ")
    await expect(colors.getByRole("button", { name: "Black" })).toHaveFocus()
    await expect(artwork()).toHaveStyle({ backgroundColor: "#242529" })

    const toggle = canvas.queryByRole("button", { name: "Filters +" })
    if (toggle) await userEvent.click(toggle)
    await expect(canvas.getByRole("combobox", { name: "Collection" })).toBeVisible()
    await expect(canvas.getByRole("combobox", { name: "Design state" })).toHaveValue("active")
    await userEvent.type(canvas.getByRole("searchbox", { name: "Search designs" }), "149")
    await expect(canvas.getByRole("searchbox", { name: "Search designs" })).toHaveValue("149")
  },
}

export const SmallDensityHidesSwatches: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Small artwork" }))
    await expect(canvas.getByRole("button", { name: "Small artwork" })).toHaveAttribute("aria-pressed", "true")
    // Five 44px swatches wrap to two rows under a phone-width card, which is most of the
    // point of scanning at this density.
    await expect(canvas.queryByRole("group", { name: "Garment color for design #149" })).not.toBeInTheDocument()
    await expect(canvas.getByRole("img", { name: first.title })).toHaveAttribute(
      "src",
      `${first.revision!.print!.url}?size=small`
    )
  },
}

export const ArchiveFromACard: Story = {
  play: async ({ canvas }) => {
    // Triaging hundreds of designs should not mean opening each detail page.
    const archive = canvas.getByRole("button", { name: "Archive design #149" })
    await expect(archive).toBeVisible()
    await expect(canvas.getByRole("button", { name: "Favorite design #149" })).toBeVisible()
    await expect(canvas.getByRole("button", { name: "Archive design #416" })).toBeVisible()
    await userEvent.tab()
    // Both card controls are reachable from the keyboard, in reading order.
    await expect(document.activeElement).toBeInstanceOf(HTMLElement)
  },
}

export const PersonalFavorites: Story = {
  args: { designs: [second], total: 1, filters: { favoritesOnly: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("heading", { level: 1, name: "My favorites" })).toBeVisible()
    await expect(canvas.getByText(/across every collection/)).toBeVisible()
    await expect(canvas.getByRole("button", { name: "Remove design #416 from my favorites" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
  },
}

export const NoMatches: Story = { args: { designs: [], total: 0, filters: { search: "hidden planet" } } }

export const AwaitingPreparation: Story = {
  args: {
    designs: [
      conceptDesignFixture({
        background: { name: "Recorded navy", hex: "#17262d" },
        revision: {
          ...first.revision!,
          print: null,
          preview: { ...first.revision!.original!, kind: "preview" },
        },
      }),
    ],
    total: 1,
  },
  play: async ({ canvas }) => {
    // The app never removes a background, so opaque artwork is shown as delivered and says
    // why no garment colors are offered.
    await expect(canvas.getByRole("img", { name: first.title })).toHaveAttribute("src", first.revision!.original!.url)
    await expect(canvas.queryByRole("group", { name: "Garment color for design #149" })).not.toBeInTheDocument()
    await expect(canvas.getByText(/need prepared transparent artwork/)).toBeVisible()
  },
}

export const AwaitingPrivateUpload: Story = {
  args: {
    designs: [
      conceptDesignFixture({
        revision: {
          ...first.revision!,
          original: { ...first.revision!.original!, status: "pending" },
          print: null,
          printReadiness: "needs-preparation",
        },
        revisions: [],
      }),
    ],
    total: 1,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Artwork is awaiting private upload.")).toBeVisible()
    await expect(canvas.queryByRole("img")).not.toBeInTheDocument()
  },
}
