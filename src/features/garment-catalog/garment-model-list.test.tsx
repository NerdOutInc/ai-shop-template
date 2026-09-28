import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { AdminGarment, ShopCategory } from "./garment-catalog"
import { GarmentModelList } from "./garment-model-list"

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  // clearAllMocks keeps a queued mockImplementationOnce. A test that fails before it calls refresh
  // would hand its never-settling promise to the next one, and one real failure would read as many.
  refresh.mockReset()
  window.location.hash = ""
})

const categories: ShopCategory[] = [{ slug: "t-shirts", name: "T-shirts", garmentCount: 1 }]
const filled = {
  manufacturer: "Next Level",
  model: "6210",
  categorySlug: "t-shirts",
  googleProductCategory: 212,
  gender: "unisex",
  ageGroup: "adult",
  sizeSystem: "US",
} as const
const tee: AdminGarment = {
  blueprintId: 1317,
  known: true,
  complete: true,
  ...filled,
  productCount: 24,
  shownCount: 22,
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

function cards(label: string) {
  return within(screen.getByRole("list", { name: label }))
    .getAllByRole("listitem")
    .map((item) => item.id)
}

describe("GarmentModelList", () => {
  it("puts garments that need setup ahead of the ready ones", () => {
    render(<GarmentModelList categories={categories} garments={[tee, found]} productsWithoutBlueprint={0} />)
    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)
    expect(headings).toEqual(["Needs setup", "Ready"])
    expect(cards("Garments that need setup")).toEqual(["garment-9999"])
    expect(cards("Ready garments")).toEqual(["garment-1317"])
  })

  // `complete` is commerce.garment_models.complete. A page that worked it out again from the fields
  // could disagree with the gate that refuses to show the product, and the owner would chase a ghost.
  it("groups by the database's answer even when every field looks filled in", () => {
    render(
      <GarmentModelList categories={categories} garments={[{ ...tee, complete: false }]} productsWithoutBlueprint={0} />
    )
    expect(cards("Garments that need setup")).toEqual(["garment-1317"])
    expect(within(document.getElementById("garment-1317")!).getByText("Needs setup")).toBeVisible()
    expect(screen.getByText("No garment is ready yet. Finish one above and it moves down here.")).toBeVisible()
  })

  it("labels a blueprint nobody has set up with what was found on it", () => {
    render(<GarmentModelList categories={categories} garments={[found]} productsWithoutBlueprint={0} />)
    const card = within(document.getElementById("garment-9999")!)
    expect(card.getByRole("heading", { level: 3, name: "Blueprint 9999" })).toBeVisible()
    expect(card.getByText(/Found on 3 published products, 2 shown; not set up yet/)).toBeVisible()
  })

  it("counts a single found product in the singular, and says nothing of the kind for a garment with a row", () => {
    render(
      <GarmentModelList
        categories={categories}
        garments={[{ ...found, productCount: 1, shownCount: 1 }, tee]}
        productsWithoutBlueprint={0}
      />
    )
    expect(screen.getByText(/Found on 1 published product, 1 shown; not set up yet/)).toBeVisible()
    expect(within(document.getElementById("garment-1317")!).queryByText(/Found on/)).not.toBeInTheDocument()
  })

  // The count includes products already in the shop, which stay there, so the refusal is worded
  // for the hidden ones only.
  it.each([
    [
      1,
      "1 published product names no Printify blueprint in its saved details, so no garment can be matched to it. Once hidden, it cannot be shown or scheduled. Publishing it again from Printify refreshes those details.",
    ],
    [
      4,
      "4 published products name no Printify blueprint in their saved details, so no garment can be matched to them. Once hidden, they cannot be shown or scheduled. Publishing them again from Printify refreshes those details.",
    ],
  ])("explains %i published products that name no blueprint", (count, message) => {
    render(<GarmentModelList categories={categories} garments={[tee]} productsWithoutBlueprint={count} />)
    expect(screen.getByText(message)).toBeVisible()
  })

  it("stays quiet about blueprints when every product names one, and about setup when nothing waits", () => {
    render(<GarmentModelList categories={categories} garments={[tee]} productsWithoutBlueprint={0} />)
    expect(screen.queryByText(/names? no Printify blueprint/)).not.toBeInTheDocument()
    expect(screen.getByText(/^Nothing is waiting on setup\./)).toBeVisible()
  })

  // A product row links here as #garment-9999. The browser scrolls to it but leaves focus at the
  // top, so a keyboard user would have to Tab past every other garment's form to reach this one.
  it("moves focus to the card a product row linked to", () => {
    window.location.hash = "#garment-9999"
    render(<GarmentModelList categories={categories} garments={[tee, found]} productsWithoutBlueprint={0} />)
    const card = document.getElementById("garment-9999")!
    expect(card).toHaveFocus()
    expect(card).toHaveAttribute("tabindex", "-1")
    expect(card).toHaveAccessibleName("Blueprint 9999 Needs setup")
  })

  it.each(["#garment-1317abc", "#add-garment-heading", "#garment-0", "#"])("ignores the fragment %j", (hash) => {
    window.location.hash = hash
    render(
      <>
        <h2 id="add-garment-heading" tabIndex={-1}>
          Add a garment
        </h2>
        <GarmentModelList categories={categories} garments={[tee]} productsWithoutBlueprint={0} />
      </>
    )
    expect(document.body).toHaveFocus()
  })

  // Completing a garment moves its card to the other list, which remounts it and drops focus.
  it("follows a saved garment into the Ready list once the server says it is complete", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ blueprintId: 9999 }) })
    )
    const named = { ...found, known: true, ...filled, model: "5080" }
    const view = render(<GarmentModelList categories={categories} garments={[named]} productsWithoutBlueprint={0} />)
    const save = screen.getByRole("button", { name: "Save garment: Next Level 5080" })
    save.focus()
    await userEvent.setup().keyboard("{Enter}")
    await screen.findByText("Saved.")
    expect(refresh).toHaveBeenCalledOnce()

    // What router.refresh() delivers: the same garment, now complete by the database's account.
    view.rerender(
      <GarmentModelList
        categories={categories}
        garments={[{ ...named, complete: true }]}
        productsWithoutBlueprint={0}
      />
    )
    expect(cards("Ready garments")).toEqual(["garment-9999"])
    await waitFor(() => expect(document.getElementById("garment-9999")).toHaveFocus())
    expect(document.getElementById("garment-9999")).toHaveAccessibleName("Next Level 5080 Ready")
  })

  // The save and the refresh it asks for both take a moment, and the refresh moves the card to the
  // other list, which remounts its form from what was saved. Anything the page let the owner type
  // in that window would vanish without a word, so whatever a field accepts has to survive the move.
  it("loses nothing the owner was allowed to type while a save that regroups the card is in flight", async () => {
    let answerSave!: (value: unknown) => void
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise((resolve) => (answerSave = resolve)))
    )
    let finishRefresh!: () => void
    // Stands in for the transition Next holds open until the refreshed tree has committed.
    refresh.mockImplementationOnce(() => new Promise<void>((resolve) => (finishRefresh = resolve)))
    const original = { ...found, known: true, ...filled, model: "Original", sizeSystem: null }
    const view = render(<GarmentModelList categories={categories} garments={[original]} productsWithoutBlueprint={0} />)
    const user = userEvent.setup()
    const model = () => screen.getByLabelText("Model")
    // Typed over the whole value, the way an owner fixing a typo would. (clear() refuses to try on a
    // held field, and whether the field is held is exactly what is being asked.)
    const correct = () =>
      user.type(model(), "Corrected", { initialSelectionStart: 0, initialSelectionEnd: "Original".length })

    // The final missing field, then Save by keyboard.
    await user.selectOptions(screen.getByLabelText("Size system"), "US")
    screen.getByRole("button", { name: "Save garment: Next Level Original" }).focus()
    await user.keyboard("{Enter}")
    expect(await screen.findByRole("button", { name: /^Saving…/ })).toBeDisabled()

    // While the request waits.
    await correct()
    expect(model()).toHaveValue("Original")
    expect(model()).toBeDisabled()
    expect(screen.getByLabelText("Size system")).toBeDisabled()
    expect(screen.getByRole("form", { name: "Next Level Original setup" })).toHaveAttribute("aria-busy", "true")

    // The server has the save, but the refreshed list has not rendered yet.
    answerSave({ ok: true, status: 200, json: async () => ({ blueprintId: 9999 }) })
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    await correct()
    expect(model()).toHaveValue("Original")
    expect(model()).toBeDisabled()
    expect(screen.getByRole("status")).toHaveTextContent("Saved. Updating the list…")

    const accepted = (model() as HTMLInputElement).value
    await act(async () => {
      view.rerender(
        <GarmentModelList
          categories={categories}
          garments={[{ ...original, sizeSystem: "US", complete: true }]}
          productsWithoutBlueprint={0}
        />
      )
      finishRefresh()
    })
    expect(cards("Ready garments")).toEqual(["garment-9999"])
    expect(model()).toHaveValue(accepted)
    await waitFor(() => expect(model()).toBeEnabled())
    // The card changed lists, so focus follows it rather than falling to the top of the page.
    await waitFor(() => expect(document.getElementById("garment-9999")).toHaveFocus())
  })

  it("does not pull focus anywhere when a refresh arrives without a save", () => {
    const view = render(<GarmentModelList categories={categories} garments={[found]} productsWithoutBlueprint={0} />)
    view.rerender(<GarmentModelList categories={categories} garments={[{ ...found }]} productsWithoutBlueprint={0} />)
    expect(document.body).toHaveFocus()
  })
})
