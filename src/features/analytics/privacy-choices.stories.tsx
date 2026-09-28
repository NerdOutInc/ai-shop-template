import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { expect, waitFor, within } from "storybook/test"

import { googleTag } from "./google-tag"
import { metaPixel } from "./meta-pixel"
import { PrivacyChoices } from "./privacy-choices"

const preferenceKey = "your-store-meta-consent-v1"

const meta = {
  title: "Analytics/Privacy choices",
  component: PrivacyChoices,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <main className="min-h-screen bg-[#f4f0e7] p-6 text-[#17262d]">
        <h1 className="font-display text-4xl">Made for your everyday.</h1>
        <p className="mt-4">Your shopping experience stays available whichever choice you make.</p>
        <footer className="mt-20">
          <nav aria-label="Footer navigation">
            <Story />
          </nav>
        </footer>
      </main>
    ),
  ],
  beforeEach: () => {
    const previous = localStorage.getItem(preferenceKey)
    const target = window as Window & { fbq?: unknown }
    const googleWindow = window as Window & { gtag?: unknown }
    const previousGoogle = localStorage.getItem("your-store-google-consent-v1")
    const previousTag = googleWindow.gtag
    googleWindow.gtag = () => undefined
    googleTag.configure({ enabled: true, tagId: "GT-TEST1234", canonicalOrigin: window.location.origin })
    googleTag.setConsent("denied")
    const previousPixel = target.fbq
    // An unmanaged stub keeps these UI stories from loading or contacting the real SDK.
    target.fbq = () => undefined
    localStorage.removeItem(preferenceKey)
    metaPixel.configure({ enabled: true, pixelId: "123456789012345", canonicalOrigin: window.location.origin })
    window.dispatchEvent(new StorageEvent("storage", { key: preferenceKey, newValue: null }))
    return () => {
      metaPixel.setConsent("denied")
      if (previous === null) localStorage.removeItem(preferenceKey)
      else localStorage.setItem(preferenceKey, previous)
      target.fbq = previousPixel
      googleWindow.gtag = previousTag
      googleTag.setConsent("denied")
      if (previousGoogle === null) localStorage.removeItem("your-store-google-consent-v1")
      else localStorage.setItem("your-store-google-consent-v1", previousGoogle)
    }
  },
} satisfies Meta<typeof PrivacyChoices>

export default meta
type Story = StoryObj<typeof meta>

export const ChooseMarketing: Story = {
  play: async ({ canvas, canvasElement, userEvent }) => {
    const page = within(canvasElement.ownerDocument.body)
    const trigger = canvas.getByRole("button", { name: "Privacy choices" })
    const region = page.getByRole("region", { name: "Your privacy choices" })
    const allow = page.getByRole("button", { name: "Allow Meta marketing cookies" })
    const decline = page.getByRole("button", { name: "Decline Meta" })
    await expect(region.closest("nav")).toBeNull()
    await expect(trigger).toHaveAttribute("aria-expanded", "true")
    await expect(trigger).toHaveAttribute("aria-controls", region.id)
    await expect(allow).toBeVisible()
    await expect(decline).toBeVisible()
    decline.focus()
    await userEvent.keyboard("{Enter}")
    await waitFor(() => expect(page.queryByRole("button", { name: "Decline Meta" })).not.toBeInTheDocument())
    await expect(trigger).toHaveAttribute("aria-expanded", "false")
    await userEvent.click(trigger)
    await expect(page.getByRole("heading", { name: "Your privacy choices" })).toHaveFocus()
    await expect(trigger).toHaveAttribute("aria-expanded", "true")
    await expect(page.getByText(/Meta marketing cookies are currently off/)).toBeVisible()
    await userEvent.click(page.getByRole("button", { name: "Close" }))
    await expect(trigger).toHaveAttribute("aria-expanded", "false")
    await expect(trigger).toHaveFocus()
  },
}

export const WithdrawPermission: Story = {
  play: async ({ canvas, canvasElement, userEvent }) => {
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.click(page.getByRole("button", { name: "Allow Meta marketing cookies" }))
    await userEvent.click(canvas.getByRole("button", { name: "Privacy choices" }))
    await expect(page.getByText(/Meta marketing cookies are currently allowed/)).toBeVisible()
    await userEvent.click(page.getByRole("button", { name: "Decline Meta" }))
    await expect(canvas.getByRole("button", { name: "Privacy choices" })).toHaveFocus()
    await expect(localStorage.getItem(preferenceKey)).toContain('"consent":"denied"')
  },
}

export const SeparateGoogleChoice: Story = {
  play: async ({ canvasElement, userEvent }) => {
    const page = within(canvasElement.ownerDocument.body)
    localStorage.removeItem("your-store-google-consent-v1")
    window.dispatchEvent(new StorageEvent("storage", { key: "your-store-google-consent-v1", newValue: null }))
    const metaGroup = within(page.getByRole("group", { name: "Meta marketing cookies" }))
    const googleGroup = within(page.getByRole("group", { name: "Google marketing cookies" }))
    await userEvent.click(metaGroup.getByRole("button", { name: "Decline Meta" }))
    await expect(page.getByRole("region", { name: "Your privacy choices" })).toBeVisible()
    await expect(googleTag.getSnapshot().consent).toBe("unknown")
    await userEvent.click(googleGroup.getByRole("button", { name: "Allow Google marketing cookies" }))
    await expect(page.queryByRole("region", { name: "Your privacy choices" })).not.toBeInTheDocument()
    await expect(metaPixel.getSnapshot().consent).toBe("denied")
    await expect(googleTag.getSnapshot().consent).toBe("granted")
    await userEvent.click(page.getByRole("button", { name: "Privacy choices" }))
    await expect(page.getByText("Google marketing cookies are currently allowed.", { exact: false })).toBeVisible()
  },
}
