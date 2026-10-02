const confirmation = vi.hoisted(() => ({ sending: true }))
import { render, screen } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"

import { storeConfig } from "@/lib/store-config"

import HomePage from "./page"

vi.mock("./_components/store-structured-data", () => ({ StoreStructuredData: () => null }))
vi.mock("./_components/design-of-the-week", () => ({ DesignOfTheWeek: () => <div>Weekly selection</div> }))
vi.mock("@/features/drop-signup/drop-signup-form", () => ({ DropSignupForm: () => <div>Drop signup</div> }))

beforeEach(() => {
  confirmation.sending = true
  storeConfig.configured = true
  storeConfig.policies.published = true
  storeConfig.features.designOfTheWeek = false
  storeConfig.features.dropSignup = false
})

it("keeps the home page and shop link without optional features", async () => {
  render(await HomePage())
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(storeConfig.home.headline)
  expect(screen.getByRole("link", { name: storeConfig.home.shopLabel })).toHaveAttribute("href", "/shop")
  expect(screen.queryByText("Weekly selection")).not.toBeInTheDocument()
  expect(screen.queryByText("Drop signup")).not.toBeInTheDocument()
})

it("offers signup independently of the weekly feature", async () => {
  storeConfig.features.dropSignup = true
  render(await HomePage())
  expect(screen.getByRole("region", { name: "New design updates" })).toHaveTextContent("Drop signup")
  expect(screen.queryByText("Weekly selection")).not.toBeInTheDocument()
})

it("mounts the weekly feature without a second signup form", async () => {
  storeConfig.features.designOfTheWeek = true
  storeConfig.features.dropSignup = true
  render(await HomePage())
  expect(screen.getByRole("region", { name: "Design of the week" })).toHaveTextContent("Weekly selection")
  expect(screen.queryByRole("region", { name: "New design updates" })).not.toBeInTheDocument()
})

it("withholds independent signup before policy approval", async () => {
  storeConfig.features.dropSignup = true
  storeConfig.policies.published = false
  render(await HomePage())
  expect(screen.queryByText("Drop signup")).not.toBeInTheDocument()
})

vi.mock("@/features/drop-signup/read-signup-confirmation-setup.server", () => ({
  readSignupConfirmationSetup: () => ({ sending: confirmation.sending }),
}))

it("hides the signup invitation when confirmation sending is unavailable", async () => {
  confirmation.sending = false
  storeConfig.features.dropSignup = true
  render(await HomePage())
  expect(screen.queryByText("Drop signup")).not.toBeInTheDocument()
})

vi.mock("next/server", () => ({ connection: vi.fn() }))
