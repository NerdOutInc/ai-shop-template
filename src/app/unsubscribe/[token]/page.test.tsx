import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import UnsubscribePage, { metadata } from "./page"

const { isUnsubscribed } = vi.hoisted(() => ({ isUnsubscribed: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/features/drop-signup/get-drop-signup-store.server", () => ({
  getDropSignupStore: () => ({ isUnsubscribed }),
}))
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
}))

const token = "5f0b2c4e-8a51-4d8e-9a57-2c1f7f3b9d10"
const page = (value = token) => UnsubscribePage({ params: Promise.resolve({ token: value }) })

beforeEach(() => {
  isUnsubscribed.mockReset().mockResolvedValue(false)
})

describe("unsubscribe page", () => {
  it("asks before doing anything, and is never indexed", async () => {
    render(await page())
    expect(isUnsubscribed).toHaveBeenCalledWith(token)
    expect(screen.getByRole("heading", { level: 1, name: "Stop the drop emails?" })).toBeVisible()
    expect(screen.getByRole("button", { name: "Unsubscribe" })).toBeVisible()
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })

  it("says so when the list already shows them as gone", async () => {
    isUnsubscribed.mockResolvedValue(true)
    render(await page())
    expect(screen.getByRole("heading", { level: 1, name: "You’re off the list." })).toBeVisible()
  })

  // Leaving must never depend on reading first: the button works without that answer.
  it("still offers the button when the list cannot be read", async () => {
    isUnsubscribed.mockRejectedValue(new Error("database down"))
    render(await page())
    expect(screen.getByRole("button", { name: "Unsubscribe" })).toBeVisible()
  })

  it("has nothing to say for a link that is not one of ours", async () => {
    await expect(page("customer@example.com")).rejects.toThrow("NEXT_NOT_FOUND")
    expect(isUnsubscribed).not.toHaveBeenCalled()
  })
})
