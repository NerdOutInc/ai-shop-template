import { cleanup, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { dropConsentCopy } from "@/features/drop-signup/drop-consent-copy"
import { storeConfig } from "@/lib/store-config"

import PrivacyPage from "./page"

vi.mock("server-only", () => ({}))
const environment = vi.hoisted(() => ({ ORDER_ALERTS_ENABLED: "false", DROP_EMAILS_ENABLED: "false" }))
vi.mock("@/lib/env", () => ({ env: environment }))

vi.mock("@/lib/store-config", () => ({
  storeConfig: {
    name: "Sample Store",
    configured: true,
    policies: { published: true, privacyText: ["Owner-reviewed additional privacy information."] },
    features: { dropSignup: true, designOfTheWeek: true },
    privacy: { retainedDropSubscribers: false, retainedDropEmailRecords: false },
    supportEmail: "help@sample.test",
  },
}))
vi.mock("./_components/google-privacy-section", () => ({ GooglePrivacySection: () => null }))
vi.mock("./_components/meta-privacy-section", () => ({ MetaPrivacySection: () => null }))

beforeEach(() => {
  environment.DROP_EMAILS_ENABLED = "false"
  storeConfig.features.designOfTheWeek = true
  storeConfig.configured = true
  storeConfig.policies.published = true
  storeConfig.features.dropSignup = true
  storeConfig.privacy.retainedDropSubscribers = false
  storeConfig.privacy.retainedDropEmailRecords = false
  storeConfig.supportEmail = "help@sample.test"
})

describe("privacy disclosures", () => {
  it("keeps implementation disclosures alongside the owner's supplemental policy", () => {
    render(<PrivacyPage />)
    expect(screen.getByText("Owner-reviewed additional privacy information.")).toBeVisible()
    expect(screen.getByRole("heading", { name: "Orders and support" })).toBeVisible()
    expect(screen.getByRole("heading", { name: "Browser storage and checkout recovery" })).toBeVisible()
    expect(screen.getByText(/a payment-return reference lasts up to 30 days/)).toBeVisible()
    expect(screen.getByText(/bounded campaign labels/)).toBeVisible()
    expect(screen.getByText(/do not switch off the separate Vercel measurement/)).toBeVisible()
    expect(screen.getByText(/signup IP address/)).toBeVisible()
    expect(screen.getByText(/Signing up again requests fresh inbox confirmation/)).toBeVisible()
    expect(screen.getByText(`The signup form’s current consent wording is: “${dropConsentCopy.text}”`)).toBeVisible()
  })

  it("describes drop emails, their provider and their unsubscribe link while they are sent", () => {
    storeConfig.privacy.retainedDropEmailRecords = true
    environment.DROP_EMAILS_ENABLED = "true"
    render(<PrivacyPage />)
    expect(
      screen.getByText(/the store emails subscribers about it once\. Those are the only marketing messages/)
    ).toBeVisible()
    expect(screen.getByText(/Every drop email has an unsubscribe link/)).toBeVisible()
    expect(
      screen.getByText(/Resend, the store’s email provider, which receives each recipient’s address/)
    ).toBeVisible()
    expect(screen.getByText(/the label identifies the email, not you/)).toBeVisible()
  })

  // Pausing sends leaves the delivery history in place, so its disclosure stays too.
  it("keeps disclosing retained delivery records while sending is paused", () => {
    storeConfig.privacy.retainedDropEmailRecords = true
    render(<PrivacyPage />)
    expect(screen.getByText(/The store is not sending drop emails right now\./)).toBeVisible()
    expect(screen.getByText(/keeps a record of which drop emails it has sent to each subscriber/)).toBeVisible()
    expect(screen.queryByText(/emails subscribers about it once/)).not.toBeInTheDocument()

    cleanup()
    environment.DROP_EMAILS_ENABLED = "true"
    storeConfig.features.designOfTheWeek = false
    render(<PrivacyPage />)
    expect(screen.getByText(/The store is not sending drop emails right now\./)).toBeVisible()
  })

  it("keeps describing drop emails to a closed list that still receives them", () => {
    storeConfig.privacy.retainedDropEmailRecords = true
    environment.DROP_EMAILS_ENABLED = "true"
    storeConfig.features.dropSignup = false
    storeConfig.privacy.retainedDropSubscribers = true
    render(<PrivacyPage />)
    expect(screen.getByText(/New signups are currently closed/)).toBeVisible()
    expect(screen.getByText(/the store emails subscribers about it once/)).toBeVisible()
  })

  it("never claims to send while the policies that gate sending are unpublished", () => {
    storeConfig.privacy.retainedDropEmailRecords = true
    environment.DROP_EMAILS_ENABLED = "true"
    storeConfig.features.dropSignup = false
    storeConfig.privacy.retainedDropSubscribers = true
    storeConfig.policies.published = false
    render(<PrivacyPage />)
    expect(screen.getByText(/The store is not sending drop emails right now\./)).toBeVisible()
  })

  it("says nothing about drop emails for a store that keeps no delivery records", () => {
    environment.DROP_EMAILS_ENABLED = "true"
    render(<PrivacyPage />)
    expect(screen.getByRole("heading", { name: "Design-drop emails" })).toBeVisible()
    expect(screen.queryByText(/Resend, the store’s email provider/)).not.toBeInTheDocument()
    expect(screen.queryByText(/drop emails right now/)).not.toBeInTheDocument()
  })

  it("keeps the manual removal path available after new signups are disabled", () => {
    storeConfig.features.dropSignup = false
    storeConfig.privacy.retainedDropSubscribers = true
    storeConfig.supportEmail = "support@another-brand.test"
    render(<PrivacyPage />)
    expect(screen.getByText(/New signups are currently closed/)).toBeVisible()
    expect(screen.getByText(/signup IP address/)).toBeVisible()
    expect(screen.queryByText(/current consent wording/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Signing up again requests fresh inbox confirmation/)).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Email support@another-brand.test to request removal" })).toHaveAttribute(
      "href",
      "mailto:support@another-brand.test?subject=Remove%20me%20from%20design-drop%20emails"
    )
    expect(screen.getByText(/opening the email link does not remove an address automatically/)).toBeVisible()
  })

  it("omits signup disclosures and removal claims for a never-enabled list", () => {
    storeConfig.features.dropSignup = false
    render(<PrivacyPage />)
    expect(screen.queryByRole("heading", { name: "Design-drop emails" })).not.toBeInTheDocument()
    expect(screen.queryByText(/signup IP address/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Existing subscribers/)).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /request removal/ })).not.toBeInTheDocument()
  })

  it("does not describe a list when the form has never opened because policies are unpublished", () => {
    storeConfig.policies.published = false
    render(<PrivacyPage />)
    expect(screen.queryByRole("heading", { name: "Design-drop emails" })).not.toBeInTheDocument()
    expect(screen.queryByText(/signup IP/)).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /request removal/ })).not.toBeInTheDocument()
  })

  it("does not describe re-signup while policy publication closes the form", () => {
    storeConfig.policies.published = false
    storeConfig.privacy.retainedDropSubscribers = true
    render(<PrivacyPage />)
    expect(screen.getByText(/New signups are currently closed/)).toBeVisible()
    expect(screen.queryByText(/Signing up again requests fresh inbox confirmation/)).not.toBeInTheDocument()
    expect(screen.queryByText(/current consent wording/)).not.toBeInTheDocument()
  })

  it("does not publish placeholder signup contacts before the store is configured", () => {
    storeConfig.configured = false
    storeConfig.policies.published = false
    storeConfig.supportEmail = "support@example.com"
    render(<PrivacyPage />)
    expect(screen.getByRole("status")).toHaveTextContent("preparing its policies")
    expect(screen.queryByText("Owner-reviewed additional privacy information.")).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Design-drop emails" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /support@example.com/ })).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Browser storage and checkout recovery" })).toBeVisible()
  })
})
