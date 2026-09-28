import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { AdminGarment, ShopCategory } from "./garment-catalog"
import { GarmentModelForm } from "./garment-model-form"

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  // clearAllMocks keeps a queued mockImplementationOnce. A test that fails before it calls refresh
  // would hand its never-settling promise to the next one, and one real failure would read as many.
  refresh.mockReset()
})

const categories: ShopCategory[] = [
  { slug: "t-shirts", name: "T-shirts", garmentCount: 1 },
  { slug: "crop-tops", name: "Crop tops", garmentCount: 0 },
]
const unknown: AdminGarment = {
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

function answer(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function sentBody(request: ReturnType<typeof vi.fn>, call = 0) {
  return JSON.parse(String((request.mock.calls[call]?.[1] as RequestInit).body)) as unknown
}

// A browser takes focus off a control the moment it is disabled. jsdom leaves it there and will not
// even blur() it, so the tests that prove focus is handed back do the browser's part by hand.
function dropFocusAsABrowserWould() {
  const elsewhere = document.createElement("button")
  document.body.append(elsewhere)
  elsewhere.focus()
  elsewhere.remove()
  expect(document.body).toHaveFocus()
}

describe("GarmentModelForm", () => {
  it("shows what the garment already has and how many products ride on it", () => {
    render(<GarmentModelForm garment={ready} categories={categories} />)
    const form = within(screen.getByRole("form", { name: "Next Level 6210 setup" }))
    expect(form.getByLabelText("Manufacturer")).toHaveValue("Next Level")
    expect(form.getByLabelText("Model")).toHaveValue("6210")
    expect(form.getByLabelText("Shop category")).toHaveValue("t-shirts")
    expect(form.getByLabelText("Google product category")).toHaveValue("212")
    expect(form.getByLabelText("Gender")).toHaveValue("unisex")
    expect(form.getByLabelText("Age group")).toHaveValue("adult")
    expect(form.getByLabelText("Size system")).toHaveValue("US")
    expect(form.getByText("24 published products, 22 shown, 1 scheduled.")).toBeVisible()
    // Clearing is the one change the server refuses while these are on the wall, so say so up front.
    expect(form.getByText(/23 products on this garment are in the shop or scheduled/)).toBeVisible()
  })

  // A page holds one form per garment, and a repeated id breaks every label on it.
  it("scopes every id to its blueprint so two forms can share a page", () => {
    render(
      <>
        <GarmentModelForm garment={ready} categories={categories} />
        <GarmentModelForm garment={unknown} categories={categories} />
      </>
    )
    const ids = Array.from(document.querySelectorAll("[id]"), (element) => element.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain("garment-1317-manufacturer")
    expect(ids).toContain("garment-9999-manufacturer")
  })

  it("saves exactly the setup the route accepts, with null for whatever is not chosen yet", async () => {
    const request = vi.fn().mockResolvedValue(answer(200, { blueprintId: 9999 }))
    vi.stubGlobal("fetch", request)
    const onSaved = vi.fn()
    render(<GarmentModelForm garment={unknown} categories={categories} onSaved={onSaved} />)
    await userEvent.type(screen.getByLabelText("Manufacturer"), "  Bella+Canvas ")
    await userEvent.type(screen.getByLabelText("Model"), "3001")
    await userEvent.selectOptions(screen.getByLabelText("Shop category"), "crop-tops")
    await userEvent.type(screen.getByLabelText("Google product category"), "212")
    await userEvent.selectOptions(screen.getByLabelText("Gender"), "female")
    await userEvent.click(screen.getByRole("button", { name: "Save garment: Blueprint 9999" }))

    expect(request).toHaveBeenCalledExactlyOnceWith(
      "/api/admin/products/garments/9999",
      expect.objectContaining({ method: "PUT", credentials: "same-origin" })
    )
    // The strict schema refuses an omitted key, a string number and any extra key such as `complete`.
    expect(sentBody(request)).toEqual({
      manufacturer: "Bella+Canvas",
      model: "3001",
      categorySlug: "crop-tops",
      googleProductCategory: 212,
      gender: "female",
      ageGroup: null,
      sizeSystem: null,
    })
    expect(await screen.findByText("Saved.")).toBeVisible()
    expect(onSaved).toHaveBeenCalledExactlyOnceWith(9999)
    // Whether that made it complete is the database's answer, so the page asks again.
    expect(refresh).toHaveBeenCalledOnce()
  })

  it("sends nothing until the garment has both names, and lands on the one that is missing", async () => {
    const request = vi.fn()
    vi.stubGlobal("fetch", request)
    render(<GarmentModelForm garment={unknown} categories={categories} />)
    await userEvent.type(screen.getByLabelText("Manufacturer"), "Next Level")
    await userEvent.click(screen.getByRole("button", { name: /^Save garment/ }))
    expect(screen.getByText("Enter the model, such as 6210.")).toBeVisible()
    expect(screen.getByLabelText("Model")).toHaveFocus()
    expect(screen.getByLabelText("Model")).toHaveAccessibleDescription("Enter the model, such as 6210.")
    expect(screen.queryByText(/^Enter the manufacturer/)).not.toBeInTheDocument()
    expect(request).not.toHaveBeenCalled()
  })

  // The route wants a JSON integer from 1 to 999999; a near miss would come back as a vague 400.
  it.each(["21.5", "abc", "0", "-212", "1e3"])(
    "refuses %j as a Google product category without a request",
    async (value) => {
      const request = vi.fn()
      vi.stubGlobal("fetch", request)
      render(<GarmentModelForm garment={ready} categories={categories} />)
      const taxonomy = screen.getByLabelText("Google product category")
      await userEvent.clear(taxonomy)
      await userEvent.type(taxonomy, value)
      await userEvent.click(screen.getByRole("button", { name: /^Save garment/ }))
      expect(screen.getByText("Use the number from Google's product category list, such as 212.")).toBeVisible()
      expect(taxonomy).toHaveFocus()
      expect(request).not.toHaveBeenCalled()
    }
  )

  // The refusal counts the products in the way and says what to do first; a paraphrase would not.
  it("shows the server's refusal as written when a garment in use would be cleared", async () => {
    const refusal = "23 products on this garment are in the shop or scheduled. Hide them before clearing its setup."
    const request = vi.fn().mockResolvedValue(answer(409, { error: refusal, products: 23 }))
    vi.stubGlobal("fetch", request)
    const onSaved = vi.fn()
    render(<GarmentModelForm garment={ready} categories={categories} onSaved={onSaved} />)
    await userEvent.selectOptions(screen.getByLabelText("Shop category"), "")
    await userEvent.click(screen.getByRole("button", { name: /^Save garment/ }))
    expect(sentBody(request)).toMatchObject({ categorySlug: null })
    expect(await screen.findByRole("alert")).toHaveTextContent(refusal)
    expect(screen.queryByText("Saved.")).not.toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it("offers fresh options when the chosen category was deleted somewhere else", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(answer(404, { error: "That category no longer exists. Reload and choose another." }))
    )
    render(<GarmentModelForm garment={ready} categories={categories} />)
    await userEvent.click(screen.getByRole("button", { name: /^Save garment/ }))
    expect(await screen.findByRole("alert")).toHaveTextContent("That category no longer exists.")
    await userEvent.click(screen.getByRole("button", { name: "Reload garments" }))
    expect(refresh).toHaveBeenCalledOnce()
  })

  // The refresh hands this same form a shorter list of options; the form is not remounted, so the
  // deleted slug is still in its state. What the select shows and what the save sends must agree.
  it("stops sending a category that the reloaded options no longer have", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(answer(404, { error: "That category no longer exists. Reload and choose another." }))
    vi.stubGlobal("fetch", request)
    const view = render(<GarmentModelForm garment={ready} categories={categories} />)
    await userEvent.selectOptions(screen.getByLabelText("Shop category"), "crop-tops")
    await userEvent.click(screen.getByRole("button", { name: /^Save garment/ }))
    await userEvent.click(await screen.findByRole("button", { name: "Reload garments" }))
    expect(sentBody(request)).toMatchObject({ categorySlug: "crop-tops" })

    view.rerender(<GarmentModelForm garment={ready} categories={categories.slice(0, 1)} />)
    expect(screen.getByLabelText("Shop category")).toHaveDisplayValue("Choose a category")
    await userEvent.click(screen.getByRole("button", { name: /^Save garment/ }))
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    expect(sentBody(request, 1)).toMatchObject({ categorySlug: null })
  })

  it.each([
    [
      "an unreadable failure",
      () => Promise.resolve({ ok: false, status: 503, json: () => Promise.reject(new Error("html")) }),
      "didn't save",
    ],
    ["a dropped connection", () => Promise.reject(new TypeError("offline")), "could not be confirmed"],
  ])("says the save did not land after %s", async (_label, response, message) => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(response))
    render(<GarmentModelForm garment={ready} categories={categories} />)
    await userEvent.click(screen.getByRole("button", { name: /^Save garment/ }))
    expect(await screen.findByRole("alert")).toHaveTextContent(message)
    expect(refresh).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole("button", { name: /^Save garment/ })).toBeEnabled())
  })

  describe("while a save is in flight", () => {
    function deferredSave() {
      let release!: (value: ReturnType<typeof answer>) => void
      vi.stubGlobal(
        "fetch",
        vi.fn(() => new Promise<ReturnType<typeof answer>>((resolve) => (release = resolve)))
      )
      return (value: ReturnType<typeof answer>) => release(value)
    }
    const fields = ["Manufacturer", "Model", "Shop category", "Google product category", "Gender", "Age group"]

    // Most saves leave the card where it is. The form keeps its state then, but it is held all the
    // same: the form cannot know which kind of save this is until the refreshed list arrives.
    it("holds every field until the refreshed page has rendered, then hands the form back where it was", async () => {
      const release = deferredSave()
      let finishRefresh!: () => void
      // Stands in for the transition Next holds open until the refreshed tree has committed.
      refresh.mockImplementationOnce(() => new Promise<void>((resolve) => (finishRefresh = resolve)))
      render(<GarmentModelForm garment={ready} categories={categories} />)
      const user = userEvent.setup()
      const model = screen.getByLabelText("Model")
      await user.type(model, "A{Enter}")

      const form = screen.getByRole("form", { name: "Next Level 6210 setup" })
      expect(form).toHaveAttribute("aria-busy", "true")
      dropFocusAsABrowserWould()
      for (const name of [...fields, "Size system"]) expect(screen.getByLabelText(name)).toBeDisabled()
      expect(screen.getByRole("button", { name: /^Saving…/ })).toBeDisabled()
      expect(screen.getByRole("button", { name: /^Look up name from Printify/ })).toBeDisabled()
      expect(screen.getByRole("status")).toHaveTextContent("Saving this garment’s setup…")

      release(answer(200, { blueprintId: 1317 }))
      await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
      // Saved, but the list this card sits in has not caught up yet.
      expect(screen.getByRole("status")).toHaveTextContent("Saved. Updating the list…")
      expect(form).toHaveAttribute("aria-busy", "true")
      expect(screen.getByRole("button", { name: /^Updating…/ })).toBeDisabled()
      // The lookup writes into the name fields, so it waits out the refresh with them.
      expect(screen.getByRole("button", { name: /^Look up name from Printify/ })).toBeDisabled()
      expect(model).toBeDisabled()
      await user.type(model, "B")
      expect(model).toHaveValue("6210A")

      await act(async () => finishRefresh())
      await waitFor(() => expect(model).toBeEnabled())
      expect(form).toHaveAttribute("aria-busy", "false")
      expect(screen.getByRole("status")).toHaveTextContent(/^Saved\.$/)
      expect(model).toHaveValue("6210A")
      // Enter was pressed in this field, and holding it must not cost the owner their place.
      await waitFor(() => expect(model).toHaveFocus())
      await user.keyboard("B")
      expect(model).toHaveValue("6210AB")
    })

    it("gives the fields back, with everything the owner chose, when the save is refused", async () => {
      const release = deferredSave()
      render(<GarmentModelForm garment={ready} categories={categories} />)
      const user = userEvent.setup()
      await user.selectOptions(screen.getByLabelText("Gender"), "female")
      await user.type(screen.getByLabelText("Model"), "X")
      const save = screen.getByRole("button", { name: /^Save garment/ })
      save.focus()
      await user.keyboard("{Enter}")
      expect(screen.getByLabelText("Model")).toBeDisabled()
      dropFocusAsABrowserWould()

      release(answer(409, { error: "23 products on this garment are in the shop or scheduled." }))
      expect(await screen.findByRole("alert")).toHaveTextContent("23 products on this garment")
      await waitFor(() => expect(screen.getByLabelText("Model")).toBeEnabled())
      for (const name of fields) expect(screen.getByLabelText(name)).toBeEnabled()
      expect(screen.getByRole("form", { name: /setup$/ })).toHaveAttribute("aria-busy", "false")
      expect(screen.getByLabelText("Model")).toHaveValue("6210X")
      expect(screen.getByLabelText("Gender")).toHaveValue("female")
      expect(refresh).not.toHaveBeenCalled()
      await waitFor(() => expect(save).toHaveFocus())
      await user.type(screen.getByLabelText("Model"), "Y")
      expect(screen.getByLabelText("Model")).toHaveValue("6210XY")
    })

    // Nothing the lookup does can discard typing: it only ever fills a field that is still empty
    // when the answer lands. So the names stay the owner's to type while Printify thinks.
    it("leaves the fields editable during a lookup and keeps what was typed meanwhile", async () => {
      const release = deferredSave()
      render(<GarmentModelForm garment={unknown} categories={categories} />)
      await userEvent.click(screen.getByRole("button", { name: /^Look up name from Printify/ }))
      await userEvent.type(screen.getByLabelText("Model"), "Mine")
      release(answer(200, { blueprintId: 9999, title: "Crop Top", manufacturer: "Next Level", model: "5080" }))
      await waitFor(() => expect(screen.getByLabelText("Manufacturer")).toHaveValue("Next Level"))
      expect(screen.getByLabelText("Model")).toHaveValue("Mine")
    })
  })

  describe("looking the name up at Printify", () => {
    // The lookup spends a provider call, so it belongs to an explicit press and never to a render.
    it("asks nothing while the form merely renders", () => {
      const request = vi.fn()
      vi.stubGlobal("fetch", request)
      render(<GarmentModelForm garment={unknown} categories={categories} />)
      expect(request).not.toHaveBeenCalled()
    })

    it("sends only the blueprint number and fills only the name fields left empty", async () => {
      const request = vi
        .fn()
        .mockResolvedValue(
          answer(200, { blueprintId: 9999, title: "Women's Ideal Crop Top", manufacturer: "Next Level", model: "5080" })
        )
      vi.stubGlobal("fetch", request)
      render(<GarmentModelForm garment={unknown} categories={categories} />)
      await userEvent.type(screen.getByLabelText("Manufacturer"), "NL Apparel")
      await userEvent.click(screen.getByRole("button", { name: "Look up name from Printify: Blueprint 9999" }))

      expect(request).toHaveBeenCalledExactlyOnceWith("/api/admin/products/garments/9999/catalog", {
        credentials: "same-origin",
      })
      await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("5080"))
      // What the owner typed is a decision, not a draft.
      expect(screen.getByLabelText("Manufacturer")).toHaveValue("NL Apparel")
      expect(screen.getByRole("status")).toHaveTextContent(
        "Printify calls this “Women's Ideal Crop Top”. The empty name fields are filled in: check them, then save."
      )
      // Looking up is not saving.
      expect(refresh).not.toHaveBeenCalled()
    })

    it("keeps both names when the owner has already given them", async () => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(answer(200, { blueprintId: 1317, title: "Unisex Tee", manufacturer: "X", model: "Y" }))
      )
      render(<GarmentModelForm garment={ready} categories={categories} />)
      await userEvent.click(screen.getByRole("button", { name: /^Look up name from Printify/ }))
      expect(
        await screen.findByText("Printify calls this “Unisex Tee”. Your manufacturer and model were kept.")
      ).toBeVisible()
      expect(screen.getByLabelText("Manufacturer")).toHaveValue("Next Level")
      expect(screen.getByLabelText("Model")).toHaveValue("6210")
    })

    it("says so when Printify has no brand or model to offer", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(answer(200, { blueprintId: 9999, title: "Mystery Tee", manufacturer: "", model: "" }))
      )
      render(<GarmentModelForm garment={unknown} categories={categories} />)
      await userEvent.click(screen.getByRole("button", { name: /^Look up name from Printify/ }))
      expect(await screen.findByText(/had nothing for the empty name fields\. Type them yourself\./)).toBeVisible()
      expect(screen.getByLabelText("Manufacturer")).toHaveValue("")
    })

    it.each([
      [404, "Printify has no garment with that number."],
      [503, "Printify's catalog is not answering. Type the garment's name yourself, or try again shortly."],
    ])("shows the server's %i answer as written and leaves the fields alone", async (status, error) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(status, { error })))
      render(<GarmentModelForm garment={unknown} categories={categories} />)
      await userEvent.click(screen.getByRole("button", { name: /^Look up name from Printify/ }))
      expect(await screen.findByRole("alert")).toHaveTextContent(error)
      expect(screen.getByLabelText("Manufacturer")).toHaveValue("")
      expect(screen.getByLabelText("Model")).toHaveValue("")
      // Manual entry always works, so the form is fully usable again.
      await waitFor(() => expect(screen.getByRole("button", { name: /^Save garment/ })).toBeEnabled())
    })
  })

  it("points at the Categories page when there is nothing to choose from yet", () => {
    render(<GarmentModelForm garment={unknown} categories={[]} />)
    expect(screen.getByRole("link", { name: "Add one under Categories" })).toHaveAttribute(
      "href",
      "/admin/products/categories"
    )
    expect(screen.getByLabelText("Shop category")).toHaveAccessibleDescription(/There are no categories yet/)
  })
})
