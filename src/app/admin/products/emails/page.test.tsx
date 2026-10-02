import { render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import AdminDropEmailsPage from "./page"

const mocks = vi.hoisted(() => ({
  env: { DROP_EMAILS_ENABLED: "true", VERCEL_ENV: "production" },
  requireAdmin: vi.fn(),
  confirmation: vi.fn(),
  setup: vi.fn(),
  overview: vi.fn(),
  next: vi.fn(),
}))
vi.mock("@/lib/env", () => ({ env: mocks.env }))
vi.mock("@/features/admin/require-admin.server", () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock("@/features/drop-emails/read-drop-email-setup.server", () => ({ readDropEmailSetup: mocks.setup }))
vi.mock("@/features/drop-emails/read-drop-email-overview.server", () => ({ readDropEmailOverview: mocks.overview }))
vi.mock("@/features/drop-emails/render-next-drop-email.server", () => ({ renderNextDropEmail: mocks.next }))

beforeEach(() => {
  mocks.confirmation.mockReturnValue({ sending: false, hourlyLimit: 20 })
  mocks.env.DROP_EMAILS_ENABLED = "true"
  mocks.env.VERCEL_ENV = "production"
  mocks.requireAdmin.mockResolvedValue({ userId: "owner" })
  mocks.setup.mockReturnValue({
    missing: [],
    storeSettings: [],
    sending: true,
    from: "Fixture Store <drops@fixture.example>",
    postalAddress: "PO Box 123, Austin, TX 78701",
  })
  mocks.overview.mockResolvedValue({
    status: "ready",
    subscribed: 2,
    pending: 3,
    unsubscribed: 1,
    history: [
      {
        liveAt: "2026-10-05T09:00:00.000Z",
        subject: "New this week: Abstract Lines",
        productCount: 2,
        recipients: 2,
        sent: 2,
        pending: 0,
        failed: 0,
        unsubscribed: 0,
        firstSentAt: "2026-10-05T14:05:01.000Z",
        lastSentAt: "2026-10-05T14:05:02.000Z",
      },
    ],
  })
  mocks.next.mockResolvedValue({
    status: "ready",
    liveAt: "2026-10-12T09:00:00.000Z",
    sendAt: "2026-10-12T14:00:00.000Z",
    productCount: 1,
    subject: "New this week: Fern Study",
    html: "<p>Fern Study</p>",
    text: "Fern Study",
  })
})

describe("admin drop emails page", () => {
  it("reads nothing for a visitor the admin gate turns away", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("NEXT_REDIRECT"))
    await expect(AdminDropEmailsPage()).rejects.toThrow("NEXT_REDIRECT")
    expect(mocks.overview).not.toHaveBeenCalled()
    expect(mocks.next).not.toHaveBeenCalled()
  })

  it("shows sending, the list size, the next email, and what went out", async () => {
    render(await AdminDropEmailsPage())
    expect(screen.getByRole("heading", { level: 1, name: "Drop emails" })).toBeVisible()
    expect(screen.getByRole("link", { name: "Drop emails" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("heading", { name: "Sending is on" })).toBeVisible()
    expect(screen.getByText("Emails go out from Fixture Store <drops@fixture.example>.")).toBeVisible()
    expect(screen.getByText("2 eligible · 3 awaiting confirmation · 1 unsubscribed")).toBeVisible()
    expect(screen.getByText("For the Monday, October 12 drop, going out at 9:00 AM CDT.")).toBeVisible()
    expect(screen.getByText("New this week: Fern Study")).toBeVisible()
    expect(screen.getByTitle("Preview of the email for the Monday, October 12 drop")).toHaveAttribute(
      "src",
      "/api/admin/drop-emails/preview"
    )
    expect(screen.getByRole("button", { name: "Send a test to support@fixture.example" })).toBeEnabled()
    const history = within(screen.getByRole("list"))
    expect(history.getByText("New this week: Abstract Lines")).toBeVisible()
  })

  it("says exactly what is missing while sending is off", async () => {
    mocks.env.DROP_EMAILS_ENABLED = "false"
    mocks.setup.mockReturnValue({
      missing: ["STORE_POSTAL_ADDRESS"],
      storeSettings: ["features.designOfTheWeek"],
      sending: false,
      from: null,
      postalAddress: null,
    })
    mocks.env.VERCEL_ENV = "preview"
    render(await AdminDropEmailsPage())
    expect(screen.getByRole("heading", { name: "Sending is off" })).toBeVisible()
    expect(screen.getByText("Set STORE_POSTAL_ADDRESS in Vercel.")).toBeVisible()
    expect(screen.getByText("Set features.designOfTheWeek to true in src/lib/store-config-values.ts.")).toBeVisible()
    expect(screen.getByText("Drop emails only ever go out from the production site.")).toBeVisible()
    expect(screen.getByText("Set DROP_EMAILS_ENABLED to true when you're ready.")).toBeVisible()
    expect(screen.getByText(/going out at 9:00 AM CDT if sending is on by then\./)).toBeVisible()
  })

  it("keeps working when there is no next email, or the reads fail", async () => {
    mocks.next.mockResolvedValue({ status: "none" })
    mocks.overview.mockResolvedValue({ status: "unavailable" })
    render(await AdminDropEmailsPage())
    expect(screen.getByText(/Nothing is scheduled, so there's no email to preview\./)).toBeVisible()
    expect(screen.getByRole("link", { name: "Open the Shop lineup" })).toHaveAttribute("href", "/admin/products")
    expect(screen.getByRole("button", { name: /Send a test/ })).toBeDisabled()
    expect(screen.getByText("The send history is unavailable right now.")).toBeVisible()
    expect(screen.queryByTitle(/Preview of the email/)).not.toBeInTheDocument()
  })
})

vi.mock("@/features/drop-signup/read-signup-confirmation-setup.server", () => ({
  readSignupConfirmationSetup: mocks.confirmation,
}))
it("distinguishes signup confirmation readiness from weekly sending", async () => {
  render(await AdminDropEmailsPage())
  expect(screen.getByRole("heading", { name: "Sending is on" })).toBeVisible()
  expect(screen.getByRole("heading", { name: "Signup confirmation sending is off" })).toBeVisible()
  expect(screen.getByText(/New signups are unavailable/)).toBeVisible()
})
