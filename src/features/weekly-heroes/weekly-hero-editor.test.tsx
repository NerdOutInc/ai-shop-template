import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, it, vi } from "vitest"
import { WeeklyHeroEditor } from "./weekly-hero-editor"
import { weeklyHeroSchema } from "./weekly-hero-schema"
import type { WeeklyHeroDraft, WeeklyHeroManifest } from "./weekly-hero-schema"
const version = "11111111-1111-4111-8111-111111111111",
  nextVersion = "22222222-2222-4222-8222-222222222222"
const desktop = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kind: "desktop" as const, width: 1800, height: 600 }
const mobile = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", kind: "mobile" as const, width: 800, height: 1400 }
const liveAt = "2026-10-23T22:30:00.000Z"
const products = Array.from({ length: 6 }, (_, i) => ({
  productId: `product-${i}`,
  title: `Product ${i}`,
  colors: ["Black"],
}))
const fetcher = vi.fn<typeof fetch>()
vi.mock("./hero-link-area-editor", () => ({ HeroLinkAreaEditor: () => null }))
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("fetch", fetcher)
})
it("withdraws an unreadable hero using its actual revision without publishing anything", async () => {
  fetcher.mockResolvedValue(Response.json({ draft: { version: nextVersion, scheduled: false, hero: null } }))
  render(
    <WeeklyHeroEditor now={0} liveAt={liveAt} products={products} initial={{ version, scheduled: true, hero: null }} />
  )
  expect(screen.getByRole("alert")).toHaveTextContent("cannot be previewed")
  expect(screen.queryByRole("link", { name: "Preview saved hero" })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "Withdraw approved hero" }))
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("withdrawn"))
  expect(fetcher).toHaveBeenCalledOnce()
  expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toEqual({ liveAt, version })
  expect(fetcher.mock.calls[0]![1]!.method).toBe("DELETE")
  expect(screen.queryByRole("button", { name: "Withdraw approved hero" })).not.toBeInTheDocument()
})
it("replaces an unreadable row with its saved revision and adds destinations without moving existing areas", async () => {
  let sent: { version: string; scheduled: boolean; manifest: WeeklyHeroManifest } | undefined
  fetcher.mockImplementation(async (input, init) => {
    if (String(input).includes("assets"))
      return Response.json({ asset: String(input).includes("desktop") ? desktop : mobile })
    sent = JSON.parse(String(init!.body)) as NonNullable<typeof sent>
    return Response.json({
      draft: {
        version: nextVersion,
        scheduled: false,
        hero: { liveAt, version: nextVersion, scheduled: false, manifest: sent!.manifest, desktop, mobile },
      } satisfies WeeklyHeroDraft,
    })
  })
  render(
    <WeeklyHeroEditor now={0} liveAt={liveAt} products={products} initial={{ version, scheduled: false, hero: null }} />
  )
  await userEvent.type(screen.getByRole("textbox", { name: "Design name" }), "A new scene")
  await userEvent.type(
    screen.getByRole("textbox", { name: /Image description/ }),
    "Six products in a neutral composition"
  )
  const file = new File(["fixture"], "fixture.png", { type: "image/png" })
  await userEvent.upload(screen.getByLabelText(/Desktop panorama/), file)
  await userEvent.upload(screen.getByLabelText(/Mobile composition/), file)
  for (let i = 0; i < 4; i++) await userEvent.click(screen.getByRole("button", { name: "Add product destination" }))
  await userEvent.click(screen.getByRole("button", { name: "Save private draft" }))
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Draft saved privately"))
  expect(sent).toMatchObject({ version, scheduled: false })
  expect(weeklyHeroSchema.safeParse(sent!.manifest).success).toBe(true)
  expect(sent!.manifest.links).toHaveLength(6)
  expect(sent!.manifest.links[0]!.mobile).toEqual({ x: 2, y: 8, width: 96, height: 40 })
  expect(screen.getByRole("link", { name: "Preview saved hero" })).toBeVisible()
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
})
