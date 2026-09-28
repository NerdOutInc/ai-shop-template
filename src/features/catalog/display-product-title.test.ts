import { afterEach, expect, it } from "vitest"
import { storeConfig } from "@/lib/store-config"
import { displayProductTitle } from "./display-product-title"

const originalName = storeConfig.name
afterEach(() => {
  storeConfig.name = originalName
})

it("uses a second brand's name literally, including regular-expression characters", () => {
  storeConfig.name = "Studio [A]+"
  expect(displayProductTitle("New Dawn — Studio [A]+ | Cotton tee")).toBe("New Dawn")
  expect(displayProductTitle("New Dawn — Studio A | Cotton tee")).toBe("New Dawn — Studio A | Cotton tee")
  expect(displayProductTitle("New Dawn — Your Store | Cotton tee")).toBe("New Dawn — Your Store | Cotton tee")
})
