// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { GarmentSetupError } from "@/features/garment-catalog/garment-setup-error"

import { GET } from "./route"

const { getAdminActor, readPrintifyBlueprint, revalidateTag, revalidatePath } = vi.hoisted(() => ({
  getAdminActor: vi.fn(),
  readPrintifyBlueprint: vi.fn(),
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}))
vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidateTag, revalidatePath }))
vi.mock("@/features/admin/get-admin-actor.server", () => ({ getAdminActor }))
vi.mock("@/features/garment-catalog/read-printify-blueprint.server", () => ({ readPrintifyBlueprint }))

// No origin header by default: that is what a browser sends on a same-origin GET.
function request(blueprint = "1312", headers: Record<string, string> = {}) {
  return [
    new Request(`http://0.0.0.0:3000/api/admin/products/garments/${blueprint}/catalog`, { headers }),
    { params: Promise.resolve({ blueprint }) },
  ] as const
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "warn").mockImplementation(() => {})
  getAdminActor.mockResolvedValue({ userId: "owner" })
  readPrintifyBlueprint.mockResolvedValue({
    id: 1312,
    title: "Women's Ideal Crop Top",
    brand: "Next Level",
    model: "5080",
  })
})

describe("garment catalog lookup route", () => {
  it("answers a same-origin GET, which carries no origin header, with Printify's name for the garment", async () => {
    const [lookup, context] = request()
    const result = await GET(lookup, context)
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({
      blueprintId: 1312,
      title: "Women's Ideal Crop Top",
      manufacturer: "Next Level",
      model: "5080",
    })
    // A number, never a link, and the browser's own abort signal so a closed tab stops the request.
    expect(readPrintifyBlueprint).toHaveBeenCalledWith(1312, { signal: lookup.signal })
    expect(result.headers.get("cache-control")).toContain("no-store")
    expect(revalidateTag).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("rejects a visitor before asking Printify anything", async () => {
    getAdminActor.mockResolvedValue(null)
    const result = await GET(...request())
    expect(result.status).toBe(401)
    expect(await result.json()).toEqual({ error: "Sign in as an administrator." })
    expect(readPrintifyBlueprint).not.toHaveBeenCalled()
  })

  // A foreign page can make the browser send this GET, but it cannot read the private answer, and
  // the lookup writes nothing. The session is the boundary.
  it("still needs an administrator when another origin asks", async () => {
    getAdminActor.mockResolvedValue(null)
    expect((await GET(...request("1312", { origin: "https://foreign.example" }))).status).toBe(401)
    expect(readPrintifyBlueprint).not.toHaveBeenCalled()
  })

  // The session cookie is SameSite=Lax, so a foreign page's popup would otherwise spend the drafts
  // token's rate limit one integer at a time. Refused before the session is even read.
  it.each(["cross-site", "same-site", "CROSS-SITE", ""])(
    "refuses a request the browser marks %j before asking anyone anything",
    async (site) => {
      const result = await GET(
        ...request("1312", { "sec-fetch-site": site, "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" })
      )
      expect(result.status).toBe(403)
      expect(await result.json()).toEqual({ error: "Use the Garment models page to look a garment up." })
      expect(result.headers.get("cache-control")).toContain("no-store")
      expect(getAdminActor).not.toHaveBeenCalled()
      expect(readPrintifyBlueprint).not.toHaveBeenCalled()
    }
  )

  // The form's fetch says same-origin and a typed address says none. No header at all is an agent
  // or an old browser, covered by the first test in this file.
  it.each(["same-origin", "none"])("answers a request the browser marks %j", async (site) => {
    const result = await GET(...request("1312", { "sec-fetch-site": site }))
    expect(result.status).toBe(200)
    expect(readPrintifyBlueprint).toHaveBeenCalledOnce()
  })

  it.each([
    "",
    "0",
    "01312",
    "-1312",
    "13.12",
    "1e3",
    "1312abc",
    "1234567890",
    "5d39b159e7c48c000728c89f",
    "printify.com",
    encodeURIComponent("https://printify.com/app/products/1312"),
  ])("reports the malformed blueprint %j as not found before asking Printify anything", async (blueprint) => {
    const result = await GET(...request(blueprint))
    expect(result.status).toBe(404)
    expect(await result.json()).toEqual({ error: "Garment not found." })
    expect(readPrintifyBlueprint).not.toHaveBeenCalled()
  })

  it("says so when Printify has no garment with that number", async () => {
    readPrintifyBlueprint.mockResolvedValue(null)
    const result = await GET(...request("999999"))
    expect(result.status).toBe(404)
    expect(await result.json()).toEqual({ error: "Printify has no garment with that number." })
    expect(console.warn).not.toHaveBeenCalled()
  })

  it.each([
    ["NOT_CONFIGURED", new GarmentSetupError("NOT_CONFIGURED", "The Printify drafts token is not configured")],
    ["PROVIDER_REJECTED", new GarmentSetupError("PROVIDER_REJECTED", "Printify refused the catalog lookup")],
    ["PROVIDER_UNAVAILABLE", new GarmentSetupError("PROVIDER_UNAVAILABLE", "Printify's catalog did not answer")],
    ["UNEXPECTED", new Error("connect ECONNREFUSED Bearer secret-token")],
  ])("tells the owner to type the name when the lookup fails with %s, and logs only a code", async (code, error) => {
    readPrintifyBlueprint.mockRejectedValue(error)
    const result = await GET(...request())
    expect(result.status).toBe(503)
    const body = await result.text()
    expect(JSON.parse(body)).toEqual({
      error: "Printify's catalog is not answering. Type the garment's name yourself, or try again shortly.",
    })
    expect(body).not.toContain("secret-token")
    expect(result.headers.get("cache-control")).toContain("no-store")
    expect(console.warn).toHaveBeenCalledExactlyOnceWith("Printify blueprint lookup failed", { code })
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("secret-token")
  })

  // The reader turns the caller's abort into PROVIDER_UNAVAILABLE like any transport failure. A
  // closed tab must not read as a Printify outage in the log.
  it("does not log an outage when the owner went away mid-lookup", async () => {
    const controller = new AbortController()
    const [lookup, context] = request()
    const abandoned = new Request(lookup, { signal: controller.signal })
    readPrintifyBlueprint.mockImplementation(async () => {
      controller.abort()
      throw new GarmentSetupError("PROVIDER_UNAVAILABLE", "Printify's catalog did not answer")
    })
    expect((await GET(abandoned, context)).status).toBe(503)
    expect(console.warn).not.toHaveBeenCalled()
  })

  // Neither of these is caused by the abort, and both need fixing whether or not anyone waited.
  it.each([
    ["NOT_CONFIGURED", new GarmentSetupError("NOT_CONFIGURED", "The Printify drafts token is not configured")],
    ["PROVIDER_REJECTED", new GarmentSetupError("PROVIDER_REJECTED", "Printify refused the catalog lookup")],
  ])("still logs %s when the owner went away mid-lookup", async (code, error) => {
    const [lookup, context] = request()
    readPrintifyBlueprint.mockRejectedValue(error)
    await GET(new Request(lookup, { signal: AbortSignal.abort() }), context)
    expect(console.warn).toHaveBeenCalledExactlyOnceWith("Printify blueprint lookup failed", { code })
  })
})
