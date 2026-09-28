import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { AgentGrantControls } from "./agent-grant-controls"
const { action, refresh } = vi.hoisted(() => ({ action: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
vi.mock("./agent-grant-action", () => ({ agentGrantAction: action }))
beforeEach(() => vi.clearAllMocks())
describe("private agent grant controls", () => {
  it("shows only one credential delivery panel and sends exactly the selected scopes", async () => {
    const user = userEvent.setup(),
      token = "private-token-only-for-test"
    action.mockResolvedValue({
      ok: true,
      message: "Save this credential now.",
      credential: { id: "grant", token, expiresAt: "2026-09-15T00:00:00Z" },
    })
    render(<AgentGrantControls grants={[]} />)
    await user.click(screen.getByLabelText("Create product drafts"))
    await user.click(screen.getByRole("button", { name: "Create agent access" }))
    expect(action).toHaveBeenCalledWith({
      operation: "issue",
      label: "Design agent",
      hours: 24,
      scopes: ["library:read", "library:write"],
    })
    expect(await screen.findByRole("region", { name: "Save agent credential" })).toBeInTheDocument()
    expect(screen.queryByText(token)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Create agent access" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "I saved it" }))
    expect(screen.queryByRole("region", { name: "Save agent credential" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Create agent access" })).toBeEnabled()
  })
  it("keeps failed issuance visible and allows explicit revocation of an existing grant", async () => {
    const user = userEvent.setup()
    action
      .mockResolvedValueOnce({ ok: false, message: "Current administrator access is required." })
      .mockResolvedValueOnce({ ok: true, message: "Agent access revoked." })
    render(
      <AgentGrantControls
        grants={[
          {
            id: "grant-id",
            label: "Helper",
            scopes: ["library:read"],
            createdAt: "2026-09-14T00:00:00Z",
            expiresAt: "2026-09-15T00:00:00Z",
            revokedAt: null,
          },
        ]}
      />
    )
    await user.click(screen.getByRole("button", { name: "Create agent access" }))
    expect(await screen.findByRole("status")).toHaveTextContent("Current administrator access")
    expect(screen.queryByRole("region", { name: "Save agent credential" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Revoke" }))
    expect(action).toHaveBeenLastCalledWith({ operation: "revoke", id: "grant-id" })
    expect(refresh).toHaveBeenCalled()
  })
  it("offers no retired design-scheduling permission and keeps new grants focused on library and draft work", async () => {
    const user = userEvent.setup()
    action.mockResolvedValue({ ok: false, message: "Fixture" })
    render(<AgentGrantControls grants={[]} />)
    expect(screen.queryByLabelText("Schedule the week's drop (changes what shoppers see)")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Create agent access" }))
    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: ["library:read", "library:write", "drafts:create"] })
    )
    const note = screen.getByText(/Choose individual published products/)
    expect(note).toHaveTextContent(
      "Grants cannot publish products: drafts they create stay unpublished in Printify until you publish them."
    )
    expect(note).toHaveTextContent("Choose individual published products for Design of the Week from Products.")
  })
})
