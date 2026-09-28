import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { expect, waitFor, within } from "storybook/test"

import type { AdminGarment } from "./garment-catalog"
import { GarmentModelList } from "./garment-model-list"

const sent: { method: string; path: string; body: unknown }[] = []

function answering(status: number, body: unknown) {
  return () => {
    sent.length = 0
    const original = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      sent.push({
        method: init?.method ?? "GET",
        path: String(input),
        body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
      })
      // Slower than a frame, like any real request. Chromium only drops a disabled button's focus
      // when it next renders, so an instant answer would hide exactly what these stories are for.
      await new Promise((resolve) => setTimeout(resolve, 60))
      return Response.json(body, { status })
    }
    return () => {
      globalThis.fetch = original
    }
  }
}

const tee: AdminGarment = {
  blueprintId: 1317,
  known: true,
  complete: true,
  manufacturer: "Next Level",
  model: "6210",
  categorySlug: "t-shirts",
  googleProductCategory: 212,
  gender: "unisex",
  ageGroup: "adult",
  sizeSystem: "US",
  productCount: 24,
  shownCount: 22,
  scheduledCount: 1,
}
const crop: AdminGarment = {
  ...tee,
  blueprintId: 1312,
  complete: false,
  model: "5080",
  categorySlug: null,
  gender: null,
  productCount: 2,
  shownCount: 0,
  scheduledCount: 0,
}
const found: AdminGarment = {
  blueprintId: 9999,
  known: false,
  complete: false,
  manufacturer: null,
  model: null,
  categorySlug: null,
  googleProductCategory: null,
  gender: null,
  ageGroup: null,
  sizeSystem: null,
  productCount: 3,
  shownCount: 2,
  scheduledCount: 0,
}

const meta = {
  title: "Admin/Garment models",
  component: GarmentModelList,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <main className="page-width max-w-3xl py-10">
        <Story />
      </main>
    ),
  ],
  args: {
    categories: [
      { slug: "t-shirts", name: "T-shirts", garmentCount: 1 },
      { slug: "crop-tops", name: "Crop tops", garmentCount: 0 },
    ],
    garments: [found, crop, tee],
    productsWithoutBlueprint: 0,
  },
  beforeEach: answering(200, { blueprintId: 9999 }),
} satisfies Meta<typeof GarmentModelList>

export default meta
type Story = StoryObj<typeof meta>

export const NeedsSetupThenReady: Story = {
  args: { productsWithoutBlueprint: 2 },
  play: async ({ canvas }) => {
    const waiting = within(canvas.getByRole("list", { name: "Garments that need setup" }))
    await expect(waiting.getAllByRole("listitem").map((item) => item.id)).toEqual(["garment-9999", "garment-1312"])
    await expect(waiting.getByText(/Found on 3 published products, 2 shown; not set up yet/)).toBeVisible()
    const ready = within(canvas.getByRole("list", { name: "Ready garments" }))
    await expect(ready.getAllByRole("listitem").map((item) => item.id)).toEqual(["garment-1317"])
    await expect(canvas.getByText(/^2 published products name no Printify blueprint/)).toBeVisible()
    // Three forms on one page, and not one repeated id between them.
    const ids = Array.from(
      canvas.getByRole("list", { name: "Garments that need setup" }).ownerDocument.querySelectorAll("[id]"),
      (element) => element.id
    )
    await expect(new Set(ids).size).toBe(ids.length)
  },
}

export const NameAGarmentByKeyboard: Story = {
  play: async ({ canvas, userEvent }) => {
    // The cards themselves are focus targets for a product row's link, not Tab stops: the first Tab
    // goes straight into the first garment's form.
    await userEvent.tab()
    const card = within(canvas.getByRole("listitem", { name: /Blueprint 9999/ }))
    await expect(card.getByLabelText("Manufacturer")).toHaveFocus()
    await userEvent.keyboard("Bella+Canvas")
    await userEvent.tab()
    await userEvent.keyboard("3001{Enter}")
    await expect(await card.findByText("Saved.")).toBeVisible()
    await expect(sent).toEqual([
      {
        method: "PUT",
        path: "/api/admin/products/garments/9999",
        body: {
          manufacturer: "Bella+Canvas",
          model: "3001",
          categorySlug: null,
          googleProductCategory: null,
          gender: null,
          ageGroup: null,
          sizeSystem: null,
        },
      },
    ])
    // Enter in a field submits without pressing a button. The field is held while the save runs,
    // which costs it focus, so it has to be handed back to the same field afterwards.
    await waitFor(() => expect(card.getByLabelText("Model")).toHaveFocus())
  },
}

// Answered only when the story says so, so the held form can be looked at for as long as it takes.
let answerSave: (() => void) | null = null

export const HeldWhileSaving: Story = {
  beforeEach: () => {
    const original = globalThis.fetch
    globalThis.fetch = () =>
      new Promise((resolve) => {
        answerSave = () => resolve(Response.json({ blueprintId: 9999 }, { status: 200 }))
      })
    return () => {
      globalThis.fetch = original
      answerSave = null
    }
  },
  play: async ({ canvas, userEvent }) => {
    const card = within(canvas.getByRole("listitem", { name: /Blueprint 9999/ }))
    const model = card.getByLabelText("Model")
    await userEvent.type(card.getByLabelText("Manufacturer"), "Bella+Canvas")
    await userEvent.type(model, "3001{Enter}")
    // A save can move the card to the other list, which rebuilds its form from what was sent.
    // Typing taken now would be lost without a word, so it is refused where the owner can see it.
    await waitFor(() => expect(model).toBeDisabled())
    await expect(card.getByRole("form")).toHaveAttribute("aria-busy", "true")
    await expect(card.getByRole("button", { name: /^Saving…/ })).toBeDisabled()
    await expect(card.getByRole("status")).toHaveTextContent("Saving this garment’s setup…")
    await userEvent.keyboard("-typo")
    await expect(model).toHaveValue("3001")

    answerSave?.()
    await expect(await card.findByText("Saved.")).toBeVisible()
    await waitFor(() => expect(model).toBeEnabled())
    await expect(model).toHaveValue("3001")
    await waitFor(() => expect(model).toHaveFocus())
  },
}

export const LinkedFromAProductRow: Story = {
  beforeEach: () => {
    const { pathname, search } = window.location
    window.history.replaceState(null, "", `${pathname}${search}#garment-1312`)
    return () => window.history.replaceState(null, "", `${pathname}${search}`)
  },
  play: async ({ canvas }) => {
    // The browser scrolls to a fragment but leaves focus at the top of the page.
    const card = canvas.getByRole("listitem", { name: /Next Level 5080/ })
    await waitFor(() => expect(card).toHaveFocus())
    await expect(card).toHaveAccessibleName(/Next Level 5080\s+Needs setup/)
  },
}

export const RefusedWhileProductsShown: Story = {
  args: { garments: [tee] },
  beforeEach: answering(409, {
    error: "23 products on this garment are in the shop or scheduled. Hide them before clearing its setup.",
    products: 23,
  }),
  play: async ({ canvas, userEvent }) => {
    await userEvent.selectOptions(canvas.getByLabelText("Gender"), "Choose a gender")
    await userEvent.click(canvas.getByRole("button", { name: /^Save garment/ }))
    await expect(await canvas.findByRole("alert")).toHaveTextContent("Hide them before clearing its setup.")
    // Still ready: nothing was saved, and only the server says otherwise.
    await expect(within(canvas.getByRole("list", { name: "Ready garments" })).getByText("Ready")).toBeVisible()
  },
}

export const NothingYet: Story = { args: { garments: [] } }
