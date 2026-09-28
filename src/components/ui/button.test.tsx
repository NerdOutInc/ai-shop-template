import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { Button } from "./button"

describe("Button", () => {
  it("preserves a consumer's form behavior", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())

    render(
      <form onSubmit={onSubmit}>
        <Button type="button">Open size guide</Button>
        <Button type="submit">Continue</Button>
      </form>
    )

    await user.click(screen.getByRole("button", { name: "Open size guide" }))
    expect(onSubmit).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Continue" }))
    expect(onSubmit).toHaveBeenCalledOnce()
  })
})
