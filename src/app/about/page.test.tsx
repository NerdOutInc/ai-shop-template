import type { ResolvingMetadata } from "next"
import { render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"

import { storeConfig } from "@/lib/store-config"

import AboutPage, { generateMetadata } from "./page"

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
}))

it("returns not found from the page and its metadata while About is disabled", async () => {
  storeConfig.features.about = false
  expect(() => AboutPage()).toThrow("NEXT_NOT_FOUND")
  await expect(generateMetadata({}, Promise.resolve({}) as ResolvingMetadata)).rejects.toThrow("NEXT_NOT_FOUND")
})

it("publishes the configured brand and canonical About metadata when enabled", async () => {
  storeConfig.features.about = true
  storeConfig.name = "Moon Garden"
  storeConfig.about.heading = "Made for night owls"
  render(<AboutPage />)
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("About Moon Garden")
  expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Made for night owls")
  const metadata = await generateMetadata({}, Promise.resolve({}) as ResolvingMetadata)
  expect(metadata.alternates?.canonical).toBe("/about")
  expect(metadata.openGraph).toMatchObject({ title: "About | Moon Garden" })
})
