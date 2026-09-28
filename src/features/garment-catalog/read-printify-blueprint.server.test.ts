// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { readPrintifyBlueprint } from "./read-printify-blueprint.server"

const { env } = vi.hoisted(() => ({ env: { PRINTIFY_DRAFTS_API_TOKEN: undefined as string | undefined } }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({ env }))

const tee = {
  id: 1317,
  title: "Unisex CVC Jersey T-shirt",
  brand: "Next Level",
  model: "6210",
  description: "<p>Provider HTML the page has no use for</p>",
  images: ["https://images.printify.com/1317.png"],
}

function answering(body: unknown, init?: ResponseInit) {
  return vi.fn<typeof fetch>(async () => Response.json(body, init))
}

beforeEach(() => {
  env.PRINTIFY_DRAFTS_API_TOKEN = undefined
})
afterEach(() => vi.unstubAllGlobals())

describe("readPrintifyBlueprint", () => {
  it("asks Printify's catalog for exactly that blueprint and returns only its names", async () => {
    const request = answering(tee)
    expect(await readPrintifyBlueprint(1317, { apiToken: "fixture-token", request })).toEqual({
      id: 1317,
      title: "Unisex CVC Jersey T-shirt",
      brand: "Next Level",
      model: "6210",
    })
    expect(request).toHaveBeenCalledTimes(1)
    expect(String(request.mock.calls[0]?.[0])).toBe("https://api.printify.com/v1/catalog/blueprints/1317.json")
    expect(request.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      headers: {
        Authorization: "Bearer fixture-token",
        "User-Agent": "Clothing-Store/0.1",
        Accept: "application/json",
      },
      // A redirect would carry the bearer token to wherever Printify, or somebody in between, points.
      redirect: "error",
      cache: "no-store",
    })
    expect(request.mock.calls[0]?.[1]?.body).toBeUndefined()
  })

  it("reads the drafts token from the environment when none is handed in", async () => {
    env.PRINTIFY_DRAFTS_API_TOKEN = "environment-token"
    const request = answering(tee)
    vi.stubGlobal("fetch", request)
    expect(await readPrintifyBlueprint(1317)).toMatchObject({ brand: "Next Level", model: "6210" })
    expect(request.mock.calls[0]?.[1]).toMatchObject({ headers: { Authorization: "Bearer environment-token" } })
  })

  it("returns null when Printify has no such blueprint", async () => {
    const request = answering({ status: "error", message: "Not found" }, { status: 404 })
    expect(await readPrintifyBlueprint(9999, { apiToken: "fixture-token", request })).toBeNull()
  })

  it.each([401, 403])("reports a %i as a rejected token without repeating Printify's words", async (status) => {
    const request = answering({ status: "error", message: "secret capability URL and merchant details" }, { status })
    const lookup = readPrintifyBlueprint(1317, { apiToken: "fixture-token", request })
    await expect(lookup).rejects.toMatchObject({ name: "GarmentSetupError", code: "PROVIDER_REJECTED" })
    await expect(lookup).rejects.not.toThrow(/secret|fixture-token/)
  })

  it.each([400, 408, 422, 429, 500, 502, 503])("reports a %i as unavailable", async (status) => {
    const request = answering({ status: "error", message: "secret capability URL" }, { status })
    const lookup = readPrintifyBlueprint(1317, { apiToken: "fixture-token", request })
    await expect(lookup).rejects.toMatchObject({ name: "GarmentSetupError", code: "PROVIDER_UNAVAILABLE" })
    await expect(lookup).rejects.not.toThrow(/secret|fixture-token/)
  })

  it.each([
    ["a connection failure", new TypeError("fetch failed: https://api.printify.com/?token=fixture-token")],
    ["a timeout", new DOMException("The operation timed out", "TimeoutError")],
    ["a refused redirect", new TypeError("unexpected redirect")],
  ])("reports %s as unavailable without the transport's details", async (_label, failure) => {
    const request = vi.fn<typeof fetch>(async () => {
      throw failure
    })
    const lookup = readPrintifyBlueprint(1317, { apiToken: "fixture-token", request })
    await expect(lookup).rejects.toMatchObject({ name: "GarmentSetupError", code: "PROVIDER_UNAVAILABLE" })
    await expect(lookup).rejects.not.toThrow(/fixture-token|fetch failed|timed out|redirect/)
  })

  // Answering about another garment would pre-fill the wrong name on the owner's form.
  it("refuses an answer about a different blueprint", async () => {
    const request = answering({ ...tee, id: 1312 })
    await expect(readPrintifyBlueprint(1317, { apiToken: "fixture-token", request })).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    })
  })

  it.each([
    ["an id sent as text", { ...tee, id: "1317" }],
    ["no title", { ...tee, title: undefined }],
    ["a blank title", { ...tee, title: "   " }],
    ["an HTML error page", "<html>Bad gateway</html>"],
    ["a list instead of one blueprint", [tee]],
    ["null", null],
  ])("refuses an answer with %s", async (_label, body) => {
    const request = answering(body)
    await expect(readPrintifyBlueprint(1317, { apiToken: "fixture-token", request })).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    })
  })

  it("reports a body that is not JSON as unavailable", async () => {
    const request = vi.fn<typeof fetch>(async () => new Response("<html>Bad gateway</html>"))
    await expect(readPrintifyBlueprint(1317, { apiToken: "fixture-token", request })).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    })
  })

  // The lookup only pre-fills a form the owner can type into, so a half-described blueprint is
  // still worth returning.
  it.each([
    ["a missing brand and model", { id: 1317, title: "Unisex CVC Jersey T-shirt" }],
    ["a null brand and a numeric model", { ...tee, brand: null, model: 6210 }],
  ])("falls back to empty names for %s", async (_label, body) => {
    const request = answering(body)
    expect(await readPrintifyBlueprint(1317, { apiToken: "fixture-token", request })).toEqual({
      id: 1317,
      title: "Unisex CVC Jersey T-shirt",
      brand: "",
      model: "",
    })
  })

  it("trims the names Printify sends", async () => {
    const request = answering({ ...tee, brand: " Next Level ", model: "6210\n" })
    expect(await readPrintifyBlueprint(1317, { apiToken: "fixture-token", request })).toMatchObject({
      brand: "Next Level",
      model: "6210",
    })
  })

  it.each([
    ["a missing token", undefined],
    ["an empty token", ""],
    ["a blank token", "   "],
    // A line break in a header value is how one header becomes two.
    ["a token carrying a line feed", "fixture-token\nX-Injected: 1"],
    ["a token carrying a carriage return", "fixture-token\r"],
  ])("reports %s as not configured and never calls Printify", async (_label, apiToken) => {
    const request = answering(tee)
    const lookup = readPrintifyBlueprint(1317, { apiToken, request })
    await expect(lookup).rejects.toMatchObject({ name: "GarmentSetupError", code: "NOT_CONFIGURED" })
    await expect(lookup).rejects.not.toThrow(/fixture-token/)
    expect(request).not.toHaveBeenCalled()
  })

  // The number becomes part of a URL that carries the token, so nothing but a plain blueprint
  // number may reach it, whatever a caller's types claim.
  it.each([
    [0],
    [-1317],
    [13.17],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [1_000_000_000],
    ["1317/../../shops" as unknown as number],
    ["1317" as unknown as number],
  ])("answers null for %j without calling Printify", async (blueprintId) => {
    const request = answering(tee)
    expect(await readPrintifyBlueprint(blueprintId, { apiToken: "fixture-token", request })).toBeNull()
    expect(request).not.toHaveBeenCalled()
  })

  it("gives up when the caller's request is abandoned, and still sets its own limit beside the caller's", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout")
    const controller = new AbortController()
    const request = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))
        })
    )
    const lookup = readPrintifyBlueprint(1317, { apiToken: "fixture-token", request, signal: controller.signal })
    controller.abort()
    await expect(lookup).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" })
    expect(timeout).toHaveBeenCalledWith(10_000)
  })

  // Printify hanging must not hang the owner's click: the limit is there with no caller signal too.
  it("puts a ten-second limit on the request when the caller sets none", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout")
    const request = answering(tee)
    await readPrintifyBlueprint(1317, { apiToken: "fixture-token", request })
    expect(timeout).toHaveBeenCalledWith(10_000)
    expect(request.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })
})
