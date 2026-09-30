import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DropEmailTestSend } from "./drop-email-test-send"

afterEach(() => vi.unstubAllGlobals())

describe("DropEmailTestSend", () => {
  it("sends one test to the store's inbox and says where to look", async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ sent: true }))
    vi.stubGlobal("fetch", request)
    render(<DropEmailTestSend />)
    await userEvent.click(screen.getByRole("button", { name: "Send a test to support@fixture.example" }))
    expect(request).toHaveBeenCalledWith("/api/admin/drop-emails/test", { method: "POST", credentials: "same-origin" })
    expect(await screen.findByRole("status")).toHaveTextContent("Sent. Look for it in support@fixture.example")
  })

  it("passes the server's own explanation through", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "Email sending isn't set up yet." }, { status: 503 }))
    )
    render(<DropEmailTestSend />)
    await userEvent.click(screen.getByRole("button", { name: /Send a test/ }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Email sending isn't set up yet.")
  })

  it("explains why it cannot send rather than offering a button that only fails", () => {
    render(<DropEmailTestSend unavailableReason="A test needs an upcoming drop with products in it." />)
    const button = screen.getByRole("button", { name: /Send a test/ })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription("A test needs an upcoming drop with products in it.")
  })
})
