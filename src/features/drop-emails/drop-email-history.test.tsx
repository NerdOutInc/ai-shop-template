import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { DropEmailHistory } from "./drop-email-history"
import type { DropEmailHistoryEntry } from "./drop-email-history-entry"

const entry = (overrides: Partial<DropEmailHistoryEntry> = {}): DropEmailHistoryEntry => ({
  liveAt: "2026-10-05T09:00:00.000Z",
  subject: "New this week: Abstract Lines",
  productCount: 2,
  recipients: 3,
  sent: 3,
  pending: 0,
  failed: 0,
  unsubscribed: 0,
  firstSentAt: "2026-10-05T14:05:01.000Z",
  lastSentAt: "2026-10-05T14:05:03.000Z",
  ...overrides,
})

describe("DropEmailHistory", () => {
  it("summarizes each drop email in the store's own time", () => {
    render(<DropEmailHistory entries={[entry()]} />)
    const item = within(screen.getByRole("listitem"))
    expect(item.getByRole("heading", { name: "Monday, October 5, 2026" })).toBeVisible()
    expect(item.getByText("New this week: Abstract Lines")).toBeVisible()
    expect(item.getByText("Sent to 3 of 3 subscribers. 2 products. First sent at 9:05 AM CDT.")).toBeVisible()
  })

  it("calls out anything that did not go out", () => {
    render(<DropEmailHistory entries={[entry({ sent: 1, pending: 1, failed: 2, unsubscribed: 1, recipients: 5 })]} />)
    expect(screen.getByText("1 still sending · 2 failed · 1 unsubscribed before it reached them")).toBeVisible()
  })

  it("says plainly when there is no history, or nobody to send to", () => {
    const { unmount } = render(<DropEmailHistory entries={[]} />)
    expect(screen.getByText(/No drop emails yet/)).toBeVisible()
    unmount()
    render(<DropEmailHistory entries={[entry({ recipients: 0, sent: 0, firstSentAt: null, productCount: 1 })]} />)
    expect(screen.getByText("No recipient records remain. 1 product.")).toBeVisible()
  })
})
