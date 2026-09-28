import Link from "next/link"
import { render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"

import { storeConfig } from "@/lib/store-config"

import { StoreFooter } from "./store-footer"

vi.mock("@/features/analytics/privacy-choices", () => ({ PrivacyChoices: () => null }))
vi.mock("./design-of-the-week-link", () => ({
  DesignOfTheWeekLink: () => <Link href="/#design-of-the-week">Design of the Week</Link>,
}))

it.each([false, true])("only advertises enabled optional destinations (%s)", (enabled) => {
  storeConfig.features.about = enabled
  storeConfig.features.designOfTheWeek = enabled
  render(<StoreFooter />)
  for (const name of ["About", "Design of the Week"]) {
    const link = screen.queryByRole("link", { name })
    if (enabled) expect(link).toBeVisible()
    else expect(link).not.toBeInTheDocument()
  }
  expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy")
})
