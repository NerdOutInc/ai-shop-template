import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { storeConfig } from "@/lib/store-config"

import { dropConsentCopy } from "./drop-consent-copy"
import { DropSignupForm } from "./drop-signup-form"

vi.mock("@/lib/store-config", () => ({
  storeConfig: {
    configured: true,
    policies: { published: true },
    features: { dropSignup: true },
    supportEmail: "help@sample.test",
  },
}))

beforeEach(() => {
  storeConfig.configured = true
  storeConfig.policies.published = true
  storeConfig.features.dropSignup = true
  storeConfig.supportEmail = "help@sample.test"
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const field = () => screen.getByLabelText("Know when the next one drops")
const submit = () => screen.getByRole("button", { name: /Keep me posted|Signing up/ })

describe("DropSignupForm", () => {
  it("sends the address with the surface that collected it, and says so", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ subscribed: true }) })
    vi.stubGlobal("fetch", request)
    render(<DropSignupForm source="design-of-the-week" />)
    await userEvent.type(field(), "shopper@example.com")
    await userEvent.click(submit())

    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      email: "shopper@example.com",
      source: "design-of-the-week",
      company: "",
    })
    expect(await screen.findByText("You're on the list. See you at the next drop.")).toBeInTheDocument()
    // The field clears so a second person on a shared screen does not resend the first one's address.
    expect(field()).toHaveValue("")
  })

  it("passes the server's own refusal through rather than inventing one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ error: "That's a few tries in a row. Give it a few minutes." }),
      })
    )
    render(<DropSignupForm source="footer" />)
    await userEvent.type(field(), "shopper@example.com")
    await userEvent.click(submit())
    expect(await screen.findByRole("alert")).toHaveTextContent("Give it a few minutes")
  })

  it("says something useful when the request never lands", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")))
    render(<DropSignupForm source="home" />)
    await userEvent.type(field(), "shopper@example.com")
    await userEvent.click(submit())
    expect(await screen.findByRole("alert")).toHaveTextContent("Check your connection")
  })

  // Before hydration the browser submits the form itself, and a `get` would put the address in the URL.
  it("posts, so a submit that beats hydration keeps the address out of the page URL", () => {
    const { container } = render(<DropSignupForm source="footer" />)
    expect(container.querySelector("form")).toHaveAttribute("method", "post")
  })

  // A visitor never sees it, so it must not be announced, focusable, or fail an audit.
  it("hides the honeypot from everyone except a script", () => {
    const { container } = render(<DropSignupForm source="footer" />)
    const honeypot = container.querySelector('input[name="company"]')
    expect(honeypot).not.toBeNull()
    expect(honeypot).not.toBeVisible()
    expect(honeypot).toHaveAttribute("tabindex", "-1")
    expect(honeypot!.closest("[aria-hidden='true']")).not.toBeNull()
    // The property that matters is absence from the ACCESSIBILITY TREE, which is what a screen
    // reader and an axe audit walk; queryByLabelText would find it either way.
    expect(screen.queryByRole("textbox", { name: "Company" })).not.toBeInTheDocument()
    expect(screen.getAllByRole("textbox")).toHaveLength(1)
  })

  it("tells the visitor exactly what they are agreeing to, beside the field", () => {
    render(<DropSignupForm source="design-of-the-week" />)
    expect(dropConsentCopy.version).toBe("v2")
    expect(field()).toHaveAccessibleDescription(expect.stringContaining(dropConsentCopy.text))
    expect(screen.getByRole("link", { name: "Email help@sample.test to request removal" })).toHaveAttribute(
      "href",
      "mailto:help@sample.test?subject=Remove%20me%20from%20design-drop%20emails"
    )
    expect(screen.getByRole("link", { name: "privacy policy" })).toHaveAttribute("href", "/privacy")
    expect(screen.queryByText(/you can stop any time/)).not.toBeInTheDocument()
  })

  it("uses the current store's removal contact", () => {
    storeConfig.supportEmail = "hello@another-brand.test"
    render(<DropSignupForm source="footer" />)
    expect(screen.getByRole("link", { name: "Email hello@another-brand.test to request removal" })).toHaveAttribute(
      "href",
      "mailto:hello@another-brand.test?subject=Remove%20me%20from%20design-drop%20emails"
    )
  })

  it.each(["unconfigured", "unreviewed policies", "disabled feature"])("does not invite signups for %s", (state) => {
    if (state === "unconfigured") storeConfig.configured = false
    if (state === "unreviewed policies") storeConfig.policies.published = false
    if (state === "disabled feature") storeConfig.features.dropSignup = false
    const { container } = render(<DropSignupForm source="footer" />)
    expect(container).toBeEmptyDOMElement()
  })

  it("does not send twice while a send is in flight", async () => {
    const request = vi.fn(() => new Promise(() => {}))
    vi.stubGlobal("fetch", request)
    render(<DropSignupForm source="footer" />)
    await userEvent.type(field(), "shopper@example.com")
    await userEvent.click(submit())
    expect(submit()).toBeDisabled()
    expect(request).toHaveBeenCalledTimes(1)
  })
})
