import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { DropConfirmationPanel } from "./drop-confirmation-panel"

const token = "a".repeat(64)
beforeEach(() => {
  window.history.replaceState(null, "", `/confirm-signup#${token}`)
})
afterEach(() => vi.unstubAllGlobals())
it("never confirms on a scanner visit, removes the fragment and confirms only on explicit keyboard activation", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ status: "confirmed" }))
  vi.stubGlobal("fetch", fetch)
  render(<DropConfirmationPanel />)
  expect(await screen.findByRole("button", { name: "Confirm signup" })).toBeEnabled()
  expect(window.location.hash).toBe("")
  expect(fetch).not.toHaveBeenCalled()
  await userEvent.tab()
  expect(screen.getByRole("button")).toHaveFocus()
  await userEvent.keyboard("{Enter}")
  expect(await screen.findByRole("heading", { name: "You're on the list" })).toHaveFocus()
  expect(fetch).toHaveBeenCalledWith(
    "/api/drop-confirm",
    expect.objectContaining({ method: "POST", body: JSON.stringify({ token }) })
  )
})
it.each([410, 503])("shows the %s state and preserves retry only for a temporary failure", async (status) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({}, { status })))
  render(<DropConfirmationPanel />)
  await userEvent.click(await screen.findByRole("button", { name: "Confirm signup" }))
  if (status === 410) {
    expect(await screen.findByRole("heading", { name: "This link has expired" })).toHaveFocus()
    expect(screen.queryByRole("button")).toBeNull()
  } else {
    expect(await screen.findByRole("alert")).toBeVisible()
    expect(screen.getByRole("button")).toBeEnabled()
  }
})
it("recovers a missing in-memory token by reopening the email instead of requesting a resend", async () => {
  const fetch = vi.fn()
  vi.stubGlobal("fetch", fetch)
  window.history.replaceState(null, "", "/confirm-signup")
  render(<DropConfirmationPanel />)
  expect(await screen.findByRole("heading", { name: "Open your email link again" })).toBeVisible()
  expect(screen.getByRole("status")).toHaveTextContent("You don't need to request another email.")
  expect(screen.queryByRole("button")).toBeNull()
  expect(fetch).not.toHaveBeenCalled()
  expect(screen.getByRole("link")).toHaveAttribute("href", "/")
})

it("accepts a fresh email fragment in an already open tab without an automatic POST", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ status: "confirmed" }))
  vi.stubGlobal("fetch", fetch)
  render(<DropConfirmationPanel />)
  await userEvent.click(await screen.findByRole("button"))
  await screen.findByRole("heading", { name: "You're on the list" })
  window.history.replaceState(null, "", `/confirm-signup#${"b".repeat(64)}`)
  fireEvent(window, new HashChangeEvent("hashchange"))
  expect(await screen.findByRole("button", { name: "Confirm signup" })).toBeEnabled()
  expect(window.location.hash).toBe("")
  expect(fetch).toHaveBeenCalledTimes(1)
  await userEvent.click(screen.getByRole("button"))
  expect(fetch.mock.calls[1]![1].body).toBe(JSON.stringify({ token: "b".repeat(64) }))
})

it("keeps the capability through skip navigation and accepts a second email fragment", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ status: "confirmed" }))
  vi.stubGlobal("fetch", fetch)
  render(<DropConfirmationPanel />)
  await screen.findByRole("button", { name: "Confirm signup" })
  window.history.replaceState(null, "", "/confirm-signup#main-content")
  fireEvent(window, new HashChangeEvent("hashchange"))
  expect(screen.getByRole("button", { name: "Confirm signup" })).toBeEnabled()
  expect(fetch).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole("button"))
  expect(fetch.mock.calls[0]![1].body).toBe(JSON.stringify({ token }))
  window.history.replaceState(null, "", `/confirm-signup#${"c".repeat(64)}`)
  fireEvent(window, new HashChangeEvent("hashchange"))
  await userEvent.click(await screen.findByRole("button", { name: "Confirm signup" }))
  expect(fetch.mock.calls[1]![1].body).toBe(JSON.stringify({ token: "c".repeat(64) }))
})
