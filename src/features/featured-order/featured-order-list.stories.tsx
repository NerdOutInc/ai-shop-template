import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"

import { formatWeeklyCadence } from "@/features/publishing/format-weekly-cadence"

import { FeaturedOrderList } from "./featured-order-list"

// In the shop since Sep 1, well past the two weeks that earn the New badge.
const shown = {
  hiddenAt: null,
  revealAt: null,
  revealedAt: "2026-09-01T00:00:00.000Z",
  addedToShopAt: "2026-09-01T00:00:00.000Z",
}
const hidden = { hiddenAt: "2026-09-19T09:00:00.000Z", revealAt: null, revealedAt: null, addedToShopAt: null }
const now = Date.parse("2026-09-20T12:00:00.000Z")
const savedOrders: string[][] = []
const savedSchedules: { productIds: string[]; liveAt: string }[] = []
const slots = [25, 2, 9, 16, 23, 30].map((day, index) => ({
  value: `2026-${index === 0 ? "09" : "10"}-${String(day).padStart(2, "0")}T22:30:00.000Z`,
  label: `${index === 0 ? "September" : "October"} ${day}, 2026`,
}))
const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#e4e8df"/><path d="m52 25-28 19 16 28 15-7v65h50V65l15 7 16-28-28-19-16 8H68Z" fill="#203f36"/><text x="80" y="82" text-anchor="middle" font-family="sans-serif" font-size="26" fill="#f5e6bf">K</text></svg>')}`

function mockSave(status: number) {
  return () => {
    savedOrders.length = 0
    savedSchedules.length = 0
    const original = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const body = JSON.parse(String(init?.body)) as { productId?: string; productIds?: string[]; liveAt?: string }
      if (String(input).endsWith("/featured-order") && body.productIds) savedOrders.push(body.productIds)
      if (String(input).endsWith("/product-schedule") && body.productIds && body.liveAt) {
        savedSchedules.push({ productIds: body.productIds, liveAt: body.liveAt })
        return Response.json(
          status === 200
            ? {
                entries: body.productIds.map((productId) => ({
                  id: `entry-${productId}`,
                  productId,
                  liveAt: body.liveAt,
                })),
                products: body.productIds.map((productId) => ({
                  productId,
                  ...(productId === "waiting" ? { ...hidden, revealAt: body.liveAt } : shown),
                })),
                now,
              }
            : { error: "That schedule did not save. Please try again." },
          { status }
        )
      }
      if (String(input).endsWith("/product-schedule") && body.productId) {
        return Response.json(
          status === 200
            ? {
                entries: [],
                products: [{ productId: body.productId, ...(body.productId === "waiting" ? hidden : shown) }],
                now,
                outcome: "removed",
              }
            : { error: "That schedule did not save. Please try again." },
          { status }
        )
      }
      return Response.json(status === 200 ? { saved: true } : { error: "Story failure" }, { status })
    }
    return () => {
      globalThis.fetch = original
    }
  }
}

function titles(list: HTMLElement) {
  return within(list)
    .getAllByRole("listitem")
    .map((item) =>
      within(item)
        .getByRole("link", { name: /^(View in shop|Preview product)/ })
        .textContent?.replace(/^(View in shop|Preview product): /, "")
        .trim()
    )
}

function lineup(canvasElement: HTMLElement) {
  return titles(within(canvasElement).getByRole("list", { name: "Available products" }))
}

function hiddenOrder(canvasElement: HTMLElement) {
  return titles(within(canvasElement).getByRole("list", { name: "Hidden products" }))
}

async function chooseAction(canvasElement: HTMLElement, product: string, action: string) {
  await userEvent.click(within(canvasElement).getByRole("button", { name: `Actions for ${product}` }))
  await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole("menuitem", { name: action }))
  await waitFor(() => expect(within(canvasElement.ownerDocument.body).queryByRole("menu", { hidden: true })).toBeNull())
}

const meta = {
  title: "Admin/Featured order list",
  component: FeaturedOrderList,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <main className="page-width max-w-3xl py-10">
        <Story />
      </main>
    ),
  ],
  args: {
    products: [
      { id: "everyday-type", title: "Everyday Type", image: { src: image, alt: "Everyday Type tee" }, ...shown },
      { id: "send-it", title: "Send It", image: null, ...shown },
      { id: "studio-lines", title: "Studio Lines", image: null, ...shown },
      { id: "rest-day", title: "Rest Day Club", image: null, ...shown },
    ],
    now,
  },
} satisfies Meta<typeof FeaturedOrderList>
export default meta
type Story = StoryObj<typeof meta>

export const KeyboardDragAndDrop: Story = {
  beforeEach: mockSave(200),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole("button", { name: "Reorder Rest Day Club" }))
    await userEvent.keyboard("[Space]")
    await expect(canvasElement.ownerDocument.querySelector("[data-product-drag-overlay]")).toHaveTextContent(
      "Rest Day Club"
    )
    await userEvent.keyboard("[ArrowUp]")
    await expect(await page.findByText("Rest Day Club is over position 3 of 4.")).toBeInTheDocument()
    await userEvent.keyboard("[ArrowUp][Space]")
    await waitFor(() =>
      expect(lineup(canvasElement)).toEqual(["Everyday Type", "Rest Day Club", "Send It", "Studio Lines"])
    )
    await expect(await canvas.findByText("Changes saved.")).toBeVisible()
    await expect(savedOrders).toEqual([["everyday-type", "rest-day", "send-it", "studio-lines"]])
    await expect(canvas.getByRole("button", { name: "Reorder Rest Day Club" })).toHaveFocus()
  },
}

export const PointerDragShowsTheWholeProduct: Story = {
  beforeEach: mockSave(200),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const handle = canvas.getByRole("button", { name: "Reorder Everyday Type" })
    const target = canvas.getByRole("button", { name: "Reorder Studio Lines" })
    const start = handle.getBoundingClientRect()
    const rowWidth = handle.closest("li")!.getBoundingClientRect().width
    const end = target.getBoundingClientRect()
    await userEvent.pointer({
      keys: "[MouseLeft>]",
      target: handle,
      coords: { clientX: start.x + 20, clientY: start.y + 20 },
    })
    await userEvent.pointer({ target: handle, coords: { clientX: start.x + 25, clientY: start.y + 35 } })
    await waitFor(() => {
      const overlay = canvasElement.ownerDocument.querySelector<HTMLElement>("[data-product-drag-overlay]")
      expect(overlay).toBeVisible()
      expect(overlay).toHaveTextContent("Everyday Type")
      expect(overlay?.querySelector("img")).toBeVisible()
      expect(overlay!.getBoundingClientRect().width).toBeCloseTo(rowWidth, 0)
      expect(overlay!.getBoundingClientRect().height).toBeGreaterThan(70)
      // The whole row travels, rank first: handle, link and menu included, not a trimmed-down card.
      expect(overlay).toHaveTextContent(/^1Everyday Type/)
      const copy = within(overlay!)
      expect(copy.getByRole("button", { name: "Reorder Everyday Type", hidden: true })).toBeInTheDocument()
      expect(copy.getByRole("link", { name: /^View in shop\s*: Everyday Type$/, hidden: true })).toHaveAttribute(
        "href",
        "/shop/everyday-type"
      )
      expect(copy.getByRole("button", { name: "Actions for Everyday Type", hidden: true })).toBeInTheDocument()
    })
    await userEvent.pointer({ target, coords: { clientX: end.x + 20, clientY: end.y + 20 } })
    await userEvent.pointer({ keys: "[/MouseLeft]", target, coords: { clientX: end.x + 20, clientY: end.y + 20 } })
    await waitFor(() =>
      expect(lineup(canvasElement)).toEqual(["Send It", "Studio Lines", "Everyday Type", "Rest Day Club"])
    )
    await expect(savedOrders).toEqual([["send-it", "studio-lines", "everyday-type", "rest-day"]])
    await waitFor(() => expect(canvasElement.ownerDocument.querySelector("[data-product-drag-overlay]")).toBeNull())
  },
}

export const EscapeCancelsADrag: Story = {
  beforeEach: mockSave(200),
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Reorder Everyday Type" }))
    await userEvent.keyboard("[Space][ArrowDown][Escape]")
    await waitFor(() =>
      expect(lineup(canvasElement)).toEqual(["Everyday Type", "Send It", "Studio Lines", "Rest Day Club"])
    )
    await expect(savedOrders).toEqual([])
    await waitFor(() => expect(canvasElement.ownerDocument.querySelector("[data-product-drag-overlay]")).toBeNull())
  },
}

export const ActionsMenuKeyboard: Story = {
  beforeEach: mockSave(200),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const page = within(canvasElement.ownerDocument.body)
    const trigger = canvas.getByRole("button", { name: "Actions for Studio Lines" })
    trigger.focus()
    await userEvent.keyboard("{Enter}")
    await waitFor(() => expect(page.getByRole("menuitem", { name: "Hide from shop" })).toHaveFocus())
    await userEvent.keyboard("{ArrowDown}{Enter}")
    await waitFor(() =>
      expect(lineup(canvasElement)).toEqual(["Everyday Type", "Studio Lines", "Send It", "Rest Day Club"])
    )
    await waitFor(() => expect(trigger).toHaveFocus())
    await chooseAction(canvasElement, "Studio Lines", "Move up in shop")
    await expect(lineup(canvasElement)).toEqual(["Studio Lines", "Everyday Type", "Send It", "Rest Day Club"])
    await expect(await canvas.findByText("Changes saved.")).toBeVisible()
  },
}

export const SaveFailure: Story = {
  beforeEach: mockSave(503),
  play: async ({ canvas, canvasElement }) => {
    await chooseAction(canvasElement, "Everyday Type", "Move down in shop")
    await expect(await canvas.findByRole("alert")).toHaveTextContent("last saved order is back in place")
    await expect(lineup(canvasElement)).toEqual(["Everyday Type", "Send It", "Studio Lines", "Rest Day Club"])
  },
}

export const ChangedLineup: Story = {
  beforeEach: mockSave(409),
  play: async ({ canvas, canvasElement }) => {
    await chooseAction(canvasElement, "Send It", "Move up in shop")
    await expect(await canvas.findByRole("alert")).toHaveTextContent("The product list changed")
    await expect(canvas.getByRole("button", { name: "Reload products" })).toBeVisible()
  },
}

export const HideAndRestore: Story = {
  beforeEach: mockSave(200),
  play: async ({ canvas, canvasElement }) => {
    await chooseAction(canvasElement, "Send It", "Hide from shop")
    await waitFor(() => expect(lineup(canvasElement)).toEqual(["Everyday Type", "Studio Lines", "Rest Day Club"]))
    await waitFor(() => expect(canvas.getByRole("button", { name: "Actions for Send It" })).toHaveFocus())
    const hiddenList = within(canvas.getByRole("list", { name: "Hidden products" }))
    await expect(hiddenList.getByRole("link", { name: /Preview product\s*: Send It/ })).toHaveAttribute(
      "href",
      "/admin/products/send-it"
    )
    await expect(savedOrders).toEqual([])
    await chooseAction(canvasElement, "Send It", "Show in shop")
    await waitFor(() =>
      expect(lineup(canvasElement)).toEqual(["Everyday Type", "Send It", "Studio Lines", "Rest Day Club"])
    )
    await waitFor(() => expect(canvas.getByRole("button", { name: "Actions for Send It" })).toHaveFocus())
    await expect(savedOrders).toEqual([])
  },
}

export const HiddenSection: Story = {
  args: {
    products: [
      ...meta.args.products.slice(0, 1),
      { id: "never-shown", title: "Never Shown", image: null, ...hidden },
      { id: "coming-friday", title: "Coming Friday", image: null, ...hidden, revealAt: "2026-09-25T16:00:00.000Z" },
      {
        id: "taken-down",
        title: "Taken Down",
        image: null,
        ...hidden,
        revealedAt: shown.revealedAt,
        addedToShopAt: shown.addedToShopAt,
      },
    ],
  },
  beforeEach: mockSave(200),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const page = within(canvasElement.ownerDocument.body)
    const hiddenList = within(canvas.getByRole("list", { name: "Hidden products" }))
    await expect(hiddenList.getAllByRole("listitem")).toHaveLength(3)
    await expect(canvas.getByText("Never shown")).toBeVisible()
    await expect(canvas.getByText(/^Reveals /)).toBeVisible()
    await expect(canvas.getByText(/^Hidden since /)).toBeVisible()
    await userEvent.click(hiddenList.getByRole("button", { name: "Reorder Taken Down" }))
    await userEvent.keyboard("[Space]")
    const overlay = canvasElement.ownerDocument.querySelector<HTMLElement>("[data-product-drag-overlay]")
    await expect(overlay).toHaveTextContent("Taken Down")
    // The copy that travels is the hidden row itself: preview link, note and menu included.
    await expect(overlay).toHaveTextContent(/^Taken DownHidden since /)
    await expect(
      within(overlay!).getByRole("link", { name: /^Preview product\s*: Taken Down$/, hidden: true })
    ).toHaveAttribute("href", "/admin/products/taken-down")
    await expect(within(overlay!).getByRole("button", { name: "Actions for Taken Down", hidden: true })).toBeVisible()
    await userEvent.keyboard("[ArrowUp]")
    await expect(await page.findByText("Taken Down is over position 2 of 3.")).toBeInTheDocument()
    await userEvent.keyboard("[ArrowUp][Space]")
    await waitFor(() => expect(hiddenOrder(canvasElement)).toEqual(["Taken Down", "Never Shown", "Coming Friday"]))
    // Hidden rows sort among themselves; the one shown tee keeps its slot ahead of them all.
    await expect(savedOrders).toEqual([["everyday-type", "taken-down", "never-shown", "coming-friday"]])
    await expect(lineup(canvasElement)).toEqual(["Everyday Type"])
    await expect(await canvas.findByText("Changes saved.")).toBeVisible()
    await expect(canvas.getByRole("button", { name: "Reorder Taken Down" })).toHaveFocus()
  },
}

// Put back on the wall two days before the page's clock, so Everyday Type wears the shop's New tag.
export const NewInTheShop: Story = {
  args: {
    products: meta.args.products.map((product) =>
      product.id === "everyday-type" ? { ...product, addedToShopAt: "2026-09-18T15:00:00.000Z" } : product
    ),
  },
  beforeEach: mockSave(200),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const handle = canvas.getByRole("button", { name: "Reorder Everyday Type" })
    const badge = within(handle.closest("li")!).getByText("New")
    await expect(badge).toBeVisible()
    await expect(canvas.getAllByText("New")).toHaveLength(1)
    // Pinned in the thumbnail's top-right corner, over the artwork and clear of the title.
    const tag = badge.getBoundingClientRect()
    const thumbnail = badge.parentElement!.getBoundingClientRect()
    await expect(tag.left).toBeGreaterThanOrEqual(thumbnail.left)
    await expect(tag.bottom).toBeLessThanOrEqual(thumbnail.bottom)
    await expect(tag.top - thumbnail.top).toBeGreaterThanOrEqual(0)
    await expect(tag.top - thumbnail.top).toBeLessThan(4)
    await expect(thumbnail.right - tag.right).toBeGreaterThanOrEqual(0)
    await expect(thumbnail.right - tag.right).toBeLessThan(4)
    // The copy that follows a drag is the same row, tag included.
    await userEvent.click(handle)
    await userEvent.keyboard("[Space]")
    const overlay = canvasElement.ownerDocument.querySelector<HTMLElement>("[data-product-drag-overlay]")
    await expect(within(overlay!).getByText("New")).toBeVisible()
    await userEvent.keyboard("[Escape]")
    await waitFor(() => expect(canvasElement.ownerDocument.querySelector("[data-product-drag-overlay]")).toBeNull())
    // The tag describes what shoppers see, so it comes off with the tee.
    await chooseAction(canvasElement, "Everyday Type", "Hide from shop")
    await waitFor(() => expect(hiddenOrder(canvasElement)).toEqual(["Everyday Type"]))
    await expect(canvas.queryByText("New")).toBeNull()
  },
}

export const NothingHidden: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("heading", { name: "Hidden from the shop" })).toBeVisible()
    await expect(canvas.getByText("Nothing is hidden. Every published tee is in the shop.")).toBeVisible()
  },
}

export const DesignOfTheWeekSection: Story = {
  beforeEach: mockSave(200),
  args: { designOfWeekProductIds: ["everyday-type", "send-it"] },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const drop = within(canvas.getByRole("list", { name: "Design of the Week products" }))
    await expect(drop.getAllByRole("listitem")).toHaveLength(2)
    await expect(lineup(canvasElement)).toEqual(["Studio Lines", "Rest Day Club"])
    await userEvent.click(drop.getByRole("button", { name: "Reorder Send It" }))
    await userEvent.keyboard("[Space][ArrowUp][Space]")
    await expect(savedOrders).toEqual([["send-it", "everyday-type", "studio-lines", "rest-day"]])
    await chooseAction(canvasElement, "Send It", "Hide from shop")
    await expect(within(canvas.getByRole("list", { name: "Hidden products" })).getAllByRole("listitem")).toHaveLength(1)
  },
}

export const GarmentSetupMissing: Story = {
  args: {
    products: [
      { ...meta.args.products[0]!, garmentSetup: { blueprintId: 9999, label: null } },
      meta.args.products[1]!,
      {
        id: "crop-life",
        title: "Crop Life",
        image: null,
        ...hidden,
        garmentSetup: { blueprintId: 1312, label: "Next Level 5080" },
      },
    ],
  },
  beforeEach: mockSave(200),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const page = within(canvasElement.ownerDocument.body)
    const blockedTrigger = canvas.getByRole("button", { name: "Actions for Crop Life" })
    await userEvent.click(blockedTrigger)
    await expect(await page.findByRole("menuitem", { name: "Show in shop" })).toHaveAttribute("aria-disabled", "true")
    await userEvent.keyboard("{Escape}")
    // Finish the first menu's focus restoration before opening the next one.
    await waitFor(() => expect(page.queryByRole("menu", { hidden: true })).toBeNull())
    await waitFor(() => expect(blockedTrigger).toHaveFocus())
    await expect(canvas.getByRole("link", { name: /Set up Next Level 5080\s+for Crop Life/ })).toHaveAttribute(
      "href",
      "/admin/products/garments#garment-1312"
    )
    await chooseAction(canvasElement, "Everyday Type", "Hide from shop")
    await waitFor(() => expect(lineup(canvasElement)).toEqual(["Send It"]))
    await waitFor(() => expect(canvas.getByRole("button", { name: "Actions for Everyday Type" })).toHaveFocus())
  },
}

const scheduleArgs = {
  products: [...meta.args.products, { id: "waiting", title: "Waiting for the Weekend", image: null, ...hidden }],
  schedule: { entries: [], slots },
}

export const ScheduleTogether: Story = {
  args: scheduleArgs,
  beforeEach: mockSave(200),
  parameters: { viewport: { defaultViewport: "mobile1" } },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const page = within(canvasElement.ownerDocument.body)
    await expect(
      canvas.getByText(
        `Every ${formatWeeklyCadence()}. Hidden products and their approved homepage hero appear when their week begins.`
      )
    ).toBeVisible()
    const week = within(canvas.getByRole("region", { name: `Week of ${slots[0]!.label}` }))
    const add = week.getByRole("button", { name: "Add the first product" })
    await userEvent.click(add)
    const dialog = within(await page.findByRole("dialog", { name: "Add products to this week" }))
    await waitFor(() =>
      expect(
        dialog.getByText(
          `Hidden products appear in the shop on ${formatWeeklyCadence()}. Removing a product from a future week leaves its shop visibility unchanged. Products stay for sale after their featured week ends.`
        )
      ).toBeVisible()
    )
    await userEvent.click(dialog.getByRole("checkbox", { name: /Everyday Type/ }))
    await userEvent.click(dialog.getByRole("checkbox", { name: /Waiting for the Weekend/ }))
    await userEvent.click(dialog.getByRole("button", { name: "Add 2 products" }))
    await waitFor(() => expect(page.queryByRole("dialog")).toBeNull())
    await expect(week.getAllByRole("listitem")).toHaveLength(2)
    await expect(savedSchedules).toEqual([{ productIds: ["everyday-type", "waiting"], liveAt: slots[0]!.value }])
    await expect(within(canvas.getByRole("list", { name: "Hidden products" })).getAllByRole("listitem")).toHaveLength(1)
    await waitFor(() => expect(week.getByRole("button", { name: "Add products" })).toHaveFocus())
  },
}

export const ScheduleDialogKeyboardFocus: Story = {
  args: scheduleArgs,
  beforeEach: mockSave(200),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const page = within(canvasElement.ownerDocument.body)
    const trigger = canvas.getByRole("button", { name: "Actions for Waiting for the Weekend" })
    trigger.focus()
    await userEvent.keyboard("{Enter}")
    await waitFor(() => expect(page.getByRole("menuitem", { name: "Show in shop" })).toHaveFocus())
    await userEvent.keyboard("{ArrowDown}{Enter}")
    const dialog = within(await page.findByRole("dialog", { name: "Add to Design of the week" }))
    await waitFor(() => expect(dialog.getByRole("combobox", { name: "Featured week" })).toHaveFocus())
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(page.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(trigger).toHaveFocus())
    await expect(savedSchedules).toEqual([])
  },
}

export const ScheduleSaveFailure: Story = {
  args: scheduleArgs,
  beforeEach: mockSave(503),
  play: async ({ canvasElement, userEvent }) => {
    const page = within(canvasElement.ownerDocument.body)
    await chooseAction(canvasElement, "Waiting for the Weekend", "Add to Design of the week")
    const dialog = within(await page.findByRole("dialog", { name: "Add to Design of the week" }))
    await userEvent.click(dialog.getByRole("button", { name: "Save featured week" }))
    await expect(await dialog.findByRole("alert")).toHaveTextContent("That schedule did not save")
    await expect(dialog.getByRole("button", { name: "Save featured week" })).toBeEnabled()
  },
}

export const MoveBetweenPopulatedWeeksByKeyboard: Story = {
  args: {
    ...scheduleArgs,
    products: scheduleArgs.products.map((product) =>
      product.id === "waiting" ? { ...product, revealAt: slots[1]!.value } : product
    ),
    schedule: {
      slots,
      entries: [
        { id: "entry-everyday-type", productId: "everyday-type", liveAt: slots[0]!.value },
        { id: "entry-waiting", productId: "waiting", liveAt: slots[1]!.value },
      ],
    },
  },
  beforeEach: mockSave(200),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const handle = canvas.getByRole("button", { name: "Move Waiting for the Weekend to another week by dragging" })
    handle.focus()
    await userEvent.keyboard("[Space]")
    await waitFor(() =>
      expect(canvasElement.ownerDocument.querySelector("[data-product-drag-overlay]")).toHaveTextContent(
        "Waiting for the Weekend"
      )
    )
    await userEvent.keyboard("[ArrowUp]")
    await expect(
      await within(canvasElement.ownerDocument.body).findByText(
        "Waiting for the Weekend is over the week of September 25, 2026."
      )
    ).toBeInTheDocument()
    await userEvent.keyboard("[Space]")
    const firstWeek = within(canvas.getByRole("region", { name: `Week of ${slots[0]!.label}` }))
    await waitFor(() => expect(firstWeek.getAllByRole("listitem")).toHaveLength(2))
    await expect(
      within(canvas.getByRole("region", { name: `Week of ${slots[1]!.label}` })).queryByRole("list")
    ).toBeNull()
    await expect(savedSchedules).toEqual([{ productIds: ["waiting"], liveAt: slots[0]!.value }])
    await expect(within(canvas.getByRole("list", { name: "Hidden products" })).getAllByRole("listitem")).toHaveLength(1)
  },
}

export const ScheduledActionsRestoreFocus: Story = {
  args: {
    ...scheduleArgs,
    products: scheduleArgs.products.map((product) =>
      product.id === "waiting" ? { ...product, revealAt: slots[0]!.value } : product
    ),
    schedule: { slots, entries: [{ id: "entry-waiting", productId: "waiting", liveAt: slots[0]!.value }] },
  },
  beforeEach: mockSave(200),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const page = within(canvasElement.ownerDocument.body)
    const originalTrigger = canvas.getByRole("button", { name: "Scheduled actions for Waiting for the Weekend" })
    originalTrigger.focus()
    await userEvent.keyboard("{Enter}")
    await waitFor(() => expect(page.getByRole("menuitem", { name: "Preview product" })).toHaveFocus())
    await userEvent.keyboard("{ArrowDown}{Enter}")
    const dialog = within(await page.findByRole("dialog", { name: "Change featured week" }))
    await userEvent.selectOptions(dialog.getByRole("combobox", { name: "Featured week" }), slots[1]!.value)
    const save = dialog.getByRole("button", { name: "Save featured week" })
    save.focus()
    await userEvent.keyboard("{Enter}")
    await waitFor(() => expect(page.queryByRole("dialog")).toBeNull())
    await expect(originalTrigger.isConnected).toBe(false)
    const replacement = within(canvas.getByRole("region", { name: `Week of ${slots[1]!.label}` })).getByRole("button", {
      name: "Scheduled actions for Waiting for the Weekend",
    })
    await waitFor(() => expect(replacement).toHaveFocus())

    await userEvent.keyboard("{Enter}")
    await waitFor(() => expect(page.getByRole("menuitem", { name: "Preview product" })).toHaveFocus())
    await userEvent.keyboard("{End}{Enter}")
    await waitFor(() =>
      expect(canvas.queryByRole("button", { name: "Scheduled actions for Waiting for the Weekend" })).toBeNull()
    )
    await waitFor(() =>
      expect(canvas.getByRole("button", { name: "Actions for Waiting for the Weekend" })).toHaveFocus()
    )
    await waitFor(() => expect(page.queryByRole("menu", { hidden: true })).toBeNull())
    await expect(within(canvas.getByRole("list", { name: "Hidden products" })).getAllByRole("listitem")).toHaveLength(1)
  },
}

export const KeyboardDropWithoutMovement: Story = {
  args: {
    ...scheduleArgs,
    products: [
      ...scheduleArgs.products,
      { id: "queued", title: "Queued for a Send", image: null, ...hidden, revealAt: slots[0]!.value },
    ],
    schedule: { slots, entries: [{ id: "entry-queued", productId: "queued", liveAt: slots[0]!.value }] },
  },
  beforeEach: mockSave(200),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const handles = [
      canvas.getByRole("button", { name: "Reorder Everyday Type" }),
      canvas.getByRole("button", { name: "Reorder Waiting for the Weekend" }),
      canvas.getByRole("button", { name: "Move Queued for a Send to another week by dragging" }),
    ]
    for (const handle of handles) {
      for (const drop of ["[Space]", "[Enter]"]) {
        handle.focus()
        await userEvent.keyboard("[Space]")
        await waitFor(() =>
          expect(canvasElement.ownerDocument.querySelector("[data-product-drag-overlay]")).toBeVisible()
        )
        await userEvent.keyboard(drop)
        await waitFor(() => expect(canvasElement.ownerDocument.querySelector("[data-product-drag-overlay]")).toBeNull())
        await expect(savedSchedules).toEqual([])
        await expect(savedOrders).toEqual([])
        await expect(handle).toHaveFocus()
        await expect(
          within(canvasElement.ownerDocument.body).getByText(
            /^(Everyday Type|Waiting for the Weekend|Queued for a Send) was not moved\.$/
          )
        ).toBeInTheDocument()
      }
    }
    const week = within(canvas.getByRole("region", { name: `Week of ${slots[0]!.label}` }))
    await expect(week.getAllByRole("listitem")).toHaveLength(1)
    await expect(week.getByText("Queued for a Send")).toBeVisible()
    await expect(within(canvas.getByRole("list", { name: "Hidden products" })).getAllByRole("listitem")).toHaveLength(2)
  },
}

export const HiddenPointerDragChoosesAWeek: Story = {
  args: { ...scheduleArgs, products: [meta.args.products[0]!, scheduleArgs.products.at(-1)!] },
  beforeEach: mockSave(200),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const list = canvas.getByRole("list", { name: "Hidden products" })
    // Synthetic pointer events do not scroll, and coordinates off the screen would start dnd-kit's
    // auto-scroll under the pointer. The last week sits just above the short lineup, so both fit.
    list.scrollIntoView({ block: "end", behavior: "instant" })
    const handle = canvas.getByRole("button", { name: "Reorder Waiting for the Weekend" })
    const week = canvas.getByRole("region", { name: `Week of ${slots[5]!.label}` })
    const start = handle.getBoundingClientRect()
    const target = week.getBoundingClientRect()
    const inside = { clientX: target.x + target.width / 2, clientY: target.y + target.height / 2 }
    await expect(target.top).toBeGreaterThan(0)
    await expect(start.bottom).toBeLessThan(canvasElement.ownerDocument.defaultView!.innerHeight)
    await userEvent.pointer({
      keys: "[MouseLeft>]",
      target: handle,
      coords: { clientX: start.x + start.width / 2, clientY: start.y + start.height / 2 },
    })
    await userEvent.pointer({
      target: handle,
      coords: { clientX: start.x + start.width / 2, clientY: start.y + start.height / 2 - 12 },
    })
    await waitFor(() => expect(canvasElement.ownerDocument.querySelector("[data-product-drag-overlay]")).toBeVisible())
    await userEvent.pointer({ target: week, coords: inside })
    await expect(
      await within(canvasElement.ownerDocument.body).findByText(
        `Waiting for the Weekend is over the week of ${slots[5]!.label}.`
      )
    ).toBeInTheDocument()
    await userEvent.pointer({ keys: "[/MouseLeft]", target: week, coords: inside })
    await waitFor(() => expect(within(week).getAllByRole("listitem")).toHaveLength(1))
    await expect(savedSchedules).toEqual([{ productIds: ["waiting"], liveAt: slots[5]!.value }])
    await expect(savedOrders).toEqual([])
    // Saving can finish before dnd-kit's drop animation restores the original row's opacity.
    await waitFor(() => expect(canvasElement.ownerDocument.querySelector("[data-product-drag-overlay]")).toBeNull())
    await expect(hiddenOrder(canvasElement)).toEqual(["Waiting for the Weekend"])
  },
}

export const PointerDropBetweenRows: Story = {
  args: scheduleArgs,
  beforeEach: mockSave(200),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const list = canvas.getByRole("list", { name: "Available products" })
    // Synthetic pointer events do not scroll targets into view. Offscreen coordinates trigger
    // dnd-kit's auto-scroll and move the measured gap underneath the pointer during the drag.
    list.scrollIntoView({ block: "center", behavior: "instant" })
    const handle = canvas.getByRole("button", { name: "Reorder Everyday Type" })
    const start = handle.getBoundingClientRect()
    const above = canvas.getByRole("button", { name: "Reorder Send It" }).closest("li")!.getBoundingClientRect()
    const below = canvas.getByRole("button", { name: "Reorder Studio Lines" }).closest("li")!.getBoundingClientRect()
    const gap = { clientX: above.x + above.width / 2, clientY: above.bottom + (below.top - above.bottom) / 4 }
    await expect(start.top).toBeGreaterThan(0)
    await expect(gap.clientY).toBeLessThan(canvasElement.ownerDocument.defaultView!.innerHeight)
    await expect(gap.clientY).toBeGreaterThan(above.bottom)
    await expect(gap.clientY).toBeLessThan(below.top)
    await userEvent.pointer({
      keys: "[MouseLeft>]",
      target: handle,
      coords: { clientX: start.x + start.width / 2, clientY: start.y + start.height / 2 },
    })
    await userEvent.pointer({
      target: handle,
      coords: { clientX: start.x + start.width / 2, clientY: start.y + start.height / 2 + 12 },
    })
    await waitFor(() => expect(canvasElement.ownerDocument.querySelector("[data-product-drag-overlay]")).toBeVisible())
    await userEvent.pointer({ target: list, coords: gap })
    await waitFor(() =>
      expect(
        within(canvasElement.ownerDocument.body).getByText("Everyday Type is over position 2 of 4.")
      ).toBeInTheDocument()
    )
    await userEvent.pointer({ keys: "[/MouseLeft]", target: list, coords: gap })
    await waitFor(() =>
      expect(lineup(canvasElement)).toEqual(["Send It", "Everyday Type", "Studio Lines", "Rest Day Club"])
    )
    await expect(savedOrders).toEqual([["send-it", "everyday-type", "studio-lines", "rest-day", "waiting"]])
    await expect(savedSchedules).toEqual([])
  },
}

export const PointerDropOutsideAWeek: Story = {
  args: scheduleArgs,
  beforeEach: mockSave(200),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const week = canvas.getByRole("region", { name: `Week of ${slots[0]!.label}` }).getBoundingClientRect()
    const outside = { clientX: week.left - 12, clientY: week.top + week.height / 2 }
    for (const label of ["Reorder Everyday Type", "Reorder Waiting for the Weekend"]) {
      const handle = canvas.getByRole("button", { name: label })
      const start = handle.getBoundingClientRect()
      await userEvent.pointer({
        keys: "[MouseLeft>]",
        target: handle,
        coords: { clientX: start.x + start.width / 2, clientY: start.y + start.height / 2 },
      })
      await userEvent.pointer({
        target: handle,
        coords: { clientX: start.x + start.width / 2, clientY: start.y + start.height / 2 + 12 },
      })
      await userEvent.pointer({ target: canvasElement, coords: outside })
      await userEvent.pointer({ keys: "[/MouseLeft]", target: canvasElement, coords: outside })
      await waitFor(() => expect(canvasElement.ownerDocument.querySelector("[data-product-drag-overlay]")).toBeNull())
      await expect(savedSchedules).toEqual([])
      await expect(savedOrders).toEqual([])
    }
    await expect(lineup(canvasElement)).toEqual(["Everyday Type", "Send It", "Studio Lines", "Rest Day Club"])
    await expect(canvas.getByRole("link", { name: /Preview product\s*: Waiting for the Weekend/ })).toBeVisible()
  },
}
