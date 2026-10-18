import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getWeeklyHeroStore } from "@/features/weekly-heroes/get-weekly-hero-store.server"
import { readWeeklyHeroProducts } from "@/features/weekly-heroes/read-weekly-hero-products.server"

import { HomeHero } from "./home-hero"

vi.mock("server-only", () => ({}))
vi.mock("next/server", () => ({ connection: vi.fn() }))
vi.mock("@/lib/store-config", () => ({
  storeConfig: {
    tagline: "Sample tees",
    home: { headline: "Sample headline", introduction: "Sample introduction", shopLabel: "Browse the collection" },
  },
}))
vi.mock("@/features/weekly-heroes/get-weekly-hero-store.server", () => ({ getWeeklyHeroStore: vi.fn() }))
vi.mock("@/features/weekly-heroes/read-weekly-hero-products.server", () => ({ readWeeklyHeroProducts: vi.fn() }))
vi.mock("@/features/weekly-heroes/weekly-hero-poster", () => ({
  WeeklyHeroPoster: () => <div data-testid="weekly-hero-poster" />,
}))
vi.mock("@/features/weekly-heroes/weekly-design-details", () => ({
  WeeklyDesignDetails: ({ title }: { title: string }) => <div>{title}</div>,
}))

type WeeklyHeroStore = ReturnType<typeof getWeeklyHeroStore>
type WeeklyHero = Awaited<ReturnType<WeeklyHeroStore["current"]>>

function storeReturning(current: () => Promise<WeeklyHero>) {
  vi.mocked(getWeeklyHeroStore).mockReturnValue({ current } as unknown as WeeklyHeroStore)
}

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
  vi.mocked(readWeeklyHeroProducts).mockResolvedValue([])
})

afterEach(() => {
  warn.mockRestore()
})

function expectHomeIntro() {
  expect(screen.getByRole("heading", { level: 1, name: "Sample headline" })).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "Browse the collection" })).toHaveAttribute("href", "/shop")
  expect(screen.queryByTestId("weekly-hero-poster")).not.toBeInTheDocument()
}

describe("HomeHero", () => {
  it("falls back to the store introduction and logs fixed fields when hero storage fails", async () => {
    storeReturning(() => Promise.reject(new Error("relation commerce.weekly_heroes does not exist")))
    render(await HomeHero())
    expectHomeIntro()
    expect(warn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith("Weekly hero unavailable", { reason: "storage" })
  })

  it("also catches a storage getter that throws before returning a store", async () => {
    vi.mocked(getWeeklyHeroStore).mockImplementation(() => {
      throw new Error("Weekly hero storage is not configured")
    })
    render(await HomeHero())
    expectHomeIntro()
    expect(warn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith("Weekly hero unavailable", { reason: "storage" })
  })

  it("shows the store introduction without a warning when no hero is scheduled", async () => {
    storeReturning(() => Promise.resolve(null))
    render(await HomeHero())
    expectHomeIntro()
    expect(warn).not.toHaveBeenCalled()
  })

  it("shows the scheduled hero instead of the introduction", async () => {
    storeReturning(() =>
      Promise.resolve({
        liveAt: "2026-09-21T09:00:00.000Z",
        manifest: { title: "Sample tee week", links: [{ productId: "product-1" }] },
      } as unknown as WeeklyHero)
    )
    render(await HomeHero())
    expect(screen.getByTestId("weekly-hero-poster")).toBeInTheDocument()
    expect(screen.getByText("Sample tee week")).toBeInTheDocument()
    expect(screen.queryByRole("heading", { level: 1, name: "Sample headline" })).not.toBeInTheDocument()
    expect(readWeeklyHeroProducts).toHaveBeenCalledWith([{ productId: "product-1" }])
    expect(warn).not.toHaveBeenCalled()
  })
})
