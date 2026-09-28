import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { expect, userEvent } from "storybook/test"

import { CreateDesignDraftButton } from "./create-design-draft-button"

const proposal = {
  title: "Sample Character",
  modelLabel: "Next Level 6210",
  colors: ["Heather Forest Green", "CVC Espresso", "CVC Military Green", "CVC Midnight Navy", "CVC Black"],
  sizes: ["XS", "S", "M", "L", "XL"]
    .map((size) => ({ size, price: 2800 }))
    .concat([
      { size: "2XL", price: 3000 },
      { size: "3XL", price: 3200 },
    ]),
  skipped: [{ color: "CVC Espresso", size: "3XL", reason: "Printify cannot make it right now" }],
  blockers: [] as string[],
  placementDonor: {
    productId: "68bb57f658815116fa058b40",
    title: "Rest Restores Mana",
    placement: { position: "front", x: 0.5, y: 0.4, scale: 0.63, angle: 0 },
  },
  unverified: ["variants[].price"],
}
const draft = {
  requestId: "adf15313-8c0a-47a0-96c2-a891e4d531c1",
  pending: 0,
  result: { status: "draft", message: "Draft", owningRequestId: null },
}

/** Answers the review read with `review` and every draft step with `step`; nothing leaves the page. */
function answering(review: unknown, step: unknown = draft) {
  return () => {
    const original = globalThis.fetch
    globalThis.fetch = async (_input, init) => Response.json(init?.method === "POST" ? step : review)
    return () => {
      globalThis.fetch = original
    }
  }
}

const meta = {
  title: "Admin/Create design draft",
  component: CreateDesignDraftButton,
  args: {
    designId: "5a0c8f6e-3a63-4f56-9f0b-0b8f4d1f7a22",
    displayNumber: 149,
    revisionId: "c2b7f1d4-6a4f-4b8b-8a55-2f1d9d0c3b33",
  },
  beforeEach: answering(proposal),
} satisfies Meta<typeof CreateDesignDraftButton>

export default meta
type Story = StoryObj<typeof meta>

export const ReviewThenCreate: Story = {
  play: async ({ canvas }) => {
    // By keyboard throughout: the trigger and the review replace one another, so focus is carried
    // into the review and the next Tab lands on its first action.
    await userEvent.tab()
    await expect(canvas.getByRole("button", { name: "Create Printify draft" })).toHaveFocus()
    await userEvent.keyboard("{Enter}")
    await expect(await canvas.findByRole("heading", { name: "Sample Character on Next Level 6210" })).toHaveFocus()
    await expect(canvas.getByText("CVC Espresso, 3XL: Printify cannot make it right now")).toBeVisible()
    await expect(canvas.getByText("Rest Restores Mana")).toBeVisible()
    await expect(canvas.queryByText("Review the placement")).not.toBeInTheDocument()
    await userEvent.tab()
    await expect(canvas.getByRole("button", { name: "Create draft" })).toHaveFocus()
    await userEvent.keyboard("{Enter}")
    await expect(await canvas.findByText(/Draft created\. Review its mockups in Printify/)).toBeVisible()
  },
}

export const DifferingPlacements: Story = {
  beforeEach: answering({
    ...proposal,
    placementDonor: { ...proposal.placementDonor, title: "Rest Restores Mana — a climbing break for another attempt" },
    unverified: ["variants[].price", "placement"],
  }),
  play: async ({ canvas }) => {
    await userEvent.tab()
    await userEvent.keyboard("{Enter}")
    await expect(await canvas.findByRole("heading", { name: "Sample Character on Next Level 6210" })).toHaveFocus()
    await expect(canvas.getByText("Rest Restores Mana — a climbing break for another attempt")).toBeVisible()
    await expect(canvas.getByText("Printify product 68bb57f658815116fa058b40")).toBeVisible()
    await expect(canvas.getByText(/Published tees of this model use different placements/)).toBeVisible()
    await userEvent.tab()
    await expect(canvas.getByRole("button", { name: "Create draft" })).toHaveFocus()
    await userEvent.tab()
    await expect(canvas.getByRole("button", { name: "Cancel" })).toHaveFocus()
  },
}

export const Blocked: Story = {
  beforeEach: answering({
    ...proposal,
    colors: [],
    sizes: [],
    skipped: [],
    blockers: ["Assign this design's garment colors first", "This design has no summary to describe it"],
  }),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Create Printify draft" }))
    await expect(await canvas.findByText("Assign this design's garment colors first")).toBeVisible()
    await expect(canvas.queryByRole("button", { name: "Create draft" })).not.toBeInTheDocument()
  },
}

export const UncertainCreate: Story = {
  beforeEach: answering(proposal, {
    ...draft,
    result: {
      status: "needs-reconciliation",
      message: "Product submission or its saved receipt is uncertain. Reconcile this same request before another write",
      owningRequestId: null,
    },
  }),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Create Printify draft" }))
    await userEvent.click(await canvas.findByRole("button", { name: "Create draft" }))
    await expect(await canvas.findByRole("button", { name: "Check Printify again" })).toBeVisible()
  },
}

export const ResumingAnEarlierDraft: Story = { args: { resuming: true } }
