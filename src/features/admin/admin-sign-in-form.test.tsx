import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { AdminSignInForm } from "./admin-sign-in-form"

const mocks = vi.hoisted(() => ({ action: vi.fn(), passkey: vi.fn(), replace: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }) }))
vi.mock("./admin-auth-action", () => ({ adminAuthAction: mocks.action }))
vi.mock("./create-admin-browser-client", () => ({
  createAdminBrowserClient: () => ({ auth: { signInWithPasskey: mocks.passkey } }),
}))

beforeEach(() => {
  mocks.action.mockResolvedValue({ ok: true, message: "Code sent" })
  mocks.passkey.mockResolvedValue({ error: { message: "cancelled" } })
})

it("keeps email sign-in usable after cancelling the passkey prompt", async () => {
  render(<AdminSignInForm />)
  fireEvent.click(screen.getByRole("button", { name: "Sign in with a passkey" }))
  await screen.findByText(/Passkey sign-in was not completed/)
  const email = screen.getByLabelText("Email")
  fireEvent.change(email, { target: { value: "owner@example.test" } })
  fireEvent.submit(email.closest("form")!)
  const code = await screen.findByLabelText("Email verification code")
  expect(mocks.action).toHaveBeenCalledWith(
    expect.objectContaining({ operation: "request-email", email: "owner@example.test" })
  )
  mocks.action.mockResolvedValue({ ok: true, message: "Signed in", destination: "/admin/concepts" })
  fireEvent.change(code, { target: { value: "123456" } })
  fireEvent.submit(code.closest("form")!)
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/admin/concepts"))
})

it("does not show setup success or navigate after server rejection", async () => {
  mocks.action.mockResolvedValue({ ok: false, message: "Owner setup could not be verified" })
  render(<AdminSignInForm setup />)
  expect(screen.queryByRole("button", { name: "Sign in with a passkey" })).not.toBeInTheDocument()
  const email = screen.getByLabelText("Owner email")
  fireEvent.change(email, { target: { value: "other@example.test" } })
  fireEvent.change(screen.getByLabelText("One-time setup key"), { target: { value: "x".repeat(32) } })
  fireEvent.submit(email.closest("form")!)
  await screen.findByText("Owner setup could not be verified")
  expect(screen.queryByLabelText("Email verification code")).not.toBeInTheDocument()
  expect(mocks.replace).not.toHaveBeenCalled()
})

it("returns to the exact order after successful sign-in", async () => {
  const destination = "/admin/orders?order=6224014e-39f1-4dfb-9198-824768f4b53f"
  mocks.passkey.mockResolvedValue({ error: null })
  mocks.action.mockResolvedValue({ ok: true, message: "Signed in", destination: "/admin/concepts" })
  render(<AdminSignInForm returnTo={destination} />)
  fireEvent.click(screen.getByRole("button", { name: "Sign in with a passkey" }))
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(destination))
})
