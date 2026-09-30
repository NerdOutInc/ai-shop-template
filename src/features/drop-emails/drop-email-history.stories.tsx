import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { expect } from "storybook/test"

import { DropEmailHistory } from "./drop-email-history"

const meta = {
  title: "Admin/Drop email history",
  component: DropEmailHistory,
  parameters: { layout: "padded" },
  args: {
    entries: [
      {
        liveAt: "2026-10-12T09:00:00.000Z",
        subject: "New this week: Fern Study",
        productCount: 1,
        recipients: 14,
        sent: 11,
        pending: 1,
        failed: 1,
        unsubscribed: 1,
        firstSentAt: "2026-10-12T14:05:02.000Z",
        lastSentAt: "2026-10-12T14:05:30.000Z",
      },
      {
        liveAt: "2026-10-05T09:00:00.000Z",
        subject: "New this week: Abstract Lines",
        productCount: 2,
        recipients: 12,
        sent: 12,
        pending: 0,
        failed: 0,
        unsubscribed: 0,
        firstSentAt: "2026-10-05T14:05:01.000Z",
        lastSentAt: "2026-10-05T14:05:20.000Z",
      },
    ],
  },
} satisfies Meta<typeof DropEmailHistory>

export default meta
type Story = StoryObj<typeof meta>

export const SentSoFar: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole("listitem")).toHaveLength(2)
    await expect(canvas.getByText("1 still sending · 1 failed · 1 unsubscribed before it reached them")).toBeVisible()
  },
}

export const NothingYet: Story = {
  args: { entries: [] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/No drop emails yet/)).toBeVisible()
  },
}
