import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AddGarmentForm } from "./add-garment-form"
import type { ShopCategory } from "./garment-catalog"

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  // clearAllMocks keeps a queued mockImplementationOnce. A test that fails before it calls refresh
  // would hand its never-settling promise to the next one, and one real failure would read as many.
  refresh.mockReset()
})

const categories: ShopCategory[] = [{ slug: "crop-tops", name: "Crop tops", garmentCount: 0 }]
const label = "Printify catalog link or blueprint number"

async function add(text: string) {
  const input = screen.getByLabelText(label)
  await userEvent.clear(input)
  // paste, not type: user-event reads "[" and "{" in typed text as key descriptors.
  if (text) {
    input.focus()
    await userEvent.paste(text)
  }
  await userEvent.click(screen.getByRole("button", { name: "Add garment" }))
}

describe("AddGarmentForm", () => {
  // Each refusal is decided on the page. A link that is refused must cost no request at all, and
  // what was pasted is the owner's clipboard: it is never echoed back into the page.
  it.each([
    ["", "Paste a Printify catalog link, or type a blueprint number."],
    ["   ", "Paste a Printify catalog link, or type a blueprint number."],
    [
      "https://printify.com/app/product-details/111111000000000000000006",
      "That link is one of your products, not a garment in Printify's catalog.",
    ],
    ["https://printify.com.attacker.test/app/products/1317", "That is not a Printify catalog link."],
    ["http://printify.com/app/products/1317", "That is not a Printify catalog link."],
    ["https://printify.com/app/editor/1317", "That Printify page is not a garment's catalog page."],
    ["https://printify.com/app/products/01317", "A blueprint number is a whole number such as 1317."],
    ["1317abc", "A blueprint number is a whole number such as 1317."],
  ])("refuses %j with its own reason and no request", async (text, message) => {
    const request = vi.fn()
    vi.stubGlobal("fetch", request)
    render(<AddGarmentForm categories={categories} listedBlueprintIds={[]} />)
    await add(text)
    const input = screen.getByLabelText(label)
    expect(screen.getByRole("alert")).toHaveTextContent(message)
    expect(input).toBeInvalid()
    expect(input).toHaveAccessibleDescription(new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    expect(input).toHaveFocus()
    expect(screen.queryByRole("heading", { name: /^Set up blueprint/ })).not.toBeInTheDocument()
    expect(request).not.toHaveBeenCalled()
    if (text.trim()) expect(document.body.textContent).not.toContain(text.trim())
  })

  it.each([
    ["1312", 1312],
    ["https://printify.com/app/products/1312/next-level/womens-ideal-crop-top?utm=x#details", 1312],
    ["www.printify.com/app/products/6/", 6],
  ])("reads the blueprint number out of %j and opens its setup with focus on it", async (text, blueprintId) => {
    vi.stubGlobal("fetch", vi.fn())
    render(<AddGarmentForm categories={categories} listedBlueprintIds={[1317]} />)
    await add(text)
    expect(screen.getByRole("heading", { name: `Set up blueprint ${blueprintId}` })).toHaveFocus()
    expect(screen.getByRole("form", { name: `Blueprint ${blueprintId} setup` })).toBeVisible()
    expect(screen.getByLabelText(label)).toHaveValue("")
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    // Parsing is local. Nothing is asked of anyone until the owner presses a button in the form.
    expect(fetch).not.toHaveBeenCalled()
  })

  // The pasted address must never reach a request: only the integer read out of it may travel.
  it("sends only the number when the revealed form looks the name up and saves", async () => {
    const pasted = "https://printify.com/app/products/1312/next-level/womens-ideal-crop-top?secret=abc"
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ blueprintId: 1312, title: "Crop Top", manufacturer: "Next Level", model: "5080" }),
      })
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ blueprintId: 1312 }) })
    vi.stubGlobal("fetch", request)
    render(<AddGarmentForm categories={categories} listedBlueprintIds={[]} />)
    await add(pasted)
    await userEvent.click(screen.getByRole("button", { name: /^Look up name from Printify/ }))
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("5080"))
    await userEvent.click(screen.getByRole("button", { name: /^Save garment/ }))
    expect(await screen.findByText("Saved.")).toBeVisible()

    expect(request.mock.calls.map(([url]) => url)).toEqual([
      "/api/admin/products/garments/1312/catalog",
      "/api/admin/products/garments/1312",
    ])
    expect(JSON.stringify(request.mock.calls)).not.toMatch(/printify\.com|secret|womens-ideal/)
    expect(JSON.parse(String((request.mock.calls[1]?.[1] as RequestInit).body))).toEqual({
      manufacturer: "Next Level",
      model: "5080",
      categorySlug: null,
      googleProductCategory: null,
      gender: null,
      ageGroup: null,
      sizeSystem: null,
    })
    // Saved, so there is nothing left to cancel.
    expect(screen.getByRole("button", { name: "Close" })).toBeVisible()
  })

  // Two forms for one garment would share every id on the page and race each other's saves.
  it("moves focus to a garment that is already listed instead of opening a second form", async () => {
    vi.stubGlobal("fetch", vi.fn())
    render(
      <>
        <ul>
          <li id="garment-1317" tabIndex={-1}>
            Next Level 6210
          </li>
        </ul>
        <AddGarmentForm categories={categories} listedBlueprintIds={[1317]} />
      </>
    )
    await add("https://printify.com/app/products/1317/next-level/unisex-cvc-jersey-t-shirt")
    expect(document.getElementById("garment-1317")).toHaveFocus()
    expect(screen.getByRole("status")).toHaveTextContent("Blueprint 1317 is already listed above.")
    expect(screen.queryByRole("heading", { name: /^Set up blueprint/ })).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("starts a second number from empty fields rather than the first one's typing", async () => {
    render(<AddGarmentForm categories={categories} listedBlueprintIds={[]} />)
    await add("1312")
    await userEvent.type(screen.getByLabelText("Manufacturer"), "Next Level")
    await add("77")
    expect(screen.getByRole("heading", { name: "Set up blueprint 77" })).toHaveFocus()
    expect(screen.getByLabelText("Manufacturer")).toHaveValue("")
  })

  it("puts focus back in the field when the owner cancels", async () => {
    render(<AddGarmentForm categories={categories} listedBlueprintIds={[]} />)
    await add("1312")
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(screen.queryByRole("heading", { name: /^Set up blueprint/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText(label)).toHaveFocus()
  })

  // The first save ends with this form stepping aside for the list's own card, so anything typed
  // into it after the press would go with it. The revealed form holds its fields until then.
  it("takes no typing in the revealed form between the press of Save and the garment being listed", async () => {
    let answerSave!: (value: unknown) => void
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise((resolve) => (answerSave = resolve)))
    )
    let finishRefresh!: () => void
    // Stands in for the transition Next holds open until the refreshed tree has committed.
    refresh.mockImplementationOnce(() => new Promise<void>((resolve) => (finishRefresh = resolve)))
    const view = render(<AddGarmentForm categories={categories} listedBlueprintIds={[]} />)
    const user = userEvent.setup()
    await add("1312")
    await user.type(screen.getByLabelText("Manufacturer"), "Next Level")
    await user.type(screen.getByLabelText("Model"), "5080{Enter}")

    await user.type(screen.getByLabelText("Model"), "-typo")
    expect(screen.getByLabelText("Model")).toHaveValue("5080")
    expect(screen.getByLabelText("Model")).toBeDisabled()
    answerSave({ ok: true, status: 200, json: async () => ({ blueprintId: 1312 }) })
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    await user.type(screen.getByLabelText("Model"), "-typo")
    expect(screen.getByLabelText("Model")).toHaveValue("5080")
    expect(screen.getByLabelText("Model")).toBeDisabled()

    await act(async () => {
      view.rerender(<AddGarmentForm categories={categories} listedBlueprintIds={[1312]} />)
      finishRefresh()
    })
    expect(screen.queryByLabelText("Model")).not.toBeInTheDocument()
  })

  // After the first save the refreshed page lists the garment. The draft has to step aside in that
  // same render (two forms would share ids) and take the owner along to where the garment now lives.
  it("hands a saved garment over to the list and follows it there", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ blueprintId: 1312 }) })
    )
    const page = (listed: number[]) => (
      <>
        <ul>
          {listed.map((id) => (
            <li key={id} id={`garment-${id}`} tabIndex={-1}>
              Blueprint {id}
            </li>
          ))}
        </ul>
        <AddGarmentForm categories={categories} listedBlueprintIds={listed} />
      </>
    )
    const view = render(page([]))
    await add("1312")
    await userEvent.type(screen.getByLabelText("Manufacturer"), "Next Level")
    await userEvent.type(screen.getByLabelText("Model"), "5080")
    screen.getByRole("button", { name: /^Save garment/ }).focus()
    await userEvent.setup().keyboard("{Enter}")
    await screen.findByText("Saved.")

    view.rerender(page([1312]))
    expect(screen.queryByRole("heading", { name: "Set up blueprint 1312" })).not.toBeInTheDocument()
    expect(within(view.container).queryByLabelText("Manufacturer")).not.toBeInTheDocument()
    await waitFor(() => expect(document.getElementById("garment-1312")).toHaveFocus())
  })
})
