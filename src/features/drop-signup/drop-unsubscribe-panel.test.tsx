import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DropUnsubscribePanel } from "./drop-unsubscribe-panel"

const store = vi.hoisted(() => ({
  configured: true,
  policies: { published: true },
  features: { dropSignup: true },
  home: { shopLabel: "Browse the collection" },
  supportEmail: "support@fixture.example",
}))
vi.mock("@/lib/store-config", () => ({ storeConfig: store }))

beforeEach(() => {
  store.features.dropSignup = true
})
afterEach(() => vi.unstubAllGlobals())

const token = "5f0b2c4e-8a51-4d8e-9a57-2c1f7f3b9d10"

describe("DropUnsubscribePanel", () => {
  it("asks first, then unsubscribes and carries focus to the answer", async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ unsubscribed: true }))
    vi.stubGlobal("fetch", request)
    render(<DropUnsubscribePanel token={token} />)
    // Opening the link does nothing by itself: mail scanners open every link in a message.
    expect(screen.getByRole("heading", { level: 1, name: "Stop the drop emails?" })).toBeVisible()
    expect(screen.getByText(/you can sign up again on the home page any time\./)).toBeVisible()
    expect(request).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole("button", { name: "Unsubscribe" }))
    expect(request).toHaveBeenCalledWith(`/api/drop-unsubscribe/${token}`, { method: "POST", credentials: "omit" })
    const done = await screen.findByRole("heading", { level: 1, name: "You’re off the list." })
    expect(done).toHaveFocus()
    expect(screen.getByText(/the signup is on the home page\./)).toBeVisible()
    expect(screen.getByRole("link", { name: "Browse the collection" })).toHaveAttribute("href", "/shop")
  })

  it("never points someone at a signup the store has closed", () => {
    store.features.dropSignup = false
    const { unmount } = render(<DropUnsubscribePanel token={token} />)
    expect(
      screen.getByText("We’ll stop emailing you when a new design drops. That’s all this list ever sends.")
    ).toBeVisible()
    unmount()
    render(<DropUnsubscribePanel token={token} done />)
    expect(screen.getByText("No more drop emails. No hard feelings, either.")).toBeVisible()
  })

  it("posts the same form without JavaScript, and shows the answer once the list says so", () => {
    const { container, unmount } = render(<DropUnsubscribePanel token={token} />)
    expect(container.querySelector("form")).toHaveAttribute("action", `/api/drop-unsubscribe/${token}`)
    expect(container.querySelector("form")).toHaveAttribute("method", "post")
    unmount()
    render(<DropUnsubscribePanel token={token} done />)
    // Arriving on a finished page moves nothing: nobody pressed anything here.
    expect(screen.getByRole("heading", { level: 1, name: "You’re off the list." })).not.toHaveFocus()
  })

  it("keeps the button and offers a person when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ error: "That didn't go through. Try again in a moment." }, { status: 503 }))
    )
    render(<DropUnsubscribePanel token={token} />)
    await userEvent.click(screen.getByRole("button", { name: "Unsubscribe" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That didn't go through. Try again in a moment. Or email support@fixture.example and we’ll take you off by hand."
    )
    expect(screen.getByRole("link", { name: "support@fixture.example" })).toHaveAttribute(
      "href",
      "mailto:support@fixture.example"
    )
    expect(screen.getByRole("button", { name: "Unsubscribe" })).toBeEnabled()
  })
})
