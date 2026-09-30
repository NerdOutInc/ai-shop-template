import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { expect, userEvent } from "storybook/test"

import { DropEmailTestSend } from "./drop-email-test-send"

/** Answers the test-send request with `body` and `status`; nothing leaves the page. */
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
  title: "Admin/Drop email test send",
  component: DropEmailTestSend,
  parameters: { layout: "padded" },
  beforeEach: answering({ sent: true }),
} satisfies Meta<typeof DropEmailTestSend>

export default meta
type Story = StoryObj<typeof meta>

export const Sends: Story = {
  play: async ({ canvas }) => {
    // By keyboard: the owner reaches the button and presses Enter.
    await userEvent.tab()
    await expect(canvas.getByRole("button", { name: "Send a test to support@fixture.example" })).toHaveFocus()
    await userEvent.keyboard("{Enter}")
    await expect(await canvas.findByText(/Sent\. Look for it in support@fixture\.example/)).toBeVisible()
  },
}

export const NotSetUp: Story = {
  beforeEach: answering(
    { error: "Email sending isn't set up yet. Add RESEND_API_KEY and DROP_EMAIL_FROM_EMAIL in Vercel first." },
    503
  ),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: /Send a test/ }))
    await expect(await canvas.findByRole("alert")).toHaveTextContent("Email sending isn't set up yet.")
  },
}

export const NothingToSend: Story = {
  args: { unavailableReason: "A test needs an upcoming drop with products in it." },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: /Send a test/ })).toBeDisabled()
    await expect(canvas.getByText("A test needs an upcoming drop with products in it.")).toBeVisible()
  },
}
