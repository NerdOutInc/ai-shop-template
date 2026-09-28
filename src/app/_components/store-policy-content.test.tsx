import { render, screen } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"

import { StorePolicyContent } from "./store-policy-content"

const config = vi.hoisted(() => ({
  configured: false,
  supportEmail: "owner@example.com",
  policies: { published: false },
}))
vi.mock("@/lib/store-config", () => ({ storeConfig: config }))
beforeEach(() => {
  config.configured = false
  config.policies.published = false
})

it("keeps draft promises and placeholder contact details out of public policy pages", () => {
  render(<StorePolicyContent paragraphs={["Unapproved refund promise"]} />)
  expect(screen.getByRole("status")).toHaveTextContent("preparing its policies")
  expect(screen.queryByText("Unapproved refund promise")).not.toBeInTheDocument()
  expect(screen.queryByRole("link")).not.toBeInTheDocument()
})

it("shows approved owner text and the configured contact", () => {
  config.configured = true
  config.policies.published = true
  render(<StorePolicyContent paragraphs={["Approved policy text"]} />)
  expect(screen.getByText("Approved policy text")).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "owner@example.com" })).toHaveAttribute("href", "mailto:owner@example.com")
})
