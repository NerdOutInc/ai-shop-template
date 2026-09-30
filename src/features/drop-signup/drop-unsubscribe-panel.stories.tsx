import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { expect, userEvent } from "storybook/test"

import { storeConfig } from "@/lib/store-config"

import { DropUnsubscribePanel } from "./drop-unsubscribe-panel"

/** Answers the unsubscribe request with `body` and `status`; nothing leaves the page. */
function answering(body: unknown, status = 200) {
  return () => {
    const original = globalThis.fetch
    globalThis.fetch = async () => Response.json(body, { status })
    return () => {
      globalThis.fetch = original
    }
  }
}

const meta = {
  title: "Drop signup/Unsubscribe",
  component: DropUnsubscribePanel,
  parameters: { layout: "padded" },
  args: { token: "5f0b2c4e-8a51-4d8e-9a57-2c1f7f3b9d10" },
  beforeEach: answering({ unsubscribed: true }),
} satisfies Meta<typeof DropUnsubscribePanel>

export default meta
type Story = StoryObj<typeof meta>

export const Unsubscribes: Story = {
  play: async ({ canvas }) => {
    // By keyboard: the button goes away on success, so focus has to land on what replaced it.
    await userEvent.tab()
    await expect(canvas.getByRole("button", { name: "Unsubscribe" })).toHaveFocus()
    await userEvent.keyboard("{Enter}")
    await expect(await canvas.findByRole("heading", { level: 1, name: "You’re off the list." })).toHaveFocus()
    await userEvent.tab()
    await expect(canvas.getByRole("link", { name: storeConfig.home.shopLabel })).toHaveFocus()
  },
}

export const DidNotGoThrough: Story = {
  beforeEach: answering({ error: "That didn't go through. Try again in a moment." }, 503),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Unsubscribe" }))
    await expect(await canvas.findByRole("alert")).toHaveTextContent("take you off by hand")
    await expect(canvas.getByRole("button", { name: "Unsubscribe" })).toBeEnabled()
  },
}

/** Someone the list already shows as gone: an old email's link, or a no-JavaScript post come back. */
export const AlreadyDone: Story = {
  args: { done: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("heading", { level: 1, name: "You’re off the list." })).toBeVisible()
  },
}
