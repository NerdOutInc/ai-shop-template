import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { expect, waitFor } from "storybook/test"

import { AddGarmentForm } from "./add-garment-form"

const sent: { method: string; path: string; body: unknown }[] = []

/** Answers the catalog lookup and the save; nothing leaves the page. */
function answering() {
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
    return Response.json(
      method === "GET"
        ? { blueprintId: 1312, title: "Women's Ideal Crop Top", manufacturer: "Next Level", model: "5080" }
        : { blueprintId: 1312 }
    )
  }
  return () => {
    globalThis.fetch = original
  }
}

const meta = {
  title: "Admin/Add garment",
  component: AddGarmentForm,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <main className="page-width flex max-w-3xl flex-col gap-8 py-10">
        {/* Stands in for the list above the form on the real page, which owns this id. */}
        <ul aria-label="Ready garments">
          <li id="garment-1317" tabIndex={-1} className="rounded-lg border p-4">
            Next Level 6210
          </li>
        </ul>
        <Story />
      </main>
    ),
  ],
  args: {
    categories: [
      { slug: "t-shirts", name: "T-shirts", garmentCount: 1 },
      { slug: "crop-tops", name: "Crop tops", garmentCount: 0 },
    ],
    listedBlueprintIds: [1317],
  },
  beforeEach: answering,
} satisfies Meta<typeof AddGarmentForm>

export default meta
type Story = StoryObj<typeof meta>

const pasted = "https://printify.com/app/products/1312/next-level/womens-ideal-crop-top?utm_source=catalog"

export const PasteCatalogLinkByKeyboard: Story = {
  play: async ({ canvas, userEvent }) => {
    // By keyboard throughout: the revealed form appears below the field, so focus is carried to its
    // heading and the next Tab lands in its first field.
    await userEvent.tab()
    await expect(canvas.getByLabelText("Printify catalog link or blueprint number")).toHaveFocus()
    await userEvent.paste(pasted)
    await userEvent.keyboard("{Enter}")
    await waitFor(() => expect(canvas.getByRole("heading", { name: "Set up blueprint 1312" })).toHaveFocus())
    // Reading the number out of the link asked nothing of anyone.
    await expect(sent).toEqual([])

    await userEvent.tab()
    await expect(canvas.getByLabelText("Manufacturer")).toHaveFocus()
    await userEvent.tab()
    await userEvent.tab()
    await userEvent.keyboard("{Enter}")
    await waitFor(() => expect(canvas.getByLabelText("Model")).toHaveValue("5080"))
    await waitFor(() => expect(canvas.getByRole("button", { name: /^Look up name from Printify/ })).toHaveFocus())
    for (let stop = 0; stop < 6; stop++) await userEvent.tab()
    await expect(canvas.getByRole("button", { name: /^Save garment/ })).toHaveFocus()
    await userEvent.keyboard("{Enter}")
    await expect(await canvas.findByText("Saved.")).toBeVisible()

    // Only the integer ever travels: never the address it was read from.
    await expect(sent.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "GET /api/admin/products/garments/1312/catalog",
      "PUT /api/admin/products/garments/1312",
    ])
    await expect(JSON.stringify(sent)).not.toContain("printify.com")
    await expect(canvas.getByRole("button", { name: "Close" })).toBeVisible()
  },
}

export const RejectsAProductLink: Story = {
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByLabelText("Printify catalog link or blueprint number")
    input.focus()
    await userEvent.paste("https://printify.com/app/product-details/111111000000000000000006")
    await userEvent.keyboard("{Enter}")
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "That link is one of your products, not a garment in Printify's catalog."
    )
    await expect(input).toHaveFocus()
    await expect(input).toBeInvalid()
    // Refused on the page: no request of any kind.
    await expect(sent).toEqual([])
    await expect(canvas.queryByRole("heading", { name: /^Set up blueprint/ })).not.toBeInTheDocument()
  },
}

export const RejectsALookalikeHost: Story = {
  play: async ({ canvas, userEvent }) => {
    canvas.getByLabelText("Printify catalog link or blueprint number").focus()
    await userEvent.paste("https://printify.com.attacker.test/app/products/1317")
    await userEvent.keyboard("{Enter}")
    await expect(canvas.getByRole("alert")).toHaveTextContent("That is not a Printify catalog link.")
    await expect(sent).toEqual([])
  },
}

export const AlreadyListed: Story = {
  play: async ({ canvas, canvasElement, userEvent }) => {
    canvas.getByLabelText("Printify catalog link or blueprint number").focus()
    await userEvent.keyboard("1317{Enter}")
    // One form per garment: the owner is taken to the card that already exists.
    await waitFor(() => expect(canvasElement.ownerDocument.getElementById("garment-1317")).toHaveFocus())
    await expect(canvas.getByText("Blueprint 1317 is already listed above.")).toBeVisible()
    await expect(canvas.queryByRole("heading", { name: /^Set up blueprint/ })).not.toBeInTheDocument()
  },
}

export const CancelReturnsToTheField: Story = {
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByLabelText("Printify catalog link or blueprint number")
    input.focus()
    await userEvent.keyboard("1312{Enter}")
    await waitFor(() => expect(canvas.getByRole("heading", { name: "Set up blueprint 1312" })).toHaveFocus())
    await userEvent.click(canvas.getByRole("button", { name: "Cancel" }))
    await expect(input).toHaveFocus()
  },
}
