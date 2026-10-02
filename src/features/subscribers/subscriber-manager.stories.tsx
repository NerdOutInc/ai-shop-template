import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { expect, userEvent } from "storybook/test"
import { SubscriberManager } from "./subscriber-manager"
import type { SubscriberRecord } from "./subscriber-record"

const record: SubscriberRecord = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "shopper@example.com",
  state: "legacy",
  eligible: true,
  source: "footer",
  consentVersion: "v1",
  signupIp: "203.0.113.7",
  createdAt: "2026-09-20T12:00:00Z",
  consentedAt: "2026-09-20T12:00:00Z",
  confirmedAt: null,
  unsubscribedAt: null,
  lastUnsubscribedAt: null,
  updatedAt: "2026-09-20 12:00:00+00",
  deliveries: 1,
  confirmations: 0,
}
const meta = {
  title: "Admin/Subscribers",
  component: SubscriberManager,
  parameters: { layout: "padded" },
  beforeEach: () => {
    const original = globalThis.fetch
    globalThis.fetch = async (_url, init) => {
      const input = JSON.parse(String(init?.body)) as { action: string }
      return Response.json({
        subscriber:
          input.action === "unsubscribe"
            ? { ...record, unsubscribedAt: new Date().toISOString(), eligible: false }
            : record,
      })
    }
    return () => {
      globalThis.fetch = original
    }
  },
} satisfies Meta<typeof SubscriberManager>
export default meta
type Story = StoryObj<typeof meta>
export const LookupAndUnsubscribe: Story = {
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByLabelText("Subscriber email"), record.email)
    await userEvent.click(canvas.getByRole("button", { name: "Look up subscriber" }))
    await expect(await canvas.findByText("Legacy consent")).toBeVisible()
    await userEvent.click(canvas.getByText("Consent evidence"))
    await expect(
      canvas.getByText("We'll email you when a new design drops. Nothing else, and you can stop any time.")
    ).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: /^Unsubscribe$/ }))
    const confirmation = await canvas.findByRole("button", { name: "Confirm unsubscribe" })
    await expect(confirmation).toHaveFocus()
    await expect(canvas.getByText("Legacy consent")).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: "Cancel unsubscribe" }))
    await expect(canvas.getByRole("button", { name: /^Unsubscribe$/ })).toHaveFocus()
    await userEvent.click(canvas.getByRole("button", { name: /^Unsubscribe$/ }))
    await userEvent.click(await canvas.findByRole("button", { name: "Confirm unsubscribe" }))
    await expect(await canvas.findByRole("button", { name: "Keep unsubscribed / revoke new links" })).toBeEnabled()
  },
}
