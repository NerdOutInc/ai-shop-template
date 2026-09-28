import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { GarmentSetupNotice } from "./garment-setup-notice"

describe("GarmentSetupNotice", () => {
  it("links to the garment's own card and names it once it has a name", () => {
    render(<GarmentSetupNotice blueprintId={1312} label="Next Level 5080" productTitle="Crop Life" />)
    expect(screen.getByText(/^Garment setup missing\./)).toBeVisible()
    expect(screen.getByRole("link", { name: "Set up Next Level 5080 for Crop Life" })).toHaveAttribute(
      "href",
      "/admin/products/garments#garment-1312"
    )
  })

  // A blueprint found on a published product has no row yet, so its number is all there is to say.
  it.each([null, "", "   "])("falls back to the blueprint number when the label is %j", (label) => {
    render(<GarmentSetupNotice blueprintId={9999} label={label} productTitle="Crop Life" />)
    expect(screen.getByRole("link", { name: "Set up blueprint 9999 for Crop Life" })).toHaveAttribute(
      "href",
      "/admin/products/garments#garment-9999"
    )
  })

  // No readable blueprint means no card to land on; a "#garment-null" target would go nowhere.
  it("links to the page itself when the product names no blueprint", () => {
    render(<GarmentSetupNotice blueprintId={null} label={null} productTitle="Mystery Tee" />)
    expect(screen.getByRole("link", { name: "Open Garment models for Mystery Tee" })).toHaveAttribute(
      "href",
      "/admin/products/garments"
    )
  })

  it("takes an id so a disabled control can point at it as its reason", () => {
    render(<GarmentSetupNotice id="why-not" blueprintId={9999} label={null} productTitle="Crop Life" />)
    expect(document.getElementById("why-not")).toHaveTextContent("Garment setup missing.")
  })
})
