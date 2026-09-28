import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, it, vi } from "vitest"

import { ConceptArchiveButton } from "./concept-archive-button"

const refresh = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

it("archives from a card without leaving the grid", async () => {
  const request = vi.fn().mockResolvedValue({ ok: true })
  vi.stubGlobal("fetch", request)
  render(<ConceptArchiveButton designId="design-1" displayNumber={149} state="active" compact />)
  await userEvent.click(screen.getByRole("button", { name: "Archive design #149" }))
  expect(request).toHaveBeenCalledWith(
    "/api/admin/concepts/design-1/state",
    expect.objectContaining({
      method: "PUT",
      credentials: "same-origin",
      body: '{"state":"archived"}',
    })
  )
  // The library shows active designs, so refreshing is what removes the card.
  await waitFor(() => expect(refresh).toHaveBeenCalled())
})

it("restores an archived design instead of archiving it again", async () => {
  const request = vi.fn().mockResolvedValue({ ok: true })
  vi.stubGlobal("fetch", request)
  render(<ConceptArchiveButton designId="design-1" displayNumber={149} state="archived" compact />)
  await userEvent.click(screen.getByRole("button", { name: "Restore design #149 to the library" }))
  expect(request).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ body: '{"state":"active"}' }))
})

it("keeps an icon-only control reachable by name", () => {
  render(<ConceptArchiveButton designId="design-1" displayNumber={149} state="active" compact />)
  const button = screen.getByRole("button", { name: "Archive design #149" })
  // A 44px target, because triaging a grid on a phone is the point of this control.
  expect(button.className).toContain("size-11")
  expect(screen.queryByText(/Archiving hides this design/)).not.toBeInTheDocument()
})

it("explains what archiving does on the detail page", () => {
  render(<ConceptArchiveButton designId="design-1" displayNumber={149} state="active" />)
  expect(screen.getByText(/Archiving hides this design from the library/)).toBeVisible()
})

it("reports a failure instead of implying the design was archived", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }))
  render(<ConceptArchiveButton designId="design-1" displayNumber={149} state="active" compact />)
  await userEvent.click(screen.getByRole("button", { name: "Archive design #149" }))
  expect(await screen.findByText(/could not be saved/)).toBeVisible()
  expect(refresh).not.toHaveBeenCalled()
})

it("does not send a second request while one is in flight", async () => {
  const request = vi.fn().mockReturnValue(new Promise(() => {}))
  vi.stubGlobal("fetch", request)
  render(<ConceptArchiveButton designId="design-1" displayNumber={149} state="active" compact />)
  const button = screen.getByRole("button", { name: "Archive design #149" })
  await userEvent.click(button)
  await waitFor(() => expect(button).toBeDisabled())
  expect(request).toHaveBeenCalledTimes(1)
})
