import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { expect, userEvent, within } from "storybook/test"

import { conceptDesignFixture } from "../../../test/concept-design-fixture"

import { ConceptDetail } from "./concept-detail"

const design = conceptDesignFixture()
const meta = {
  title: "Admin/Concept detail",
  component: ConceptDetail,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <main className="page-width py-10">
        <Story />
      </main>
    ),
  ],
  args: {
    design,
    collections: [{ id: "sample-shirts", title: "Sample designs", description: null, designCount: 2 }],
  },
} satisfies Meta<typeof ConceptDetail>

export default meta
type Story = StoryObj<typeof meta>

export const PreparedArtwork: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("link", { name: "Download print file" })).toHaveAttribute(
      "href",
      `/api/admin/assets/${design.revision!.print!.id}?download=1`
    )
    await expect(canvas.getByRole("link", { name: "Large · 1440 px" })).toHaveAttribute(
      "href",
      `/api/admin/assets/${design.revision!.print!.id}?size=large&download=1`
    )
    await expect(canvas.getByRole("link", { name: "Products" })).toHaveAttribute("href", "/admin/products")
    await expect(canvas.queryByRole("button", { name: /Feature this design/ })).not.toBeInTheDocument()
    await expect(canvas.getByRole("link", { name: "Medium · 800 px" })).toBeVisible()
    await expect(canvas.getByRole("link", { name: "Small · 480 px" })).toBeVisible()
    await userEvent.click(canvas.getByText("Design notes and generation prompt"))
    await expect(canvas.getByText(design.prompt)).toBeVisible()
  },
}

export const PromotingAGarmentColor: Story = {
  play: async ({ canvas }) => {
    const palette = within(canvas.getByRole("group", { name: "All garment colors" }))
    await expect(palette.getAllByRole("button")).toHaveLength(36)
    await userEvent.click(palette.getByRole("button", { name: "Cream" }))
    await expect(canvas.getByText("is one of the five.")).toBeVisible()
    await expect(canvas.getByRole("img", { name: design.title }).parentElement).toHaveStyle({
      backgroundColor: "#ded1be",
    })
    await userEvent.click(palette.getByRole("button", { name: "Purple Rush" }))
    await expect(canvas.getByText("is not offered yet.")).toBeVisible()
    // Five is the rule: adding a sixth asks for a removal instead of dropping one silently.
    await expect(canvas.getByRole("button", { name: "Add to the five" })).toBeDisabled()
    await expect(canvas.getByText(/Remove one before adding Purple Rush/)).toBeVisible()
  },
}

export const HistoricalSourceOnly: Story = {
  args: {
    design: conceptDesignFixture({
      revision: { ...design.revision!, print: null, printReadiness: "needs-preparation" },
      revisions: [],
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("link", { name: "Download print file" })).toHaveAttribute(
      "href",
      `/api/admin/assets/${design.revision!.original!.id}?download=1`
    )
    await expect(canvas.queryByRole("link", { name: "Large · 1440 px" })).not.toBeInTheDocument()
    await expect(canvas.getByText(/Browsing sizes appear once a transparent print file/)).toBeVisible()
  },
}

export const ArchivedConcept: Story = {
  args: { design: conceptDesignFixture({ state: "archived" }) },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Archived concept")).toBeVisible()
    await expect(canvas.getByRole("button", { name: "Restore design #149 to the library" })).toBeVisible()
  },
}

export const PinnedFavoriteAndProductStates: Story = {
  args: {
    design: conceptDesignFixture({
      favoriteRevisionId: design.revision!.id,
      products: [
        {
          id: "shirt",
          shopId: "store",
          productId: "shirt-product",
          productModelId: "next-level-6210",
          productModelLabel: "Next Level 6210",
          revisionId: design.revision!.id,
          status: "published",
          verifiedAt: "2026-09-13T12:00:00Z",
          storefrontUrl: "/shop/shirt-product",
        },
        {
          id: "hoodie",
          shopId: "store",
          productId: "hoodie-product",
          productModelId: "hoodie",
          productModelLabel: "Hoodie",
          revisionId: null,
          status: "unverified",
          verifiedAt: null,
          storefrontUrl: null,
        },
      ],
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: "Remove design #149 from my favorites" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    await expect(canvas.getByRole("link", { name: "View in store" })).toHaveAttribute("href", "/shop/shirt-product")
    await expect(canvas.getByText("Not yet verified")).toBeVisible()
    await expect(canvas.getByRole("button", { name: "Archive design #149" })).toBeVisible()
  },
}
