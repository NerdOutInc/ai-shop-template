import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { storeConfig } from "@/lib/store-config"

import { StoreDataDisclosures } from "./store-data-disclosures"

vi.mock("server-only", () => ({}))
const settings = vi.hoisted(() => ({ ORDER_ALERTS_ENABLED: "false" }))
vi.mock("@/lib/env", () => ({ env: settings }))
vi.mock("@/lib/store-config", () => ({
  storeConfig: {
    configured: true,
    policies: { published: true },
    features: { dropSignup: false },
    privacy: { retainedDropSubscribers: false },
  },
}))

beforeEach(() => {
  settings.ORDER_ALERTS_ENABLED = "false"
  storeConfig.configured = true
  storeConfig.policies.published = true
  storeConfig.features.dropSignup = false
  storeConfig.privacy.retainedDropSubscribers = false
})

describe("store data processors", () => {
  it("names hosting and database processors without inventing subscriber collection", () => {
    render(<StoreDataDisclosures />)
    expect(screen.getByText(/Vercel processes website requests/)).toHaveTextContent(
      "Supabase stores order and delivery records"
    )
    expect(screen.queryByText(/design-drop signup addresses/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Resend/)).not.toBeInTheDocument()
  })

  it.each(["open", "retained"])("discloses signup data in the database for an %s list", (state) => {
    storeConfig.features.dropSignup = state === "open"
    storeConfig.privacy.retainedDropSubscribers = state === "retained"
    render(<StoreDataDisclosures />)
    expect(screen.getByText(/Supabase stores/)).toHaveTextContent(
      "design-drop signup addresses, signup IPs, and consent records"
    )
  })

  it("keeps unconfigured collection conditional without claiming stored subscribers", () => {
    storeConfig.configured = false
    storeConfig.features.dropSignup = true
    render(<StoreDataDisclosures />)
    expect(screen.getByText(/When hosting and database services are connected/)).toBeVisible()
    expect(screen.queryByText(/design-drop signup addresses/)).not.toBeInTheDocument()
  })

  it("does not claim signup records while a never-opened form awaits policy publication", () => {
    storeConfig.features.dropSignup = true
    storeConfig.policies.published = false
    render(<StoreDataDisclosures />)
    expect(screen.queryByText(/design-drop signup addresses/)).not.toBeInTheDocument()
  })

  it("discloses the customer data in owner alert emails when alerts are enabled", () => {
    settings.ORDER_ALERTS_ENABLED = "true"
    render(<StoreDataDisclosures />)
    expect(screen.getByText(/Resend processes emails to the store owner/)).toHaveTextContent(
      "customer names and email addresses"
    )
    expect(screen.getByText(/Resend processes emails to the store owner/)).toHaveTextContent(
      "order items and totals, payment and fulfillment status, and order and payment references"
    )
    expect(screen.getByText(/Resend processes emails to the store owner/)).toHaveTextContent(
      "not marketing emails to customers"
    )
  })
})
