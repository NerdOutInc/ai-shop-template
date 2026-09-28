import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"

import { Button } from "./button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip"

const meta = {
  title: "UI/Tooltip",
  component: Tooltip,
  render: () => (
    <TooltipProvider delay={0}>
      <Tooltip>
        <TooltipTrigger render={<Button variant="outline" />}>Rest day reminder</TooltipTrigger>
        <TooltipContent>More details appear here.</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ),
} satisfies Meta<typeof Tooltip>

export default meta

type Story = StoryObj<typeof meta>

export const Hover: Story = {
  play: async ({ canvas, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const trigger = canvas.getByRole("button", { name: "Rest day reminder" })

    await userEvent.hover(trigger)
    await waitFor(() => expect(body.getByText("More details appear here.", { exact: true })).toBeVisible())
    await userEvent.unhover(trigger)
    await waitFor(() => expect(body.queryByText("More details appear here.", { exact: true })).not.toBeInTheDocument())
  },
}

export const Keyboard: Story = {
  play: async ({ canvas, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const trigger = canvas.getByRole("button", { name: "Rest day reminder" })

    await userEvent.tab()
    await expect(trigger).toHaveFocus()
    await waitFor(() => expect(body.getByText("More details appear here.", { exact: true })).toBeVisible())
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(body.queryByText("More details appear here.", { exact: true })).not.toBeInTheDocument())
    await expect(trigger).toHaveFocus()
  },
}
