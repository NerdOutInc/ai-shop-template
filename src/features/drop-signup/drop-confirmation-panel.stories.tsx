import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { expect, userEvent } from "storybook/test"
import { DropConfirmationPanel } from "./drop-confirmation-panel"

function answering(status: number) {
  return () => {
    const original = globalThis.fetch
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${"a".repeat(64)}`)
    globalThis.fetch = async () => Response.json({}, { status })
    return () => {
      globalThis.fetch = original
    }
  }
}
const meta = {
  title: "Drop signup/Confirmation",
  component: DropConfirmationPanel,
  parameters: { layout: "padded" },
  beforeEach: answering(200),
} satisfies Meta<typeof DropConfirmationPanel>
export default meta
type Story = StoryObj<typeof meta>
export const ConfirmsByKeyboard: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: "Confirm signup" })).toBeEnabled()
    await userEvent.tab()
    await expect(canvas.getByRole("button")).toHaveFocus()
    await userEvent.keyboard("{Enter}")
    await expect(await canvas.findByRole("heading", { name: "You're on the list" })).toHaveFocus()
  },
}
export const Expired: Story = {
  beforeEach: answering(410),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button"))
    await expect(await canvas.findByRole("heading", { name: "This link has expired" })).toHaveFocus()
  },
}
export const TemporaryFailure: Story = {
  beforeEach: answering(503),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button"))
    await expect(await canvas.findByRole("alert")).toBeVisible()
    await expect(canvas.getByRole("button")).toBeEnabled()
  },
}
export const ReopenEmailAfterReload: Story = {
  beforeEach: () => {
    window.history.replaceState(null, "", window.location.pathname)
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("heading", { name: "Open your email link again" })).toBeVisible()
    await expect(canvas.getByRole("status")).toHaveTextContent("You don't need to request another email.")
    await expect(canvas.queryByRole("button")).toBeNull()
  },
}
