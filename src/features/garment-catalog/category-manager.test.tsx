import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CategoryManager } from "./category-manager"
import type { ShopCategory } from "./garment-catalog"

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const categories: ShopCategory[] = [
  { slug: "t-shirts", name: "T-shirts", garmentCount: 2 },
  { slug: "crop-tops", name: "Crop tops", garmentCount: 1 },
  { slug: "tank-tops", name: "Tank tops", garmentCount: 0 },
]

function answer(status: number, body: unknown = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function names() {
  return within(screen.getByRole("list", { name: "Shop categories" }))
    .getAllByRole("listitem")
    .map((item) => item.querySelector("p")?.textContent)
}

function sent(request: ReturnType<typeof vi.fn>, call = 0) {
  const [url, init] = request.mock.calls[call] as [string, RequestInit]
  const body = init.body === undefined ? undefined : (JSON.parse(String(init.body)) as Record<string, unknown>)
  return { url, method: init.method, body }
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

describe("CategoryManager", () => {
  it("lists the categories in their saved order with the slug that never changes and what uses them", () => {
    render(<CategoryManager categories={categories} />)
    expect(names()).toEqual(["T-shirts", "Crop tops", "Tank tops"])
    expect(screen.getByText("Slug t-shirts · 2 garments")).toBeVisible()
    expect(screen.getByText("Slug crop-tops · 1 garment")).toBeVisible()
    expect(screen.getByText("Slug tank-tops · no garments yet")).toBeVisible()
  })

  it("invites the first category when there are none", () => {
    render(<CategoryManager categories={[]} />)
    expect(screen.getByText(/^No categories yet\. Add the first one below/)).toBeVisible()
    expect(screen.queryByRole("list", { name: "Shop categories" })).not.toBeInTheDocument()
  })

  describe("renaming", () => {
    it("saves the new name to the category's own address and carries focus in and back out", async () => {
      const request = vi.fn().mockResolvedValue(answer(200, { slug: "tank-tops", name: "Tanks" }))
      vi.stubGlobal("fetch", request)
      render(<CategoryManager categories={categories} />)
      const user = userEvent.setup()
      screen.getByRole("button", { name: "Rename Tank tops" }).focus()
      await user.keyboard("{Enter}")
      const input = screen.getByLabelText("New name for Tank tops")
      await waitFor(() => expect(input).toHaveFocus())
      expect(input).toHaveValue("Tank tops")
      await user.clear(input)
      await user.keyboard("  Tanks {Enter}")

      // The name alone: the slug is the address, and the route refuses a body that carries one.
      expect(sent(request)).toEqual({
        url: "/api/admin/products/categories/tank-tops",
        method: "PUT",
        body: { name: "Tanks" },
      })
      expect(await screen.findByText("Tank tops is now called Tanks.")).toBeVisible()
      expect(names()).toEqual(["T-shirts", "Crop tops", "Tanks"])
      // Identity did not move.
      expect(screen.getByText("Slug tank-tops · no garments yet")).toBeVisible()
      await waitFor(() => expect(screen.getByRole("button", { name: "Rename Tanks" })).toHaveFocus())
      expect(refresh).not.toHaveBeenCalled()
    })

    it("says before saving that only the name changes", async () => {
      render(<CategoryManager categories={categories} />)
      await userEvent.click(screen.getByRole("button", { name: "Rename T-shirts" }))
      expect(screen.getByLabelText("New name for T-shirts")).toHaveAccessibleDescription(
        "Only the name changes. Its slug stays t-shirts, so nothing that points at it breaks."
      )
    })

    it("keeps the owner in the field with the server's words when the name is taken", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(answer(409, { error: "A category with that name already exists." }))
      )
      render(<CategoryManager categories={categories} />)
      await userEvent.click(screen.getByRole("button", { name: "Rename Tank tops" }))
      const input = screen.getByLabelText("New name for Tank tops")
      await userEvent.clear(input)
      await userEvent.type(input, "Crop tops{Enter}")
      expect(await screen.findByRole("alert")).toHaveTextContent("A category with that name already exists.")
      expect(input).toHaveValue("Crop tops")
      await waitFor(() => expect(input).toHaveFocus())
      expect(names()).toEqual(["T-shirts", "Crop tops", "Tank tops"])
      expect(screen.queryByRole("button", { name: "Reload categories" })).not.toBeInTheDocument()
    })

    it("offers a reload when the category was deleted somewhere else", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(404, { error: "That category no longer exists." })))
      render(<CategoryManager categories={categories} />)
      await userEvent.click(screen.getByRole("button", { name: "Rename Tank tops" }))
      await userEvent.type(screen.getByLabelText("New name for Tank tops"), "!{Enter}")
      expect(await screen.findByRole("alert")).toHaveTextContent("That category no longer exists.")
      await userEvent.click(screen.getByRole("button", { name: "Reload categories" }))
      expect(refresh).toHaveBeenCalledOnce()
    })

    it.each([
      ["an unchanged name", "{Enter}"],
      ["Escape", "Changed{Escape}"],
    ])("sends nothing for %s and returns focus to Rename", async (_label, keys) => {
      const request = vi.fn()
      vi.stubGlobal("fetch", request)
      render(<CategoryManager categories={categories} />)
      await userEvent.click(screen.getByRole("button", { name: "Rename Tank tops" }))
      await userEvent.type(screen.getByLabelText("New name for Tank tops"), keys)
      await waitFor(() => expect(screen.getByRole("button", { name: "Rename Tank tops" })).toHaveFocus())
      expect(names()).toEqual(["T-shirts", "Crop tops", "Tank tops"])
      expect(request).not.toHaveBeenCalled()
    })

    // The arrows stay live during a rename. A request that settles a moment later must not pull the
    // owner back off the control they have gone on to.
    it("leaves focus where the owner has moved to while the name was saving", async () => {
      let release!: (value: ReturnType<typeof answer>) => void
      const request = vi.fn((url: string) =>
        url.endsWith("/t-shirts")
          ? new Promise<ReturnType<typeof answer>>((resolve) => (release = resolve))
          : Promise.resolve(answer(200))
      )
      vi.stubGlobal("fetch", request)
      render(<CategoryManager categories={categories} />)
      await userEvent.click(screen.getByRole("button", { name: "Rename T-shirts" }))
      await userEvent.clear(screen.getByLabelText("New name for T-shirts"))
      await userEvent.type(screen.getByLabelText("New name for T-shirts"), "Shirts")
      await userEvent.click(screen.getByRole("button", { name: "Save name for T-shirts" }))
      await userEvent.click(screen.getByRole("button", { name: "Move Tank tops up" }))
      await waitFor(() => expect(screen.getByRole("button", { name: "Move Tank tops up" })).toHaveFocus())
      release(answer(200, { slug: "t-shirts", name: "Shirts" }))
      expect(await screen.findByText("T-shirts is now called Shirts.")).toBeVisible()
      await screen.findByRole("button", { name: "Rename Shirts" })
      expect(screen.getByRole("button", { name: "Move Tank tops up" })).toHaveFocus()
    })

    // A successful save puts the field away, and whatever it held goes with it. So the field takes
    // no typing between the press and the answer; what it would have accepted it would have lost.
    it.each([
      ["saves", answer(200, { slug: "t-shirts", name: "Shirts" }), "Shirts"],
      ["is refused", answer(409, { error: "A category with that name already exists." }), "T-shirts"],
    ])("loses nothing typed into the name while a rename waits and then %s", async (_label, response, listed) => {
      let release!: (value: ReturnType<typeof answer>) => void
      vi.stubGlobal(
        "fetch",
        vi.fn(() => new Promise<ReturnType<typeof answer>>((resolve) => (release = resolve)))
      )
      render(<CategoryManager categories={categories} />)
      const user = userEvent.setup()
      await user.click(screen.getByRole("button", { name: "Rename T-shirts" }))
      const input = screen.getByLabelText("New name for T-shirts")
      await user.clear(input)
      await user.type(input, "Shirts{Enter}")
      expect(await screen.findByRole("button", { name: /^Saving…/ })).toBeDisabled()

      await user.type(input, " and more")
      expect(input).toHaveValue("Shirts")
      expect(input).toBeDisabled()
      dropFocusAsABrowserWould()
      expect(input.closest("form")).toHaveAttribute("aria-busy", "true")

      release(response)
      if (response.ok) {
        expect(await screen.findByText("T-shirts is now called Shirts.")).toBeVisible()
        await waitFor(() => expect(screen.getByRole("button", { name: "Rename Shirts" })).toHaveFocus())
      } else {
        // Refused: the field is the owner's again, with what they typed, and focus is back in it.
        expect(await screen.findByRole("alert")).toHaveTextContent("already exists")
        await waitFor(() => expect(input).toBeEnabled())
        expect(input).toHaveValue("Shirts")
        await waitFor(() => expect(input).toHaveFocus())
        await user.type(input, " and more")
        expect(input).toHaveValue("Shirts and more")
      }
      expect(names()[0]).toBe(listed)
    })

    it("refuses an empty name on the page", async () => {
      const request = vi.fn()
      vi.stubGlobal("fetch", request)
      render(<CategoryManager categories={categories} />)
      await userEvent.click(screen.getByRole("button", { name: "Rename Tank tops" }))
      const input = screen.getByLabelText("New name for Tank tops")
      await userEvent.clear(input)
      await userEvent.click(screen.getByRole("button", { name: "Save name for Tank tops" }))
      expect(screen.getByRole("alert")).toHaveTextContent("Give the category a name.")
      expect(input).toBeInvalid()
      expect(request).not.toHaveBeenCalled()
    })
  })

  describe("reordering", () => {
    it("saves the whole order as soon as a category moves and keeps focus on it", async () => {
      const request = vi.fn().mockResolvedValue(answer(200, { saved: true }))
      vi.stubGlobal("fetch", request)
      render(<CategoryManager categories={categories} />)
      await userEvent.click(screen.getByRole("button", { name: "Move T-shirts down" }))
      expect(names()).toEqual(["Crop tops", "T-shirts", "Tank tops"])
      // Every slug, because the route checks the exact set and answers 409 to anything less.
      expect(sent(request)).toEqual({
        url: "/api/admin/products/categories",
        method: "PUT",
        body: { categorySlugs: ["crop-tops", "t-shirts", "tank-tops"] },
      })
      expect(await screen.findByText("Order saved.")).toBeVisible()
      expect(screen.getByRole("button", { name: "Move T-shirts down" })).toHaveFocus()
      expect(screen.getByText("T-shirts moved to position 2 of 3.")).toBeInTheDocument()
    })

    it("moves focus to the other arrow when a category reaches either end", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(200, { saved: true })))
      render(<CategoryManager categories={categories} />)
      expect(screen.getByRole("button", { name: "Move T-shirts up" })).toBeDisabled()
      expect(screen.getByRole("button", { name: "Move Tank tops down" })).toBeDisabled()
      await userEvent.click(screen.getByRole("button", { name: "Move Crop tops up" }))
      expect(screen.getByRole("button", { name: "Move Crop tops up" })).toBeDisabled()
      expect(screen.getByRole("button", { name: "Move Crop tops down" })).toHaveFocus()
    })

    it("saves moves made during a request together once it finishes", async () => {
      const first = Promise.withResolvers<ReturnType<typeof answer>>()
      const request = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(answer(200))
      vi.stubGlobal("fetch", request)
      render(<CategoryManager categories={categories} />)
      await userEvent.click(screen.getByRole("button", { name: "Move Tank tops up" }))
      expect(screen.getByText("Saving…")).toBeVisible()
      await userEvent.click(screen.getByRole("button", { name: "Move Tank tops up" }))
      await userEvent.click(screen.getByRole("button", { name: "Move T-shirts down" }))
      expect(request).toHaveBeenCalledTimes(1)
      first.resolve(answer(200))
      expect(await screen.findByText("Order saved.")).toBeVisible()
      expect(request.mock.calls.map((_call, index) => sent(request, index).body?.categorySlugs)).toEqual([
        ["t-shirts", "tank-tops", "crop-tops"],
        ["tank-tops", "crop-tops", "t-shirts"],
      ])
    })

    it("puts the last saved order back and offers a reload when the categories changed elsewhere", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(answer(409, { error: "The categories changed. Reload to sort the latest list." }))
      )
      render(<CategoryManager categories={categories} />)
      await userEvent.click(screen.getByRole("button", { name: "Move T-shirts down" }))
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "The categories changed. Reload to sort the latest list."
      )
      expect(names()).toEqual(["T-shirts", "Crop tops", "Tank tops"])
      expect(screen.queryByText("Order saved.")).not.toBeInTheDocument()
      // T-shirts is back on top, where "up" is disabled again; the owner is not dropped off the page.
      await waitFor(() => expect(screen.getByRole("button", { name: "Move T-shirts down" })).toHaveFocus())
      await userEvent.click(screen.getByRole("button", { name: "Reload categories" }))
      expect(refresh).toHaveBeenCalledOnce()
    })

    it.each([
      [
        "a failure with nothing to read",
        () => Promise.resolve({ ok: false, status: 503, json: () => Promise.reject(new Error("html")) }),
        "last saved order is back in place",
      ],
      ["a dropped connection", () => Promise.reject(new TypeError("offline")), "could not be confirmed"],
    ])("restores the order after %s without offering a reload", async (_label, response, message) => {
      vi.stubGlobal("fetch", vi.fn().mockImplementation(response))
      render(<CategoryManager categories={categories} />)
      await userEvent.click(screen.getByRole("button", { name: "Move Crop tops down" }))
      expect(await screen.findByRole("alert")).toHaveTextContent(message)
      expect(names()).toEqual(["T-shirts", "Crop tops", "Tank tops"])
      expect(screen.queryByRole("button", { name: "Reload categories" })).not.toBeInTheDocument()
    })
  })

  describe("deleting", () => {
    // The database refuses it anyway (the garments' foreign key), but a button that can only fail is
    // a worse way to say so, and a disabled one cannot be focused to explain itself.
    it("disables Delete on a category in use and says what to do first, in plain text beside it", () => {
      render(<CategoryManager categories={categories} />)
      const blocked = screen.getByRole("button", { name: "Delete T-shirts" })
      expect(blocked).toBeDisabled()
      expect(blocked).toHaveAccessibleDescription("Move its 2 garments to another category before deleting this one.")
      expect(screen.getByRole("button", { name: "Delete Crop tops" })).toHaveAccessibleDescription(
        "Move its garment to another category before deleting this one."
      )
      expect(screen.getByRole("button", { name: "Delete Tank tops" })).toBeEnabled()
    })

    it("asks first, with focus on the question so a second Enter cannot delete", async () => {
      const request = vi.fn()
      vi.stubGlobal("fetch", request)
      render(<CategoryManager categories={categories} />)
      const user = userEvent.setup()
      screen.getByRole("button", { name: "Delete Tank tops" }).focus()
      await user.keyboard("{Enter}")
      const question = screen.getByText("Delete Tank tops? No garment uses it, so nothing else changes.")
      await waitFor(() => expect(question).toHaveFocus())
      await user.keyboard("{Enter}")
      expect(request).not.toHaveBeenCalled()

      await user.click(screen.getByRole("button", { name: "Keep it: Tank tops" }))
      expect(question).not.toBeInTheDocument()
      await waitFor(() => expect(screen.getByRole("button", { name: "Delete Tank tops" })).toHaveFocus())
      expect(request).not.toHaveBeenCalled()
    })

    it("deletes once confirmed and moves focus somewhere that still exists", async () => {
      const request = vi.fn().mockResolvedValue(answer(200, { deleted: true }))
      vi.stubGlobal("fetch", request)
      render(<CategoryManager categories={categories} />)
      await userEvent.click(screen.getByRole("button", { name: "Delete Tank tops" }))
      await userEvent.click(screen.getByRole("button", { name: "Yes, delete Tank tops" }))
      expect(sent(request)).toEqual({
        url: "/api/admin/products/categories/tank-tops",
        method: "DELETE",
        body: undefined,
      })
      expect(await screen.findByText("Tank tops deleted.")).toBeVisible()
      expect(names()).toEqual(["T-shirts", "Crop tops"])
      await waitFor(() => expect(screen.getByRole("heading", { name: "Shop categories" })).toHaveFocus())
    })

    // A garment took the category after this page loaded. The refusal carries the real count.
    it("shows the server's refusal and starts telling the truth about a category that turned out to be in use", async () => {
      const refusal = "2 garments still use this category. Move them to another category first."
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(409, { error: refusal, garments: 2 })))
      render(<CategoryManager categories={categories} />)
      await userEvent.click(screen.getByRole("button", { name: "Delete Tank tops" }))
      await userEvent.click(screen.getByRole("button", { name: "Yes, delete Tank tops" }))
      expect(await screen.findByRole("alert")).toHaveTextContent(refusal)
      expect(names()).toEqual(["T-shirts", "Crop tops", "Tank tops"])
      expect(screen.getByText("Slug tank-tops · 2 garments")).toBeVisible()
      expect(screen.getByRole("button", { name: "Delete Tank tops" })).toBeDisabled()
      await waitFor(() => expect(screen.getByRole("button", { name: "Rename Tank tops" })).toHaveFocus())
      expect(screen.getByRole("button", { name: "Reload categories" })).toBeVisible()
    })

    // Only a list that changed elsewhere (409, 404) is fixed by the server's copy. For anything else
    // the refresh would bring back the same page, so the button would be a press that does nothing.
    it("does not offer a reload for a failure that fresh categories would not fix", async () => {
      const refusal = "Categories are unavailable right now."
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(503, { error: refusal })))
      render(<CategoryManager categories={categories} />)
      await userEvent.click(screen.getByRole("button", { name: "Delete Tank tops" }))
      await userEvent.click(screen.getByRole("button", { name: "Yes, delete Tank tops" }))
      expect(await screen.findByRole("alert")).toHaveTextContent(refusal)
      expect(screen.queryByRole("button", { name: "Reload categories" })).not.toBeInTheDocument()
      await waitFor(() => expect(screen.getByRole("button", { name: "Delete Tank tops" })).toHaveFocus())
    })

    // The page remounts this list only when the server's copy differs, so the press has to show for
    // itself even when nothing comes back changed.
    it("puts the alert away and keeps focus on the page when a reload is asked for", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(404, { error: "That category is already gone." })))
      render(<CategoryManager categories={categories} />)
      await userEvent.click(screen.getByRole("button", { name: "Delete Tank tops" }))
      await userEvent.click(screen.getByRole("button", { name: "Yes, delete Tank tops" }))
      await userEvent.click(await screen.findByRole("button", { name: "Reload categories" }))
      expect(refresh).toHaveBeenCalledOnce()
      expect(screen.queryByRole("alert")).not.toBeInTheDocument()
      await waitFor(() => expect(screen.getByRole("heading", { name: "Shop categories" })).toHaveFocus())
    })

    // An order save names every slug and the route answers 409 to a set that is about to change.
    it("holds the arrows while a delete is in flight, and gives them back after", async () => {
      let release!: (value: ReturnType<typeof answer>) => void
      vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise((resolve) => (release = resolve))))
      render(<CategoryManager categories={categories} />)
      await userEvent.click(screen.getByRole("button", { name: "Delete Tank tops" }))
      await userEvent.click(screen.getByRole("button", { name: "Yes, delete Tank tops" }))
      expect(screen.getByRole("button", { name: "Move Crop tops up" })).toBeDisabled()
      release(answer(200, { deleted: true }))
      await screen.findByText("Tank tops deleted.")
      expect(screen.getByRole("button", { name: "Move Crop tops up" })).toBeEnabled()
    })

    it("keeps a reorder working after a delete, naming only what is left", async () => {
      const request = vi.fn().mockResolvedValue(answer(200))
      vi.stubGlobal("fetch", request)
      render(<CategoryManager categories={categories} />)
      await userEvent.click(screen.getByRole("button", { name: "Delete Tank tops" }))
      await userEvent.click(screen.getByRole("button", { name: "Yes, delete Tank tops" }))
      await screen.findByText("Tank tops deleted.")
      await userEvent.click(screen.getByRole("button", { name: "Move Crop tops up" }))
      expect(sent(request, 1).body).toEqual({ categorySlugs: ["crop-tops", "t-shirts"] })
    })
  })

  describe("adding", () => {
    it("says the slug is fixed at creation and previews it", async () => {
      render(<CategoryManager categories={categories} />)
      const input = screen.getByLabelText("New category name")
      expect(input).toHaveAccessibleDescription(
        "Its slug is made from this name when you add it and is fixed from then on, even if you rename the category later."
      )
      await userEvent.type(input, "Long Sleeves & Hoodies")
      expect(input).toHaveAccessibleDescription(/This one would be long-sleeves-hoodies\.$/)
    })

    it("adds the category the server created to the end and gets ready for the next one", async () => {
      const request = vi
        .fn()
        .mockResolvedValue(answer(200, { category: { slug: "hoodies", name: "Hoodies", garmentCount: 0 } }))
      vi.stubGlobal("fetch", request)
      render(<CategoryManager categories={categories} />)
      const input = screen.getByLabelText("New category name")
      await userEvent.type(input, "  Hoodies  ")
      await userEvent.click(screen.getByRole("button", { name: "Add category" }))
      expect(sent(request)).toEqual({
        url: "/api/admin/products/categories",
        method: "POST",
        body: { name: "Hoodies" },
      })
      expect(await screen.findByText("Hoodies added at the end of the list.")).toBeVisible()
      expect(names()).toEqual(["T-shirts", "Crop tops", "Tank tops", "Hoodies"])
      expect(screen.getByText("Slug hoodies · no garments yet")).toBeVisible()
      expect(input).toHaveValue("")
      await waitFor(() => expect(input).toHaveFocus())

      // The new category is part of the order from here on, or the next reorder would be a 409.
      await userEvent.click(screen.getByRole("button", { name: "Move Hoodies up" }))
      expect(sent(request, 1).body).toEqual({ categorySlugs: ["t-shirts", "crop-tops", "hoodies", "tank-tops"] })
    })

    // Adding empties the field for the next name. Typing taken during the request would be emptied
    // with it, so the field is held until the answer is in and handed back with focus after.
    it.each([
      ["succeeds", answer(200, { category: { slug: "hoodies", name: "Hoodies", garmentCount: 0 } }), ""],
      ["is refused", answer(409, { error: "A category with that name already exists." }), "Hoodies"],
    ])("loses nothing typed into the new name while an add waits and then %s", async (_label, response, left) => {
      let release!: (value: ReturnType<typeof answer>) => void
      vi.stubGlobal(
        "fetch",
        vi.fn(() => new Promise<ReturnType<typeof answer>>((resolve) => (release = resolve)))
      )
      render(<CategoryManager categories={categories} />)
      const user = userEvent.setup()
      const input = screen.getByLabelText("New category name")
      await user.type(input, "Hoodies{Enter}")
      expect(await screen.findByRole("button", { name: "Adding…" })).toBeDisabled()

      await user.type(input, " and zips")
      expect(input).toHaveValue("Hoodies")
      expect(input).toBeDisabled()
      dropFocusAsABrowserWould()
      expect(input.closest("form")).toHaveAttribute("aria-busy", "true")

      release(response)
      await waitFor(() => expect(input).toBeEnabled())
      expect(input).toHaveValue(left)
      await waitFor(() => expect(input).toHaveFocus())
      await user.type(input, "Zips")
      expect(input).toHaveValue(`${left}Zips`)
    })

    it("shows the server's words when the name is taken and keeps what was typed", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(answer(409, { error: "A category with that name already exists." }))
      )
      render(<CategoryManager categories={categories} />)
      await userEvent.type(screen.getByLabelText("New category name"), "t-shirts{Enter}")
      expect(await screen.findByRole("alert")).toHaveTextContent("A category with that name already exists.")
      expect(screen.getByLabelText("New category name")).toHaveValue("t-shirts")
      expect(names()).toEqual(["T-shirts", "Crop tops", "Tank tops"])
    })

    // The route answers both with the same 400. Deciding here saves the trip and says which it was.
    it.each([
      ["   ", "Give the category a name."],
      ["日本語", "Use at least one letter or number from a to z or 0 to 9, so the category can have a slug."],
    ])("refuses %j on the page without a request", async (name, message) => {
      const request = vi.fn()
      vi.stubGlobal("fetch", request)
      render(<CategoryManager categories={categories} />)
      const input = screen.getByLabelText("New category name")
      await userEvent.type(input, `${name}{Enter}`)
      expect(screen.getByRole("alert")).toHaveTextContent(message)
      expect(input).toBeInvalid()
      expect(input).toHaveFocus()
      expect(request).not.toHaveBeenCalled()
    })
  })
})
