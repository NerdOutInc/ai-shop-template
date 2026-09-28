import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { expect, waitFor } from "storybook/test"

import type { AdminGarment } from "./garment-catalog"
import { GarmentModelForm } from "./garment-model-form"

type Sent = { method: string; path: string; body: unknown }
const sent: Sent[] = []

/** Answers the catalog lookup with `lookup` and a save with `save`; nothing leaves the page. */
function answering(lookup: { status: number; body: unknown }, save: { status: number; body: unknown }) {
  return () => {
    sent.length = 0
    const original = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const method = init?.method ?? "GET"
      sent.push({
        method,
        path: String(input),
        body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
      })
      // Slower than a frame, like any real request. Chromium only drops a disabled button's focus
      // when it next renders, so an instant answer would hide exactly what these stories are for.
      await new Promise((resolve) => setTimeout(resolve, 60))
      const { status, body } = method === "GET" ? lookup : save
      return Response.json(body, { status })
    }
    return () => {
      globalThis.fetch = original
    }
  }
}

const found = {
  status: 200,
  body: { blueprintId: 1312, title: "Women's Ideal Crop Top", manufacturer: "Next Level", model: "5080" },
}

const unknown: AdminGarment = {
  blueprintId: 1312,
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
  shownCount: 0,
  scheduledCount: 0,
}
const ready: AdminGarment = {
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

const meta = {
  title: "Admin/Garment model form",
  component: GarmentModelForm,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <main className="page-width max-w-3xl py-10">
        <Story />
      </main>
    ),
  ],
  args: {
    garment: unknown,
    categories: [
      { slug: "t-shirts", name: "T-shirts", garmentCount: 1 },
      { slug: "crop-tops", name: "Crop tops", garmentCount: 0 },
    ],
  },
  beforeEach: answering(found, { status: 200, body: { blueprintId: 1312 } }),
} satisfies Meta<typeof GarmentModelForm>

export default meta
type Story = StoryObj<typeof meta>

export const LookUpThenSaveByKeyboard: Story = {
  play: async ({ canvas, userEvent }) => {
    // By keyboard throughout. Each pressed button is disabled while its request runs, which would
    // drop focus to the top of the page; it has to come back to the same button both times.
    await userEvent.tab()
    await expect(canvas.getByLabelText("Manufacturer")).toHaveFocus()
    await userEvent.keyboard("NL Apparel")
    await userEvent.tab()
    await userEvent.tab()
    const lookUp = canvas.getByRole("button", { name: /^Look up name from Printify/ })
    await expect(lookUp).toHaveFocus()
    await userEvent.keyboard("{Enter}")
    await waitFor(() => expect(canvas.getByLabelText("Model")).toHaveValue("5080"))
    // Only the empty field was filled; the name the owner typed stays theirs.
    await expect(canvas.getByLabelText("Manufacturer")).toHaveValue("NL Apparel")
    await expect(canvas.getByRole("status")).toHaveTextContent("Printify calls this “Women's Ideal Crop Top”.")
    await waitFor(() => expect(lookUp).toHaveFocus())

    // Category, Google category, gender, age group, size system, then Save.
    for (let stop = 0; stop < 6; stop++) await userEvent.tab()
    const save = canvas.getByRole("button", { name: /^Save garment/ })
    await expect(save).toHaveFocus()
    await userEvent.keyboard("{Enter}")
    await expect(await canvas.findByText("Saved.")).toBeVisible()
    await waitFor(() => expect(save).toHaveFocus())
    await expect(sent).toEqual([
      { method: "GET", path: "/api/admin/products/garments/1312/catalog", body: undefined },
      {
        method: "PUT",
        path: "/api/admin/products/garments/1312",
        body: {
          manufacturer: "NL Apparel",
          model: "5080",
          categorySlug: null,
          googleProductCategory: null,
          gender: null,
          ageGroup: null,
          sizeSystem: null,
        },
      },
    ])
  },
}

export const SaveCompletesGarment: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByLabelText("Manufacturer"), "Next Level")
    await userEvent.type(canvas.getByLabelText("Model"), "5080")
    await userEvent.selectOptions(canvas.getByLabelText("Shop category"), "Crop tops")
    await userEvent.type(canvas.getByLabelText("Google product category"), "212")
    await userEvent.selectOptions(canvas.getByLabelText("Gender"), "Female")
    await userEvent.selectOptions(canvas.getByLabelText("Age group"), "Adult")
    await userEvent.selectOptions(canvas.getByLabelText("Size system"), "US")
    await userEvent.click(canvas.getByRole("button", { name: /^Save garment/ }))
    await expect(await canvas.findByText("Saved.")).toBeVisible()
    await expect(sent.at(-1)?.body).toEqual({
      manufacturer: "Next Level",
      model: "5080",
      categorySlug: "crop-tops",
      googleProductCategory: 212,
      gender: "female",
      ageGroup: "adult",
      sizeSystem: "US",
    })
  },
}

export const MissingNameStaysOnThePage: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /^Save garment/ }))
    await expect(canvas.getByText("Enter the manufacturer, such as Next Level.")).toBeVisible()
    await expect(canvas.getByLabelText("Manufacturer")).toHaveFocus()
    await expect(sent).toEqual([])
  },
}

export const RefusedWhileProductsShown: Story = {
  args: { garment: ready },
  beforeEach: answering(found, {
    status: 409,
    body: {
      error: "23 products on this garment are in the shop or scheduled. Hide them before clearing its setup.",
      products: 23,
    },
  }),
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByText(/these details can be changed but not cleared/)).toBeVisible()
    await userEvent.selectOptions(canvas.getByLabelText("Shop category"), "Choose a category")
    await userEvent.click(canvas.getByRole("button", { name: /^Save garment/ }))
    // The server's own sentence: it counts the products in the way.
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "23 products on this garment are in the shop or scheduled. Hide them before clearing its setup."
    )
  },
}

export const LookupUnavailable: Story = {
  beforeEach: answering(
    {
      status: 503,
      body: { error: "Printify's catalog is not answering. Type the garment's name yourself, or try again shortly." },
    },
    { status: 200, body: { blueprintId: 1312 } }
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /^Look up name from Printify/ }))
    await expect(await canvas.findByRole("alert")).toHaveTextContent("Printify's catalog is not answering.")
    // Manual entry always works.
    await waitFor(() => expect(canvas.getByRole("button", { name: /^Save garment/ })).toBeEnabled())
  },
}

export const NoCategoriesYet: Story = { args: { categories: [] } }
