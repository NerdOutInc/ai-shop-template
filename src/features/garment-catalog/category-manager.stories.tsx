import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { expect, waitFor, within } from "storybook/test"

import { CategoryManager } from "./category-manager"

type Sent = { method: string; path: string; body: unknown }
const sent: Sent[] = []

/** Records every request and answers it with `respond`; nothing leaves the page. */
function answering(respond: (request: Sent) => { status: number; body: unknown }) {
  return () => {
    sent.length = 0
    const original = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const request = {
        method: init?.method ?? "GET",
        path: String(input),
        body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
      }
      sent.push(request)
      // Slower than a frame, like any real request. Chromium only drops a disabled button's focus
      // when it next renders, so an instant answer would hide exactly what these stories are for.
      await new Promise((resolve) => setTimeout(resolve, 60))
      const { status, body } = respond(request)
      return Response.json(body, { status })
    }
    return () => {
      globalThis.fetch = original
    }
  }
}

const saved = answering(({ method, path, body }) => {
  if (method === "POST") {
    const { name } = body as { name: string }
    return { status: 200, body: { category: { slug: name.toLowerCase().replaceAll(" ", "-"), name, garmentCount: 0 } } }
  }
  if (method === "PUT" && path.endsWith("/categories")) return { status: 200, body: { saved: true } }
  if (method === "PUT") return { status: 200, body: { slug: path.split("/").at(-1), ...(body as { name: string }) } }
  return { status: 200, body: { deleted: true } }
})

function order(canvasElement: HTMLElement) {
  return within(within(canvasElement).getByRole("list", { name: "Shop categories" }))
    .getAllByRole("listitem")
    .map((item) => item.querySelector("p")?.textContent)
}

const meta = {
  title: "Admin/Category manager",
  component: CategoryManager,
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
      { slug: "t-shirts", name: "T-shirts", garmentCount: 2 },
      { slug: "sweatshirts", name: "Sweatshirts", garmentCount: 0 },
      { slug: "crop-tops", name: "Crop tops", garmentCount: 1 },
      { slug: "tank-tops", name: "Tank tops", garmentCount: 0 },
    ],
  },
  beforeEach: saved,
} satisfies Meta<typeof CategoryManager>

export default meta
type Story = StoryObj<typeof meta>

export const RenameByKeyboard: Story = {
  play: async ({ canvas, canvasElement, userEvent }) => {
    // By keyboard throughout: Rename and its field replace one another, so focus is carried into the
    // field and back out to the button, never dropped at the top of the page.
    canvas.getByRole("button", { name: "Rename Tank tops" }).focus()
    await userEvent.keyboard("{Enter}")
    const input = canvas.getByLabelText("New name for Tank tops")
    await waitFor(() => expect(input).toHaveFocus())
    await userEvent.keyboard("{Control>}a{/Control}{Backspace}Tanks{Enter}")
    await expect(await canvas.findByText("Tank tops is now called Tanks.")).toBeVisible()
    await waitFor(() => expect(canvas.getByRole("button", { name: "Rename Tanks" })).toHaveFocus())
    await expect(order(canvasElement)).toEqual(["T-shirts", "Sweatshirts", "Crop tops", "Tanks"])
    // The slug is the address; the body is the name and nothing else.
    await expect(sent).toEqual([
      { method: "PUT", path: "/api/admin/products/categories/tank-tops", body: { name: "Tanks" } },
    ])
  },
}

export const ReorderWithButtons: Story = {
  play: async ({ canvas, canvasElement, userEvent }) => {
    canvas.getByRole("button", { name: "Move Sweatshirts up" }).focus()
    await userEvent.keyboard("{Enter}")
    // At the top the pressed arrow is disabled, so focus steps to the other one.
    await waitFor(() => expect(canvas.getByRole("button", { name: "Move Sweatshirts down" })).toHaveFocus())
    await expect(order(canvasElement)).toEqual(["Sweatshirts", "T-shirts", "Crop tops", "Tank tops"])
    await userEvent.keyboard("{Enter}")
    await waitFor(() => expect(canvas.getByRole("button", { name: "Move Sweatshirts down" })).toHaveFocus())
    await expect(order(canvasElement)).toEqual(["T-shirts", "Sweatshirts", "Crop tops", "Tank tops"])
    await expect(await canvas.findByText("Order saved.")).toBeVisible()
    await expect(sent.at(-1)).toEqual({
      method: "PUT",
      path: "/api/admin/products/categories",
      body: { categorySlugs: ["t-shirts", "sweatshirts", "crop-tops", "tank-tops"] },
    })
  },
}

export const DeleteAfterConfirming: Story = {
  play: async ({ canvas, canvasElement, userEvent }) => {
    canvas.getByRole("button", { name: "Delete Tank tops" }).focus()
    await userEvent.keyboard("{Enter}")
    // Focus lands on the question, not on a button: a second Enter must not be able to delete.
    const question = canvas.getByText("Delete Tank tops? No garment uses it, so nothing else changes.")
    await waitFor(() => expect(question).toHaveFocus())
    await userEvent.keyboard("{Enter}")
    await expect(sent).toEqual([])
    await userEvent.tab()
    await expect(canvas.getByRole("button", { name: "Yes, delete Tank tops" })).toHaveFocus()
    await userEvent.keyboard("{Enter}")
    await expect(await canvas.findByText("Tank tops deleted.")).toBeVisible()
    await expect(order(canvasElement)).toEqual(["T-shirts", "Sweatshirts", "Crop tops"])
    // The row is gone; the list's heading is the nearest thing certain to still exist.
    await waitFor(() => expect(canvas.getByRole("heading", { name: "Shop categories" })).toHaveFocus())
  },
}

export const KeepAfterAsking: Story = {
  play: async ({ canvas, userEvent }) => {
    canvas.getByRole("button", { name: "Delete Sweatshirts" }).focus()
    await userEvent.keyboard("{Enter}")
    await waitFor(() => expect(canvas.getByText(/^Delete Sweatshirts\?/)).toHaveFocus())
    await userEvent.tab()
    await userEvent.tab()
    await expect(canvas.getByRole("button", { name: /Keep it\s*: Sweatshirts/ })).toHaveFocus()
    await userEvent.keyboard("{Enter}")
    await waitFor(() => expect(canvas.getByRole("button", { name: "Delete Sweatshirts" })).toHaveFocus())
    await expect(sent).toEqual([])
  },
}

export const DeleteBlockedWhileInUse: Story = {
  play: async ({ canvas }) => {
    const blocked = canvas.getByRole("button", { name: "Delete T-shirts" })
    await expect(blocked).toBeDisabled()
    // A disabled button cannot be focused to explain itself, so the reason is plain text beside it.
    await expect(canvas.getByText("Move its 2 garments to another category before deleting this one.")).toBeVisible()
    await expect(blocked).toHaveAccessibleDescription(
      "Move its 2 garments to another category before deleting this one."
    )
  },
}

export const AddByKeyboard: Story = {
  play: async ({ canvas, canvasElement, userEvent }) => {
    const input = canvas.getByLabelText("New category name")
    input.focus()
    await userEvent.keyboard("Long sleeves")
    await expect(canvas.getByText(/This one would be long-sleeves\.$/)).toBeVisible()
    await userEvent.keyboard("{Enter}")
    await expect(await canvas.findByText("Long sleeves added at the end of the list.")).toBeVisible()
    await expect(order(canvasElement)).toEqual(["T-shirts", "Sweatshirts", "Crop tops", "Tank tops", "Long sleeves"])
    // Ready for the next one without reaching for the mouse.
    await waitFor(() => expect(input).toHaveFocus())
    await expect(input).toHaveValue("")
  },
}

export const AddRefusedShowsServerText: Story = {
  beforeEach: answering(() => ({ status: 409, body: { error: "A category with that name already exists." } })),
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.type(canvas.getByLabelText("New category name"), "T-Shirts{Enter}")
    await expect(await canvas.findByRole("alert")).toHaveTextContent("A category with that name already exists.")
    await expect(order(canvasElement)).toEqual(["T-shirts", "Sweatshirts", "Crop tops", "Tank tops"])
  },
}

export const ChangedElsewhere: Story = {
  beforeEach: answering(() => ({
    status: 409,
    body: { error: "The categories changed. Reload to sort the latest list." },
  })),
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Move Crop tops up" }))
    await expect(await canvas.findByRole("alert")).toHaveTextContent("The categories changed.")
    await expect(canvas.getByRole("button", { name: "Reload categories" })).toBeVisible()
    await expect(order(canvasElement)).toEqual(["T-shirts", "Sweatshirts", "Crop tops", "Tank tops"])
  },
}

export const NoCategoriesYet: Story = { args: { categories: [] } }
