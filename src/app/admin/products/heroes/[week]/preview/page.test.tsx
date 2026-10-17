import { render, screen } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import HeroPreviewPage from "./page"
const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), store: vi.fn(), read: vi.fn() }))
vi.mock("@/features/admin/require-admin.server", () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock("@/features/weekly-heroes/get-weekly-hero-store.server", () => ({ getWeeklyHeroStore: mocks.store }))
vi.mock("@/features/weekly-heroes/read-hero-week-param.server", () => ({
  readHeroWeekParam: async () => "2026-10-23T22:30:00.000Z",
}))
vi.mock("@/lib/store-config", () => ({ storeConfig: { features: { designOfTheWeek: true } } }))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAdmin.mockResolvedValue({})
  mocks.store.mockReturnValue({ read: mocks.read })
  mocks.read.mockResolvedValue(null)
})
it.each(["configuration", "database"])("shows a clear storage message on %s failure", async (fault) => {
  if (fault === "configuration")
    mocks.store.mockImplementation(() => {
      throw new Error("private config")
    })
  else mocks.read.mockRejectedValue(new Error("private SQL"))
  render(await HeroPreviewPage({ params: Promise.resolve({ week: "fixture" }) }))
  expect(screen.getByRole("alert")).toHaveTextContent("Weekly hero storage is unavailable")
  expect(screen.getByRole("link", { name: "Return to editor" })).toBeVisible()
  expect(screen.queryByText(/private SQL|private config/)).not.toBeInTheDocument()
})
it("does not read private storage when admin authorization rejects", async () => {
  mocks.requireAdmin.mockRejectedValue(new Error("Sign in"))
  await expect(HeroPreviewPage({ params: Promise.resolve({ week: "fixture" }) })).rejects.toThrow("Sign in")
  expect(mocks.store).not.toHaveBeenCalled()
})
