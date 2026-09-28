import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { expect, fn, userEvent } from "storybook/test"

import { Button, buttonVariants } from "./button"

const meta = {
  title: "UI/Button",
  component: Button,
  args: {
    children: "Join the list",
    onClick: fn(),
  },
} satisfies Meta<typeof Button>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvas, args }) => {
    const button = canvas.getByRole("button", { name: "Join the list" })

    await userEvent.click(button)
    await expect(args.onClick).toHaveBeenCalledOnce()
  },
}

export const Keyboard: Story = {
  args: {
    variant: "outline",
  },
  play: async ({ canvas, args }) => {
    const button = canvas.getByRole("button", { name: "Join the list" })

    await userEvent.tab()
    await expect(button).toHaveFocus()
    await userEvent.keyboard("{Enter}")
    await expect(args.onClick).toHaveBeenCalledOnce()
  },
}

export const Disabled: Story = {
  args: {
    disabled: true,
    children: "Taking a rest day",
  },
  play: async ({ canvas, args }) => {
    const button = canvas.getByRole("button", { name: "Taking a rest day" })

    await expect(button).toBeDisabled()
    await userEvent.tab()
    await expect(button).not.toHaveFocus()
    await userEvent.keyboard("{Enter}")
    await expect(args.onClick).not.toHaveBeenCalled()
  },
}

export const AsLink: Story = {
  args: {
    variant: "secondary",
    children: "About the store",
  },
  render: (args) => (
    <a className={buttonVariants({ variant: args.variant })} href="#brand-story">
      {args.children}
    </a>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("link", { name: "About the store" })).toHaveAttribute("href", "#brand-story")
    await expect(canvas.queryByRole("button")).not.toBeInTheDocument()
  },
}
