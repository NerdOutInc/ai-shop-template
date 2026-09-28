import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ConceptFavoriteButton } from "./concept-favorite-button"

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
afterEach(() => vi.unstubAllGlobals())

describe("ConceptFavoriteButton", () => {
  it("saves the displayed revision without sending an owner identity", async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ selected: true, revisionId: "revision-1" }) })
    vi.stubGlobal("fetch", request)
    render(
      <ConceptFavoriteButton
        designId="design-1"
        displayNumber={149}
        revisionId="revision-1"
        favoriteRevisionId={null}
        colorName="CVC Midnight Navy"
      />
    )
    await userEvent.click(screen.getByRole("button", { name: "Favorite design #149" }))
    expect(request).toHaveBeenCalledWith(
      "/api/admin/concepts/design-1/favorite",
      expect.objectContaining({
        method: "PUT",
        credentials: "same-origin",
        body: '{"selected":true,"revisionId":"revision-1","colorName":"CVC Midnight Navy"}',
      })
    )
    await waitFor(() => expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true"))
    expect(refresh).toHaveBeenCalled()
  })

  it("does not show a favorite as saved after an authorization failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }))
    render(
      <ConceptFavoriteButton
        designId="design-1"
        displayNumber={149}
        revisionId="revision-1"
        favoriteRevisionId={null}
        colorName="CVC Midnight Navy"
      />
    )
    await userEvent.click(screen.getByRole("button"))
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be saved")
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false")
  })

  it("replaces an older favorite only through the explicit revision action", async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ selected: true, revisionId: "revision-2" }) })
    vi.stubGlobal("fetch", request)
    render(
      <ConceptFavoriteButton
        designId="design-1"
        displayNumber={149}
        revisionId="revision-2"
        favoriteRevisionId="revision-1"
        colorName="CVC Midnight Navy"
      />
    )
    expect(request).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: "Save this revision of design #149 to my favorites" }))
    expect(request).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: '{"selected":true,"revisionId":"revision-2","colorName":"CVC Midnight Navy"}' })
    )
  })

  it("keeps the prior selection after a conflict or mismatched receipt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ selected: true, revisionId: "other" }) })
    )
    render(
      <ConceptFavoriteButton
        designId="design-1"
        displayNumber={149}
        revisionId="revision-1"
        favoriteRevisionId={null}
        colorName="CVC Midnight Navy"
      />
    )
    await userEvent.click(screen.getByRole("button"))
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be confirmed")
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false")
  })
})
