import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ProductScheduleReceipt } from "@/features/publishing/product-schedule-entry"

import type { FeaturedOrderProduct } from "./featured-order-product"
import { FeaturedOrderList } from "./featured-order-list"

const { refresh, cadence } = vi.hoisted(() => ({
  refresh: vi.fn(),
  cadence: { weekday: 5, hour: 17, minute: 30, timeZone: "America/Chicago" },
}))
vi.mock("@/features/publishing/dotw-cadence", () => ({ DOTW_CADENCE: cadence }))
beforeEach(() => {
  Object.assign(cadence, { weekday: 5, hour: 17, minute: 30, timeZone: "America/Chicago" })
})
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const now = Date.parse("2026-09-20T12:00:00.000Z")
// In the shop since Sep 1: on the wall, and well past the two weeks that earn the New badge.
const shown = {
  hiddenAt: null,
  revealAt: null,
  revealedAt: "2026-09-01T00:00:00.000Z",
  addedToShopAt: "2026-09-01T00:00:00.000Z",
}
const products: FeaturedOrderProduct[] = [
  {
    id: "everyday-type",
    title: "Everyday Type",
    image: { src: "https://images.printify.com/k.jpg", alt: "Everyday Type" },
    ...shown,
  },
  { id: "send-it", title: "Send It", image: null, ...shown },
  { id: "crimp", title: "Studio Lines", image: null, ...shown },
]

function order() {
  return within(screen.getByRole("list", { name: "Available products" }))
    .getAllByRole("listitem")
    .map(rowTitle)
}

// A row whose garment needs setup carries a second link, so the title is read off this one by name.
function productLink(item: HTMLElement) {
  return within(item).getByRole("link", { name: /^(View in shop|Preview product)/ })
}

function rowTitle(item: HTMLElement) {
  return productLink(item)
    .textContent?.replace(/^(View in shop|Preview product): /, "")
    .trim()
}

function hiddenOrder() {
  const list = screen.queryByRole("list", { name: "Hidden products" })
  return list ? within(list).getAllByRole("listitem").map(rowTitle) : []
}

// The compact badge is the thumbnail's only text, so a badged row is one that reads "New".
function badgedIn(listName: string) {
  const list = screen.queryByRole("list", { name: listName })
  return list
    ? within(list)
        .getAllByRole("listitem")
        .filter((item) => within(item).queryByText("New"))
        .map(rowTitle)
    : []
}

function savedOrders(request: ReturnType<typeof vi.fn>) {
  return request.mock.calls
    .filter(([url]) => String(url).endsWith("/featured-order"))
    .map(([, init]) => (JSON.parse((init as RequestInit).body as string) as { productIds: string[] }).productIds)
}

async function chooseAction(productTitle: string, action: string) {
  await userEvent.click(screen.getByRole("button", { name: `Actions for ${productTitle}` }))
  await userEvent.click(await screen.findByRole("menuitem", { name: action }))
}

describe("FeaturedOrderList", () => {
  it("saves the whole lineup as soon as a product moves and keeps focus on the moved product", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal("fetch", request)
    render(<FeaturedOrderList products={products} now={now} />)
    await chooseAction("Everyday Type", "Move down in shop")
    expect(order()).toEqual(["Send It", "Everyday Type", "Studio Lines"])
    expect(request).toHaveBeenCalledWith(
      "/api/admin/products/featured-order",
      expect.objectContaining({ method: "PUT", credentials: "same-origin" })
    )
    expect(savedOrders(request)).toEqual([["send-it", "everyday-type", "crimp"]])
    expect(await screen.findByText("Changes saved.")).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole("button", { name: "Actions for Everyday Type" })).toHaveFocus())
    expect(screen.getByText("Everyday Type moved to position 2 of 3.")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Google copy: Everyday Type" })).toHaveAttribute(
      "href",
      "/admin/products/everyday-type#google-copy"
    )
    expect(screen.getByRole("link", { name: "View in shop: Everyday Type" })).toHaveAttribute(
      "href",
      "/shop/everyday-type"
    )
  })

  it("returns focus to Actions when a product reaches the top and disables moving farther", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }))
    render(<FeaturedOrderList products={products} now={now} />)
    await chooseAction("Send It", "Move up in shop")
    expect(order()).toEqual(["Send It", "Everyday Type", "Studio Lines"])
    await waitFor(() => expect(screen.getByRole("button", { name: "Actions for Send It" })).toHaveFocus())
    await userEvent.click(screen.getByRole("button", { name: "Actions for Send It" }))
    expect(await screen.findByRole("menuitem", { name: "Move up in shop" })).toHaveAttribute("aria-disabled", "true")
    expect(await screen.findByRole("menuitem", { name: "Move down in shop" })).not.toHaveAttribute(
      "aria-disabled",
      "true"
    )
  })

  it("saves moves made during a request together once it finishes", async () => {
    const first = Promise.withResolvers<{ ok: boolean; status: number; json: () => Promise<object> }>()
    const request = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal("fetch", request)
    render(<FeaturedOrderList products={products} now={now} />)
    await chooseAction("Studio Lines", "Move up in shop")
    expect(screen.getByText("Saving…")).toBeInTheDocument()
    await chooseAction("Studio Lines", "Move up in shop")
    await chooseAction("Everyday Type", "Move down in shop")
    expect(request).toHaveBeenCalledTimes(1)
    first.resolve({ ok: true, status: 200, json: async () => ({}) })
    expect(await screen.findByText("Changes saved.")).toBeInTheDocument()
    expect(savedOrders(request)).toEqual([
      ["everyday-type", "crimp", "send-it"],
      ["crimp", "send-it", "everyday-type"],
    ])
    expect(order()).toEqual(["Studio Lines", "Send It", "Everyday Type"])
  })

  it.each([
    ["a server failure", () => Promise.resolve({ ok: false, status: 503 }), "didn't save"],
    ["a network failure", () => Promise.reject(new TypeError("offline")), "didn't save"],
    ["an ended session", () => Promise.resolve({ ok: false, status: 401 }), "Sign in again"],
  ])("restores the last saved order after %s", async (_label, response, message) => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
      .mockImplementationOnce(response)
    vi.stubGlobal("fetch", request)
    render(<FeaturedOrderList products={products} now={now} />)
    await chooseAction("Everyday Type", "Move down in shop")
    await screen.findByText("Changes saved.")
    await chooseAction("Studio Lines", "Move up in shop")
    expect(await screen.findByRole("alert")).toHaveTextContent(message)
    expect(order()).toEqual(["Send It", "Everyday Type", "Studio Lines"])
    expect(screen.queryByText(/^(Saving…|Featured order saved\.)$/)).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Reload products" })).not.toBeInTheDocument()
  })

  it("offers a reload when the published lineup changed underneath the page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409 }))
    render(<FeaturedOrderList products={products} now={now} />)
    await chooseAction("Everyday Type", "Move down in shop")
    expect(await screen.findByRole("alert")).toHaveTextContent("The product list changed")
    expect(order()).toEqual(["Everyday Type", "Send It", "Studio Lines"])
    await userEvent.click(screen.getByRole("button", { name: "Reload products" }))
    expect(refresh).toHaveBeenCalled()
  })

  it("clears an earlier error once a later move saves", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    )
    render(<FeaturedOrderList products={products} now={now} />)
    await chooseAction("Everyday Type", "Move down in shop")
    await screen.findByRole("alert")
    await chooseAction("Everyday Type", "Move down in shop")
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument())
    expect(await screen.findByText("Changes saved.")).toBeInTheDocument()
  })

  it("labels each drag handle with its product and describes the keyboard controls", () => {
    render(<FeaturedOrderList products={products} now={now} />)
    const handle = screen.getByRole("button", { name: "Reorder Everyday Type" })
    expect(handle).toHaveAttribute("aria-roledescription", "sortable")
    expect(handle).toHaveAccessibleDescription(/press Space or Enter/)
  })

  it("moves a product to the hidden list without touching the saved lineup", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal("fetch", request)
    render(<FeaturedOrderList products={products} now={now} />)
    await chooseAction("Everyday Type", "Hide from shop")

    expect(order()).toEqual(["Send It", "Studio Lines"])
    expect(hiddenOrder()).toEqual(["Everyday Type"])
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "/api/admin/products/everyday-type/visibility",
      expect.objectContaining({ method: "PUT", credentials: "same-origin" })
    )
    // Hiding must not rewrite sort_position, or a restored product would lose its slot.
    expect(savedOrders(request)).toEqual([])
    expect(screen.getByText("Everyday Type moved to Hidden products.")).toBeInTheDocument()
  })

  it("puts a restored product back in its original slot", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }))
    render(<FeaturedOrderList products={products} now={now} />)
    await chooseAction("Send It", "Hide from shop")
    expect(order()).toEqual(["Everyday Type", "Studio Lines"])
    await chooseAction("Send It", "Show in shop")
    expect(order()).toEqual(["Everyday Type", "Send It", "Studio Lines"])
    expect(hiddenOrder()).toEqual([])
  })

  it("reverts only the row whose visibility failed, keeping a reorder that saved", async () => {
    const request = vi.fn(async (url: string) =>
      String(url).includes("/visibility")
        ? { ok: false, status: 503 }
        : { ok: true, status: 200, json: async () => ({}) }
    )
    vi.stubGlobal("fetch", request)
    render(<FeaturedOrderList products={products} now={now} />)
    await chooseAction("Everyday Type", "Move down in shop")
    await screen.findByText("Changes saved.")
    await chooseAction("Studio Lines", "Hide from shop")

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument())
    expect(hiddenOrder()).toEqual([])
    expect(order()).toEqual(["Send It", "Everyday Type", "Studio Lines"])
    // The earlier reorder did save, but the page must not go on claiming this hide did.
    expect(screen.queryByText("Changes saved.")).not.toBeInTheDocument()
    expect(screen.getByText("Studio Lines is still in the shop.")).toBeInTheDocument()
  })

  it("keeps keyboard focus on Actions after hiding and showing a product", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }))
    render(<FeaturedOrderList products={products} now={now} />)
    const user = userEvent.setup()
    screen.getByRole("button", { name: "Actions for Send It" }).focus()
    await user.keyboard("{Enter}")
    await waitFor(() =>
      expect(
        screen.getByRole("menuitem", { name: hiddenOrder().length ? "Show in shop" : "Hide from shop" })
      ).toHaveFocus()
    )
    await user.keyboard("{Enter}")
    await waitFor(() => expect(hiddenOrder()).toEqual(["Send It"]))
    await waitFor(() => expect(screen.getByRole("button", { name: "Actions for Send It" })).toHaveFocus())
    await user.keyboard("{Enter}")
    await waitFor(() =>
      expect(
        screen.getByRole("menuitem", { name: hiddenOrder().length ? "Show in shop" : "Hide from shop" })
      ).toHaveFocus()
    )
    await user.keyboard("{Enter}")
    await waitFor(() => expect(order()).toEqual(["Everyday Type", "Send It", "Studio Lines"]))
    await waitFor(() => expect(screen.getByRole("button", { name: "Actions for Send It" })).toHaveFocus())
  })

  it("hands focus back to Actions when a hide fails and the row returns", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    render(<FeaturedOrderList products={products} now={now} />)
    await chooseAction("Send It", "Hide from shop")
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole("button", { name: "Actions for Send It" })).toHaveFocus())
  })

  it("keeps the hidden section visible when nothing is hidden", () => {
    render(<FeaturedOrderList products={products} now={now} />)
    expect(screen.getByRole("heading", { name: "Hidden from the shop" })).toBeInTheDocument()
    expect(screen.getByText("Nothing is hidden. Every published tee is in the shop.")).toBeInTheDocument()
  })

  it("keeps the live drop separate and allows a featured product to be hidden", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }))
    render(<FeaturedOrderList products={products} now={now} designOfWeekProductIds={["send-it"]} />)
    const drop = within(screen.getByRole("list", { name: "Design of the Week products" }))
    expect(drop.getAllByRole("listitem")).toHaveLength(1)
    expect(drop.getByRole("link", { name: /^View in shop: Send It/ })).toBeVisible()
    expect(order()).toEqual(["Everyday Type", "Studio Lines"])
    expect(hiddenOrder()).toEqual([])
    expect(drop.getByRole("button", { name: "Reorder Send It" })).toBeVisible()
    await chooseAction("Send It", "Hide from shop")
    expect(hiddenOrder()).toEqual(["Send It"])
    expect(screen.queryByRole("list", { name: "Design of the Week products" })).not.toBeInTheDocument()
  })

  it("counts positions within the drop, not against the whole lineup", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }))
    render(<FeaturedOrderList products={products} now={now} designOfWeekProductIds={["everyday-type", "send-it"]} />)
    await chooseAction("Send It", "Move up in shop")
    expect(screen.getByText("Send It moved to position 1 of 2.")).toBeInTheDocument()
    const drop = within(screen.getByRole("list", { name: "Design of the Week products" }))
    expect(
      drop
        .getAllByRole("link", { name: /^(View in shop|Preview product)/ })
        .map((link) => link.textContent?.replace(/^(View in shop|Preview product): /, "").trim())
    ).toEqual(["Send It", "Everyday Type"])
    // The whole lineup is still what gets saved; the reorder route checks the exact active set.
    expect(savedOrders(vi.mocked(globalThis.fetch))).toEqual([["send-it", "everyday-type", "crimp"]])
  })

  // A scheduled tee is not automatically a drop: membership is explicit.
  it("leaves an ordinary scheduled product in the hidden list with its own note", () => {
    const later = new Date(now + 60 * 60 * 1000).toISOString()
    render(
      <FeaturedOrderList
        now={now}
        designOfWeekProductIds={[]}
        products={[
          {
            id: "soon",
            title: "Coming Soon",
            image: null,
            hiddenAt: "2026-09-19T10:00:00.000Z",
            revealAt: later,
            revealedAt: null,
            addedToShopAt: null,
          },
        ]}
      />
    )
    expect(hiddenOrder()).toEqual(["Coming Soon"])
    expect(screen.queryByRole("list", { name: "Design of the Week products" })).not.toBeInTheDocument()
  })

  it("explains why each hidden product is off the wall and sorts them among themselves", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal("fetch", request)
    const later = new Date(now + 60 * 60 * 1000).toISOString()
    render(
      <FeaturedOrderList
        products={[
          products[0]!,
          {
            id: "never",
            title: "Never Shown",
            image: null,
            hiddenAt: "2026-09-19T10:00:00.000Z",
            revealAt: null,
            revealedAt: null,
            addedToShopAt: null,
          },
          products[1]!,
          {
            id: "soon",
            title: "Coming Soon",
            image: null,
            hiddenAt: "2026-09-19T10:00:00.000Z",
            revealAt: later,
            revealedAt: null,
            addedToShopAt: null,
          },
        ]}
        now={now}
      />
    )
    expect(screen.getByText("Never shown")).toBeInTheDocument()
    expect(screen.getByText(/^Reveals /)).toBeInTheDocument()
    const list = within(screen.getByRole("list", { name: "Hidden products" }))
    expect(list.getByRole("button", { name: "Reorder Coming Soon" })).toHaveAttribute(
      "aria-roledescription",
      "sortable"
    )
    await chooseAction("Coming Soon", "Move up")
    expect(hiddenOrder()).toEqual(["Coming Soon", "Never Shown"])
    // A hidden row steps over hidden neighbours only, so the shop's own order is untouched, and the
    // whole lineup is still what gets saved.
    expect(order()).toEqual(["Everyday Type", "Send It"])
    expect(savedOrders(request)).toEqual([["everyday-type", "soon", "never", "send-it"]])
    expect(await screen.findByText("Changes saved.")).toBeInTheDocument()
    expect(screen.getByText("Coming Soon moved to position 1 of 2.")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Actions for Coming Soon" }))
    expect(await screen.findByRole("menuitem", { name: "Move up" })).toHaveAttribute("aria-disabled", "true")
    expect(screen.getByRole("menuitem", { name: "Move down" })).not.toHaveAttribute("aria-disabled", "true")
    // Not "in shop": a hidden tee's order is where it will land once it is shown.
    expect(screen.queryByRole("menuitem", { name: /^Move (up|down) in shop$/ })).not.toBeInTheDocument()
  })

  describe("garment setup", () => {
    const hiddenSince = { hiddenAt: "2026-09-19T10:00:00.000Z", revealAt: null, revealedAt: null, addedToShopAt: null }
    const waiting: FeaturedOrderProduct = {
      id: "crop",
      title: "Crop Top",
      image: null,
      ...hiddenSince,
      garmentSetup: { blueprintId: 9999, label: null },
    }
    const refusal =
      "This product's garment still needs a category and apparel details. Finish it under Garment models, then show it."

    // Show would be refused by the server, and the optimistic move would flash the row into the shop
    // and back. A disabled button cannot be focused to explain itself, so the reason must be text.
    it("disables Show on a hidden product whose garment is not set up, and says why beside it", async () => {
      vi.stubGlobal("fetch", vi.fn())
      render(<FeaturedOrderList products={[...products, waiting]} now={now} />)
      await userEvent.click(screen.getByRole("button", { name: "Actions for Crop Top" }))
      expect(await screen.findByRole("menuitem", { name: "Show in shop" })).toHaveAttribute("aria-disabled", "true")
      expect(screen.getByText("Garment setup missing.")).toBeInTheDocument()
      expect(screen.getByRole("link", { name: "Set up blueprint 9999 for Crop Top" })).toHaveAttribute(
        "href",
        "/admin/products/garments#garment-9999"
      )
      expect(fetch).not.toHaveBeenCalled()
    })

    it("names the garment once it has a name, and links to the page when no blueprint can be read", () => {
      render(
        <FeaturedOrderList
          now={now}
          products={[
            { ...waiting, garmentSetup: { blueprintId: 1312, label: "Next Level 5080" } },
            { ...waiting, id: "mystery", title: "Mystery Tee", garmentSetup: { blueprintId: null, label: null } },
          ]}
        />
      )
      expect(screen.getByRole("link", { name: "Set up Next Level 5080 for Crop Top" })).toHaveAttribute(
        "href",
        "/admin/products/garments#garment-1312"
      )
      expect(screen.getByRole("link", { name: "Open Garment models for Mystery Tee" })).toHaveAttribute(
        "href",
        "/admin/products/garments"
      )
    })

    it("leaves Show alone on hidden products whose garment is ready or unknown", async () => {
      render(
        <FeaturedOrderList
          now={now}
          products={[
            { ...waiting, id: "ready", title: "Ready Tee", garmentSetup: null },
            { id: "unknown", title: "Unknown Tee", image: null, ...hiddenSince },
          ]}
        />
      )
      await userEvent.click(screen.getByRole("button", { name: "Actions for Ready Tee" }))
      expect(await screen.findByRole("menuitem", { name: "Show in shop" })).not.toHaveAttribute("aria-disabled", "true")
      await userEvent.keyboard("{Escape}")
      await userEvent.click(screen.getByRole("button", { name: "Actions for Unknown Tee" }))
      expect(await screen.findByRole("menuitem", { name: "Show in shop" })).not.toHaveAttribute("aria-disabled", "true")
      expect(screen.queryByText(/Garment setup missing/)).not.toBeInTheDocument()
    })

    // Hiding remains available even when showing the product again requires garment setup.
    it("still hides a shown product whose garment is not set up, and returns focus to Actions", async () => {
      const request = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
      vi.stubGlobal("fetch", request)
      render(
        <FeaturedOrderList
          now={now}
          products={[{ ...products[0]!, garmentSetup: { blueprintId: 9999, label: null } }, products[1]!]}
        />
      )
      await chooseAction("Everyday Type", "Hide from shop")
      expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({ hidden: true })
      await waitFor(() => expect(hiddenOrder()).toEqual(["Everyday Type"]))
      await waitFor(() => expect(screen.getByRole("button", { name: "Actions for Everyday Type" })).toHaveFocus())
      await userEvent.click(screen.getByRole("button", { name: "Actions for Everyday Type" }))
      expect(await screen.findByRole("menuitem", { name: "Show in shop" })).toHaveAttribute("aria-disabled", "true")
    })

    it("keeps the garment notice on a live featured row while allowing Hide", async () => {
      render(
        <FeaturedOrderList
          now={now}
          designOfWeekProductIds={["everyday-type"]}
          products={[{ ...products[0]!, garmentSetup: { blueprintId: 9999, label: null } }, products[1]!]}
        />
      )
      const drop = within(screen.getByRole("list", { name: "Design of the Week products" }))
      expect(drop.getByRole("link", { name: "Set up blueprint 9999 for Everyday Type" })).toBeVisible()
      await userEvent.click(drop.getByRole("button", { name: "Actions for Everyday Type" }))
      expect(await screen.findByRole("menuitem", { name: "Hide from shop" })).not.toHaveAttribute(
        "aria-disabled",
        "true"
      )
    })

    // A stale page, or a garment cleared a moment ago: the server refuses, and "try again in a
    // moment" would be the one piece of advice that can never work.
    it("shows the server's refusal and a way to fix it instead of inviting a retry", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 409,
          json: async () => ({ error: refusal, code: "GARMENT_INCOMPLETE" }),
        })
      )
      render(<FeaturedOrderList products={[...products, { ...waiting, garmentSetup: null }]} now={now} />)
      await chooseAction("Crop Top", "Show in shop")
      const alert = await screen.findByRole("alert")
      expect(alert).toHaveTextContent(refusal)
      expect(alert).not.toHaveTextContent(/try again/i)
      expect(within(alert).getByRole("link", { name: "Set up the garment" })).toHaveAttribute(
        "href",
        "/admin/products/garments"
      )
      expect(screen.queryByRole("button", { name: "Reload products" })).not.toBeInTheDocument()
      // Nothing was shown, so the row is back where it was and nothing goes on claiming otherwise.
      expect(hiddenOrder()).toEqual(["Crop Top"])
      expect(order()).toEqual(["Everyday Type", "Send It", "Studio Lines"])
      expect(screen.getByText("Crop Top is still hidden.")).toBeInTheDocument()
      expect(screen.queryByText("Changes saved.")).not.toBeInTheDocument()
      await waitFor(() => expect(screen.getByRole("button", { name: "Actions for Crop Top" })).toHaveFocus())
    })

    it("still explains a garment refusal whose body cannot be read", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => Promise.reject(new Error("not json")) })
      )
      render(<FeaturedOrderList products={[{ ...waiting, garmentSetup: null }]} now={now} />)
      await chooseAction("Crop Top", "Show in shop")
      const alert = await screen.findByRole("alert")
      expect(alert).toHaveTextContent("This product's garment still needs setup before it can be shown.")
      expect(within(alert).getByRole("link", { name: "Set up the garment" })).toBeVisible()
    })

    // Every other failure keeps its old advice, and never reads a body it was not promised.
    it("keeps the retry message, and offers no garment link, for an ordinary failed show", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }))
      render(<FeaturedOrderList products={[{ ...waiting, garmentSetup: null }]} now={now} />)
      await chooseAction("Crop Top", "Show in shop")
      expect(await screen.findByRole("alert")).toHaveTextContent("That product is still hidden. Try again in a moment.")
      expect(screen.queryByRole("link", { name: "Set up the garment" })).not.toBeInTheDocument()
    })
  })

  // Rendered once on the server in UTC and again in the browser: a label read off either clock
  // would differ between the two, and would name the wrong day for a late-evening hide.
  it("labels moments on the store's clock rather than the viewer's", () => {
    render(
      <FeaturedOrderList
        products={[
          { ...products[0]!, hiddenAt: "2026-09-20T03:00:00.000Z" },
          { ...products[1]!, hiddenAt: "2026-09-01T00:00:00.000Z", revealAt: "2026-09-25T09:00:00.000Z" },
        ]}
        now={now}
      />
    )
    expect(screen.getByText("Hidden since Sep 19, 2026")).toBeInTheDocument()
    expect(screen.getByText(/^Reveals Sep 25, 2026, 4:00\sAM$/)).toBeInTheDocument()
  })
})

describe("New badge", () => {
  const day = 24 * 60 * 60 * 1000
  const daysAgo = (days: number) => new Date(now - days * day).toISOString()
  type VisibilityResponse = { ok: boolean; status: number; json?: () => Promise<object> }

  it("badges a tee that entered the shop in the last two weeks, in whichever section it sits", () => {
    render(
      <FeaturedOrderList
        now={now}
        designOfWeekProductIds={["send-it"]}
        products={[
          { ...products[0]!, addedToShopAt: daysAgo(13) },
          { ...products[1]!, addedToShopAt: daysAgo(2) },
          // Exactly two weeks is no longer new.
          { ...products[2]!, addedToShopAt: daysAgo(14) },
        ]}
      />
    )
    expect(badgedIn("Available products")).toEqual(["Everyday Type"])
    expect(badgedIn("Design of the Week products")).toEqual(["Send It"])
    expect(order()).toEqual(["Everyday Type", "Studio Lines"])
  })

  // New tells the owner what shoppers see, so a tee off the wall never wears it, however recently it
  // last arrived or however soon it is due back.
  it("never badges a hidden tee, even one that was in the shop days ago", () => {
    render(
      <FeaturedOrderList
        now={now}
        products={[
          products[0]!,
          { ...products[1]!, hiddenAt: daysAgo(1), addedToShopAt: daysAgo(3) },
          {
            ...products[2]!,
            hiddenAt: daysAgo(1),
            revealAt: new Date(now + day).toISOString(),
            addedToShopAt: daysAgo(3),
          },
        ]}
      />
    )
    expect(hiddenOrder()).toEqual(["Send It", "Studio Lines"])
    expect(screen.queryByText("New")).not.toBeInTheDocument()
  })

  // A timed reveal writes nothing, so the row still carries the stamp from its last visit. The
  // reveal itself is the arrival.
  it("badges a tee the clock revealed recently, though its stored arrival is old", () => {
    const away = {
      hiddenAt: "2026-08-01T00:00:00.000Z",
      revealedAt: "2026-07-01T00:00:00.000Z",
      addedToShopAt: "2026-07-01T00:00:00.000Z",
    }
    render(
      <FeaturedOrderList
        now={now}
        products={[
          { ...products[0]!, ...away, revealAt: daysAgo(20) },
          { ...products[1]!, ...away, revealAt: daysAgo(1) },
        ]}
      />
    )
    expect(order()).toEqual(["Everyday Type", "Send It"])
    expect(badgedIn("Available products")).toEqual(["Send It"])
  })

  describe("showing a hidden tee", () => {
    // In the shop from Sep 1 and hidden on Sep 10, so nothing about the row is new until Show.
    const takenDown = { ...products[1]!, hiddenAt: "2026-09-10T00:00:00.000Z" }
    const confirmed = {
      productId: "send-it",
      hidden: false,
      hiddenAt: null,
      revealAt: null,
      revealedAt: shown.revealedAt,
    }
    // The click lands a minute after the page loaded. Only Date is faked, so user-event keeps real timers.
    const clicked = now + 60_000

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] })
      vi.setSystemTime(clicked)
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    function renderWithShow(response: Promise<VisibilityResponse>) {
      const request = vi.fn().mockReturnValue(response)
      vi.stubGlobal("fetch", request)
      render(<FeaturedOrderList now={now} products={[products[0]!, takenDown]} />)
      return request
    }

    it("badges the tee the moment Show is clicked and keeps it once the server confirms the arrival", async () => {
      const response = Promise.withResolvers<VisibilityResponse>()
      const request = renderWithShow(response.promise)
      await chooseAction("Send It", "Show in shop")
      expect(order()).toEqual(["Everyday Type", "Send It"])
      expect(badgedIn("Available products")).toEqual(["Send It"])
      // The arrival is the server's to stamp; the request still only says what to do.
      expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({ hidden: false })
      response.resolve({
        ok: true,
        status: 200,
        json: async () => ({ ...confirmed, addedToShopAt: new Date(clicked + 250).toISOString() }),
      })
      expect(await screen.findByText("Changes saved.")).toBeInTheDocument()
      expect(badgedIn("Available products")).toEqual(["Send It"])
    })

    // The optimistic stamp is read off the browser's clock; the server's is the one that counts.
    it("takes the server's arrival over a browser clock that runs weeks slow", async () => {
      vi.setSystemTime(now - 30 * day)
      const response = Promise.withResolvers<VisibilityResponse>()
      renderWithShow(response.promise)
      await chooseAction("Send It", "Show in shop")
      expect(order()).toEqual(["Everyday Type", "Send It"])
      expect(badgedIn("Available products")).toEqual([])
      response.resolve({
        ok: true,
        status: 200,
        json: async () => ({ ...confirmed, addedToShopAt: new Date(clicked).toISOString() }),
      })
      await waitFor(() => expect(badgedIn("Available products")).toEqual(["Send It"]))
    })

    // A confirmation from the release before this field still settles the rest of the row, and the
    // click's stamp stands until the next load.
    it("keeps the click's arrival when the confirmation does not carry one", async () => {
      renderWithShow(Promise.resolve({ ok: true, status: 200, json: async () => confirmed }))
      await chooseAction("Send It", "Show in shop")
      expect(await screen.findByText("Changes saved.")).toBeInTheDocument()
      expect(badgedIn("Available products")).toEqual(["Send It"])
    })

    it("takes the badge back off when the show fails", async () => {
      const response = Promise.withResolvers<VisibilityResponse>()
      renderWithShow(response.promise)
      await chooseAction("Send It", "Show in shop")
      expect(badgedIn("Available products")).toEqual(["Send It"])
      response.resolve({ ok: false, status: 503 })
      expect(await screen.findByRole("alert")).toHaveTextContent("That product is still hidden.")
      expect(hiddenOrder()).toEqual(["Send It"])
      expect(screen.queryByText("New")).not.toBeInTheDocument()
    })
  })
})

const slots = [25, 2, 9, 16, 23, 30].map((day, index) => ({
  value: `2026-${index === 0 ? "09" : "10"}-${String(day).padStart(2, "0")}T22:30:00.000Z`,
  label: `${index === 0 ? "September" : "October"} ${day}, 2026`,
}))
const hiddenTee: FeaturedOrderProduct = {
  id: "waiting",
  title: "Waiting for the Weekend",
  image: null,
  hiddenAt: "2026-09-19T10:00:00.000Z",
  revealAt: null,
  revealedAt: null,
  addedToShopAt: null,
}
const scheduleProducts = [...products, hiddenTee]

function scheduledWeek(index: number) {
  return within(screen.getByRole("region", { name: `Week of ${slots[index]!.label}` }))
}

function scheduleResponse(
  productIds: string[],
  liveAt: string,
  receipt: Partial<ProductScheduleReceipt> & { outcome?: "removed" | "current" | "unscheduled" } = {}
) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      entries: productIds.map((productId) => ({ id: `entry-${productId}`, productId, liveAt })),
      // A receipt reports visibility only; each row keeps its own arrival.
      products: productIds.map((productId) => ({
        productId,
        ...(productId === hiddenTee.id
          ? { hiddenAt: hiddenTee.hiddenAt, revealAt: liveAt, revealedAt: null }
          : { hiddenAt: null, revealAt: null, revealedAt: shown.revealedAt }),
      })),
      now,
      ...receipt,
    }),
  }
}

async function openWeek(index: number) {
  await userEvent.click(scheduledWeek(index).getByRole("button", { name: /Add (the first product|products)/ }))
  return within(await screen.findByRole("dialog", { name: "Add products to this week" }))
}

describe("product scheduling from the shop lineup", () => {
  it("uses the configured day, clock time and zone in the weekly list and scheduling dialog", async () => {
    Object.assign(cadence, { weekday: 4, hour: 18, minute: 15, timeZone: "Asia/Kathmandu" })
    render(<FeaturedOrderList products={scheduleProducts} now={now} schedule={{ entries: [], slots }} />)
    expect(
      screen.getByText(
        "Every Thursday at 6:15 PM (Asia/Kathmandu). Hidden products and their approved homepage hero appear when their week begins."
      )
    ).toBeVisible()
    const dialog = await openWeek(0)
    expect(
      dialog.getByText(/^Hidden products appear in the shop on Thursday at 6:15 PM \(Asia\/Kathmandu\)/)
    ).toBeVisible()
  })

  it("renders six dated weeks and previews hidden published products through the private route", () => {
    render(<FeaturedOrderList products={scheduleProducts} now={now} schedule={{ entries: [], slots }} />)
    expect(screen.getAllByRole("region", { name: /^Week of / })).toHaveLength(6)
    expect(screen.getByRole("link", { name: "Preview product: Waiting for the Weekend" })).toHaveAttribute(
      "href",
      "/admin/products/waiting"
    )
    expect(screen.getByRole("button", { name: "Reorder Waiting for the Weekend" })).toBeEnabled()
  })

  it("distinguishes this week's live products from the upcoming schedule in heading navigation", () => {
    render(
      <FeaturedOrderList
        products={scheduleProducts}
        now={now}
        schedule={{
          entries: [{ id: "current", productId: "everyday-type", liveAt: "2026-09-18T22:30:00.000Z" }],
          slots,
        }}
      />
    )
    expect(screen.getByRole("heading", { name: "This week", level: 2 })).toBeVisible()
    expect(screen.getByRole("heading", { name: "Design of the Week", level: 2 })).toBeVisible()
  })

  // A queued card is badged by the lineup's rule: in the shop now, and arrived in the last two weeks.
  it("badges a queued card only while its tee is new in the shop", () => {
    const recently = "2026-09-18T09:00:00.000Z"
    render(
      <FeaturedOrderList
        products={[
          { ...products[0]!, addedToShopAt: recently },
          products[1]!,
          { ...hiddenTee, revealAt: slots[0]!.value, revealedAt: shown.revealedAt, addedToShopAt: recently },
        ]}
        now={now}
        schedule={{
          entries: ["everyday-type", "send-it", "waiting"].map((productId) => ({
            id: `entry-${productId}`,
            productId,
            liveAt: slots[0]!.value,
          })),
          slots,
        }}
      />
    )
    const card = (title: string) =>
      within(
        scheduledWeek(0)
          .getByRole("button", { name: `Move ${title} to another week by dragging` })
          .closest("li")!
      )
    expect(card("Everyday Type").getByText("Already in the shop")).toBeVisible()
    expect(card("Everyday Type").getByText("New")).toBeVisible()
    expect(card("Send It").getByText("Already in the shop")).toBeVisible()
    expect(card("Send It").queryByText("New")).not.toBeInTheDocument()
    expect(card("Waiting for the Weekend").getByText("Hidden until this week")).toBeVisible()
    expect(card("Waiting for the Weekend").queryByText("New")).not.toBeInTheDocument()
    expect(badgedIn("Available products")).toEqual(["Everyday Type"])
  })

  it("adds multiple products to one week without revealing a hidden product or hiding a shown one", async () => {
    const request = vi.fn().mockResolvedValue(scheduleResponse(["everyday-type", "waiting"], slots[0]!.value))
    vi.stubGlobal("fetch", request)
    render(<FeaturedOrderList products={scheduleProducts} now={now} schedule={{ entries: [], slots }} />)
    const dialog = await openWeek(0)
    await userEvent.click(dialog.getByRole("checkbox", { name: /Everyday Type/ }))
    await userEvent.click(dialog.getByRole("checkbox", { name: /Waiting for the Weekend/ }))
    await userEvent.click(dialog.getByRole("button", { name: "Add 2 products" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "/api/admin/product-schedule",
      expect.objectContaining({ method: "PUT", credentials: "same-origin" })
    )
    expect(JSON.parse(request.mock.calls[0]![1].body)).toEqual({
      productIds: ["everyday-type", "waiting"],
      liveAt: slots[0]!.value,
    })
    expect(scheduledWeek(0).getAllByRole("listitem")).toHaveLength(2)
    expect(order()).toEqual(["Everyday Type", "Send It", "Studio Lines"])
    expect(hiddenOrder()).toEqual(["Waiting for the Weekend"])
    expect(savedOrders(request)).toEqual([])
    expect(refresh).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    "moves an already scheduled product and restores focus (early frame: %s)",
    async (earlyFrame) => {
      const entry = { id: "entry-waiting", productId: "waiting", liveAt: slots[0]!.value }
      const request = vi.fn().mockResolvedValue(scheduleResponse(["waiting"], slots[1]!.value))
      vi.stubGlobal("fetch", request)
      render(<FeaturedOrderList products={scheduleProducts} now={now} schedule={{ entries: [entry], slots }} />)
      const originalTrigger = screen.getByRole("button", { name: "Scheduled actions for Waiting for the Weekend" })
      await userEvent.click(originalTrigger)
      await userEvent.click(await screen.findByRole("menuitem", { name: "Change week" }))
      const dialog = within(await screen.findByRole("dialog", { name: "Change featured week" }))
      expect(dialog.getByRole("combobox", { name: "Featured week" })).toHaveValue(slots[0]!.value)
      await userEvent.selectOptions(dialog.getByRole("combobox", { name: "Featured week" }), slots[1]!.value)
      // A frame is not a React commit boundary. Exercise the ordering that lost focus in browser CI.
      if (earlyFrame)
        vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
          callback(0)
          return 0
        })
      await userEvent.click(dialog.getByRole("button", { name: "Save featured week" }))
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
      expect(scheduledWeek(0).queryByRole("list")).not.toBeInTheDocument()
      expect(scheduledWeek(1).getAllByRole("listitem")).toHaveLength(1)
      expect(originalTrigger.isConnected).toBe(false)
      await waitFor(() =>
        expect(
          scheduledWeek(1).getByRole("button", { name: "Scheduled actions for Waiting for the Weekend" })
        ).toHaveFocus()
      )
      expect(hiddenOrder()).toEqual(["Waiting for the Weekend"])
      expect(JSON.parse(request.mock.calls[0]![1].body)).toEqual({ productIds: ["waiting"], liveAt: slots[1]!.value })
    }
  )

  it("removes a future slot while keeping the product hidden and in its lineup position", async () => {
    const entry = { id: "entry-waiting", productId: "waiting", liveAt: slots[0]!.value }
    const request = vi.fn().mockResolvedValue(
      scheduleResponse(["waiting"], slots[0]!.value, {
        entries: [],
        products: [{ productId: "waiting", hiddenAt: hiddenTee.hiddenAt, revealAt: null, revealedAt: null }],
        outcome: "removed",
      })
    )
    vi.stubGlobal("fetch", request)
    render(
      <FeaturedOrderList
        products={[...products, { ...hiddenTee, revealAt: slots[0]!.value }]}
        now={now}
        schedule={{ entries: [entry], slots }}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: "Scheduled actions for Waiting for the Weekend" }))
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove from this week" }))
    await waitFor(() => expect(scheduledWeek(0).queryByRole("list")).not.toBeInTheDocument())
    expect(hiddenOrder()).toEqual(["Waiting for the Weekend"])
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Actions for Waiting for the Weekend" })).toHaveFocus()
    )
    expect(screen.getByText("Never shown")).toBeInTheDocument()
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "/api/admin/product-schedule",
      expect.objectContaining({ method: "DELETE", body: JSON.stringify({ productId: "waiting" }) })
    )
    expect(savedOrders(request)).toEqual([])
  })

  it("keeps the current feature and reveals it when removal reaches the server at its deadline", async () => {
    const entry = { id: "entry-waiting", productId: "waiting", liveAt: slots[0]!.value }
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          scheduleResponse(["waiting"], entry.liveAt, { now: Date.parse(entry.liveAt), outcome: "current" })
        )
    )
    render(
      <FeaturedOrderList
        products={[...products, { ...hiddenTee, revealAt: entry.liveAt }]}
        now={Date.parse(entry.liveAt) - 1}
        schedule={{ entries: [entry], slots }}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: "Scheduled actions for Waiting for the Weekend" }))
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove from this week" }))
    expect(await screen.findByText("That week has started; the product stays featured.")).toBeVisible()
    const currentWeek = within(screen.getByRole("list", { name: "Design of the Week products" }))
    expect(currentWeek.getAllByRole("listitem")).toHaveLength(1)
    expect(currentWeek.getByRole("link", { name: "View in shop: Waiting for the Weekend" })).toHaveAttribute(
      "href",
      "/shop/waiting"
    )
    // The reveal is its arrival, so it goes up new.
    expect(badgedIn("Design of the Week products")).toEqual(["Waiting for the Weekend"])
    expect(hiddenOrder()).toEqual([])
    expect(screen.queryByRole("region", { name: `Week of ${slots[0]!.label}` })).not.toBeInTheDocument()
    expect(screen.getAllByRole("region", { name: /^Week of / })).toHaveLength(6)
    expect(screen.queryByText(/was removed from the schedule/)).not.toBeInTheDocument()
    await waitFor(() =>
      expect(currentWeek.getByRole("button", { name: "Actions for Waiting for the Weekend" })).toHaveFocus()
    )
  })

  it("keeps a just-revealed product in the shop and featured when its next week is scheduled", async () => {
    const current = { id: "current-waiting", productId: "waiting", liveAt: slots[0]!.value }
    const future = { id: "future-waiting", productId: "waiting", liveAt: slots[1]!.value }
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        scheduleResponse(["waiting"], current.liveAt, {
          entries: [current, future],
          now: Date.parse(current.liveAt),
        })
      )
    )
    render(
      <FeaturedOrderList
        products={[...products, { ...hiddenTee, revealAt: current.liveAt }]}
        now={Date.parse(current.liveAt) - 1}
        schedule={{ entries: [current], slots }}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: "Scheduled actions for Waiting for the Weekend" }))
    await userEvent.click(await screen.findByRole("menuitem", { name: "Change week" }))
    const dialog = within(await screen.findByRole("dialog", { name: "Change featured week" }))
    await userEvent.selectOptions(dialog.getByRole("combobox", { name: "Featured week" }), future.liveAt)
    await userEvent.click(dialog.getByRole("button", { name: "Save featured week" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    const currentWeek = within(screen.getByRole("list", { name: "Design of the Week products" }))
    expect(currentWeek.getByRole("link", { name: "View in shop: Waiting for the Weekend" })).toHaveAttribute(
      "href",
      "/shop/waiting"
    )
    const futureWeek = within(screen.getByRole("region", { name: "Week of Friday, October 2" }))
    expect(futureWeek.getAllByRole("listitem")).toHaveLength(1)
    expect(futureWeek.getByText("Already in the shop")).toBeVisible()
    expect(hiddenOrder()).toEqual([])
    expect(screen.getAllByRole("region", { name: /^Week of / })).toHaveLength(6)
    await waitFor(() =>
      expect(futureWeek.getByRole("button", { name: "Scheduled actions for Waiting for the Weekend" })).toHaveFocus()
    )
  })

  it("preserves a future featured week through Show and Hide actions", async () => {
    const entry = { id: "entry-waiting", productId: "waiting", liveAt: slots[0]!.value }
    const request = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal("fetch", request)
    render(
      <FeaturedOrderList
        products={[...products, { ...hiddenTee, revealAt: slots[0]!.value }]}
        now={now}
        schedule={{ entries: [entry], slots }}
      />
    )
    await chooseAction(hiddenTee.title, "Show in shop")
    expect(order()).toEqual(["Everyday Type", "Send It", "Studio Lines", hiddenTee.title])
    expect(scheduledWeek(0).getAllByRole("listitem")).toHaveLength(1)
    await chooseAction(hiddenTee.title, "Hide from shop")
    expect(hiddenOrder()).toEqual([hiddenTee.title])
    expect(scheduledWeek(0).getAllByRole("listitem")).toHaveLength(1)
    expect(request.mock.calls.every(([url]) => String(url).endsWith("/visibility"))).toBe(true)
  })

  it("uses the confirmed visibility state when a garment edit prevents a scheduled reveal", async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        productId: "everyday-type",
        hidden: true,
        hiddenAt: "2026-09-20T12:00:00.000Z",
        revealAt: null,
        revealedAt: shown.revealedAt,
        addedToShopAt: shown.addedToShopAt,
      }),
    })
    vi.stubGlobal("fetch", request)
    render(
      <FeaturedOrderList
        products={products}
        now={now}
        schedule={{
          entries: [{ id: "entry-everyday-type", productId: "everyday-type", liveAt: slots[0]!.value }],
          slots,
        }}
      />
    )
    await chooseAction("Everyday Type", "Hide from shop")
    await waitFor(() => expect(hiddenOrder()).toEqual(["Everyday Type"]))
    expect(scheduledWeek(0).getByText("Hidden · Show or reschedule to reveal")).toBeVisible()
    expect(scheduledWeek(0).queryByText("Hidden until this week")).not.toBeInTheDocument()
  })

  it("filters the product chooser and blocks duplicates and unfinished garments", async () => {
    render(
      <FeaturedOrderList
        products={[
          ...scheduleProducts,
          {
            ...hiddenTee,
            id: "unfinished",
            title: "Unfinished Garment",
            garmentSetup: { blueprintId: 999, label: null },
          },
        ]}
        now={now}
        schedule={{
          entries: [{ id: "entry-everyday-type", productId: "everyday-type", liveAt: slots[0]!.value }],
          slots,
        }}
      />
    )
    const dialog = await openWeek(0)
    expect(dialog.getByRole("checkbox", { name: /Everyday Type/ })).toBeDisabled()
    expect(dialog.getByRole("checkbox", { name: /Everyday Type/ })).toBeChecked()
    expect(dialog.getByRole("checkbox", { name: /Unfinished Garment/ })).toBeDisabled()
    await userEvent.type(dialog.getByRole("textbox", { name: "Search products" }), "waiting")
    expect(dialog.getAllByRole("checkbox")).toHaveLength(1)
    await userEvent.clear(dialog.getByRole("textbox", { name: "Search products" }))
    await userEvent.type(dialog.getByRole("textbox", { name: "Search products" }), "not a tee")
    expect(dialog.getByText("No products match that name.")).toBeVisible()
  })

  it.each([
    [
      "refused",
      () =>
        Promise.resolve({
          ok: false,
          status: 409,
          json: async () => ({ error: "This product was unpublished. Reload products." }),
        }),
      "This product was unpublished",
    ],
    ["uncertain", () => Promise.reject(new TypeError("connection lost")), "could not be confirmed"],
    [
      "unreadable confirmation",
      () => Promise.resolve({ ok: true, status: 200, json: async () => ({}) }),
      "confirmation could not be read",
    ],
  ])("keeps the chooser and previous schedule after an %s save", async (_label, response, message) => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(response))
    render(<FeaturedOrderList products={scheduleProducts} now={now} schedule={{ entries: [], slots }} />)
    await chooseAction(hiddenTee.title, "Add to Design of the week")
    const dialog = within(await screen.findByRole("dialog", { name: "Add to Design of the week" }))
    await userEvent.click(dialog.getByRole("button", { name: "Save featured week" }))
    expect(await dialog.findByRole("alert")).toHaveTextContent(message)
    await userEvent.click(dialog.getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(scheduledWeek(0).queryByRole("list")).not.toBeInTheDocument()
    expect(hiddenOrder()).toEqual([hiddenTee.title])
    expect(screen.queryByText("Changes saved.")).not.toBeInTheDocument()
  })

  it("prevents duplicate submission and closing while a schedule save is pending", async () => {
    const pending = Promise.withResolvers<ReturnType<typeof scheduleResponse>>()
    const request = vi.fn().mockReturnValue(pending.promise)
    vi.stubGlobal("fetch", request)
    render(<FeaturedOrderList products={scheduleProducts} now={now} schedule={{ entries: [], slots }} />)
    await chooseAction(hiddenTee.title, "Add to Design of the week")
    const dialog = within(await screen.findByRole("dialog", { name: "Add to Design of the week" }))
    await userEvent.click(dialog.getByRole("button", { name: "Save featured week" }))
    expect(dialog.getByRole("button", { name: "Saving…" })).toBeDisabled()
    expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled()
    await userEvent.keyboard("{Escape}")
    expect(screen.getByRole("dialog")).toBeVisible()
    expect(request).toHaveBeenCalledOnce()
    pending.resolve(scheduleResponse(["waiting"], slots[0]!.value))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("blocks scheduling a product while its visibility request is still pending", async () => {
    const pendingVisibility = Promise.withResolvers<{ ok: boolean; status: number; json: () => Promise<object> }>()
    const request = vi.fn().mockReturnValue(pendingVisibility.promise)
    vi.stubGlobal("fetch", request)
    render(<FeaturedOrderList products={scheduleProducts} now={now} schedule={{ entries: [], slots }} />)
    await chooseAction("Everyday Type", "Hide from shop")
    const dialog = await openWeek(0)
    expect(dialog.getByRole("checkbox", { name: /Everyday Type/ })).toBeDisabled()
    expect(dialog.getByRole("checkbox", { name: /Waiting for the Weekend/ })).toBeEnabled()
    expect(request).toHaveBeenCalledOnce()
    await userEvent.click(dialog.getByRole("button", { name: "Cancel" }))
    pendingVisibility.resolve({ ok: true, status: 200, json: async () => ({}) })
    await waitFor(() => expect(screen.getByRole("button", { name: "Actions for Everyday Type" })).toBeEnabled())
  })

  it("keeps a successful schedule and an in-flight reorder without refreshing away either change", async () => {
    const pendingOrder = Promise.withResolvers<{ ok: boolean; status: number; json: () => Promise<object> }>()
    const request = vi.fn((url: string) =>
      url.endsWith("/featured-order")
        ? pendingOrder.promise
        : Promise.resolve(scheduleResponse(["waiting"], slots[0]!.value))
    )
    vi.stubGlobal("fetch", request)
    render(<FeaturedOrderList products={scheduleProducts} now={now} schedule={{ entries: [], slots }} />)
    await chooseAction("Everyday Type", "Move down in shop")
    await chooseAction(hiddenTee.title, "Add to Design of the week")
    const dialog = within(await screen.findByRole("dialog", { name: "Add to Design of the week" }))
    await userEvent.click(dialog.getByRole("button", { name: "Save featured week" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(order()).toEqual(["Send It", "Everyday Type", "Studio Lines"])
    expect(scheduledWeek(0).getAllByRole("listitem")).toHaveLength(1)
    expect(refresh).not.toHaveBeenCalled()
    pendingOrder.resolve({ ok: true, status: 200, json: async () => ({}) })
    await waitFor(() => expect(screen.getByText("Changes saved.")).toBeVisible())
    expect(order()).toEqual(["Send It", "Everyday Type", "Studio Lines"])
    expect(hiddenOrder()).toEqual([hiddenTee.title])
  })

  it("keeps an existing release outside the six offered weeks manageable", async () => {
    const outsideRangeDate = "2026-11-02T10:00:00.000Z"
    const request = vi.fn().mockResolvedValue(scheduleResponse(["waiting"], slots[0]!.value))
    vi.stubGlobal("fetch", request)
    render(
      <FeaturedOrderList
        products={scheduleProducts}
        now={now}
        schedule={{ entries: [{ id: "outside-range", productId: "waiting", liveAt: outsideRangeDate }], slots }}
      />
    )
    expect(screen.getByRole("heading", { name: "Other scheduled dates" })).toBeVisible()
    const outsideRangeWeek = within(screen.getByRole("region", { name: /Week of November 2, 2026/ }))
    expect(outsideRangeWeek.getAllByRole("listitem")).toHaveLength(1)
    expect(outsideRangeWeek.queryByRole("button", { name: /Add products/ })).not.toBeInTheDocument()
    await userEvent.click(
      outsideRangeWeek.getByRole("button", { name: "Scheduled actions for Waiting for the Weekend" })
    )
    await userEvent.click(await screen.findByRole("menuitem", { name: "Change week" }))
    const dialog = within(await screen.findByRole("dialog", { name: "Change featured week" }))
    expect(dialog.getByRole("combobox", { name: "Featured week" })).toHaveValue(slots[0]!.value)
    await userEvent.click(dialog.getByRole("button", { name: "Save featured week" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(screen.queryByRole("heading", { name: "Other scheduled dates" })).not.toBeInTheDocument()
    expect(scheduledWeek(0).getAllByRole("listitem")).toHaveLength(1)
  })

  it("retains the scheduled row after an uncertain removal and offers a reload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("connection lost")))
    render(
      <FeaturedOrderList
        products={scheduleProducts}
        now={now}
        schedule={{ entries: [{ id: "entry-waiting", productId: "waiting", liveAt: slots[0]!.value }], slots }}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: "Scheduled actions for Waiting for the Weekend" }))
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove from this week" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be confirmed")
    expect(scheduledWeek(0).getAllByRole("listitem")).toHaveLength(1)
    await userEvent.click(screen.getByRole("button", { name: "Reload products" }))
    expect(refresh).toHaveBeenCalledOnce()
  })
})
