// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import { PrintifyDesignDraftClient } from "./printify-design-draft-client.server"
import { validateDesignDraftInput } from "./validate-design-draft-input"
import { matchDesignProduct } from "./match-design-product"
import { readProductArtworkImages } from "./read-product-artwork-images"
import type { DesignProductPayload } from "./design-draft-types"
import { readPrintifyArtworkSource } from "./read-printify-artwork-source.server"
vi.mock("server-only", () => ({}))
const recipe = {
  blueprintId: 145,
  productModelLabel: "6210",
  printProviderId: 99,
  variants: [{ id: 1, price: 2500, color: "Black", size: "M" }],
  placement: { position: "front", x: 0.5, y: 0.5, scale: 1, angle: 0 },
  description: "Tee",
  titleTemplate: "{title}",
}
const input = {
  requestId: "adf15313-8c0a-47a0-96c2-a891e4d531c1",
  selection: { kind: "numbers", numbers: [149] },
  recipe,
}
const payload: DesignProductPayload = {
  title: "Title",
  description: "Tee",
  blueprint_id: 145,
  print_provider_id: 99,
  variants: [
    { id: 1, price: 2500, is_enabled: true },
    { id: 2, price: 2700, is_enabled: true },
  ],
  print_areas: [
    {
      variant_ids: [1, 2],
      placeholders: [{ position: "front", images: [{ id: "image", x: 0.5, y: 0.5, scale: 1, angle: 0 }] }],
    },
  ],
}
const providerCareImage = {
  id: "provider-care",
  name: "text_layer.svg",
  type: "text/plain",
  layerType: "image",
  src: "",
  x: 0.5,
  y: 0.5,
  scale: 1,
  angle: 0,
  width: 100,
  height: 100,
  flipX: false,
  flipY: false,
}
describe("documented Printify product client boundaries", () => {
  it("paginates every inventory page before returning evidence", async () => {
    const request = vi.fn<typeof fetch>(async (url) => {
      const page = new URL(String(url)).searchParams.get("page")
      return Response.json({
        current_page: Number(page),
        last_page: 2,
        total: 2,
        data: [{ id: `product-${page}`, shop_id: 42 }],
      })
    })
    const client = new PrintifyDesignDraftClient("fixture-token", "42", request)
    expect(await client.listProducts()).toHaveLength(2)
    expect(request).toHaveBeenCalledTimes(2)
    expect(String(request.mock.calls[0]?.[0])).toContain("limit=50&page=1")
    expect(request.mock.calls[0]?.[1]).toMatchObject({ redirect: "error", cache: "no-store" })
  })
  it.each(["duplicate", "foreign", "missing", "changing-total"])(
    "rejects %s inventory instead of declaring absence",
    async (mode) => {
      const request = vi.fn<typeof fetch>(async (url) => {
        const page = Number(new URL(String(url)).searchParams.get("page"))
        return Response.json({
          current_page: page,
          last_page: 2,
          total: mode === "changing-total" && page === 2 ? 3 : 2,
          data: [
            {
              ...(mode === "missing" ? {} : { id: mode === "duplicate" ? "same" : `p${page}` }),
              shop_id: mode === "foreign" ? 43 : 42,
            },
          ],
        })
      })
      await expect(new PrintifyDesignDraftClient("token", "42", request).listProducts()).rejects.toThrow(/inventory/)
    }
  )
  it("uploads by URL and creates drafts using documented fields without publication or invented idempotency", async () => {
    const request = vi.fn<typeof fetch>(async (url) =>
      Response.json(
        String(url).includes("uploads")
          ? { id: "image", width: 100, height: 100, mime_type: "image/png" }
          : { id: "product" }
      )
    )
    const client = new PrintifyDesignDraftClient("token", "42", request)
    await client.uploadImage({ fileName: "art.png", url: "https://store.example/api/printify/artwork/fixture" })
    await client.createProduct(payload)
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      file_name: "art.png",
      url: "https://store.example/api/printify/artwork/fixture",
    })
    expect(String(request.mock.calls[1]?.[0])).toBe("https://api.printify.com/v1/shops/42/products.json")
    expect(request.mock.calls[1]?.[1]?.headers).not.toHaveProperty("Idempotency-Key")
    expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body))).toEqual(payload)
  })
  it("sanitizes provider failures and verifies recipe color/size instead of accepting guessed IDs", async () => {
    const broken = new PrintifyDesignDraftClient(
      "token",
      "42",
      vi.fn(async () => new Response("sensitive body", { status: 500 }))
    )
    await expect(broken.createProduct(payload)).rejects.toThrow("verifiable response")
    const request = vi.fn<typeof fetch>(async () =>
      Response.json({
        variants: [{ id: 1, options: { color: "White", size: "M" }, placeholders: [{ position: "front" }] }],
      })
    )
    await expect(
      new PrintifyDesignDraftClient("token", "42", request).validateRecipe(validateDesignDraftInput(input).recipe)
    ).rejects.toThrow("unavailable")
  })
  it("lists the provider's garments by name, marking what cannot be made or front-printed right now", async () => {
    const request = vi.fn<typeof fetch>(async () =>
      Response.json({
        variants: [
          { id: 1, options: { color: "CVC Black", size: "M" }, placeholders: [{ position: "front" }] },
          {
            id: 2,
            options: { color: "CVC Black", size: "L" },
            placeholders: [{ position: "front", decoration_method: "dtg" }],
            is_available: false,
          },
          { id: 3, options: { color: "CVC Black", size: "XL" }, placeholders: [{ position: "back" }] },
          {
            id: 4,
            options: { color: "CVC Black", size: "2XL" },
            placeholders: [{ position: "front", decoration_method: "embroidery" }],
          },
          { id: 5, options: { size: "M" }, placeholders: [{ position: "front" }] },
        ],
      })
    )
    const client = new PrintifyDesignDraftClient("token", "42", request)
    expect(await client.listCatalogVariants({ blueprintId: 1317, printProviderId: 99, position: "front" })).toEqual([
      { id: 1, color: "CVC Black", size: "M", available: true },
      { id: 2, color: "CVC Black", size: "L", available: false },
      { id: 3, color: "CVC Black", size: "XL", available: false },
      { id: 4, color: "CVC Black", size: "2XL", available: false },
    ])
    expect(String(request.mock.calls[0]?.[0])).toBe(
      "https://api.printify.com/v1/catalog/blueprints/1317/print_providers/99/variants.json"
    )
    expect(request.mock.calls[0]?.[1]?.method).toBe("GET")
    await expect(
      new PrintifyDesignDraftClient(
        "token",
        "42",
        vi.fn(async () => Response.json({ unexpected: true }))
      ).listCatalogVariants({ blueprintId: 1317, printProviderId: 99, position: "front" })
    ).rejects.toThrow("could not be verified")
  })
  it("requires explicit recipe settings and rejects publication parameters", () => {
    expect(validateDesignDraftInput(input).selection).toEqual(input.selection)
    expect(() => validateDesignDraftInput({ ...input, publish: true })).toThrow("Complete")
    expect(() => validateDesignDraftInput({ ...input, recipe: { ...recipe, placement: undefined } })).toThrow(
      "placement"
    )
    expect(() =>
      validateDesignDraftInput({ ...input, recipe: { ...recipe, variants: [recipe.variants[0], recipe.variants[0]] } })
    ).toThrow("once")
  })
  it("matches provider area regrouping but detects layers, changed pricing and flipped art", () => {
    const regrouped = {
      ...payload,
      print_areas: payload.variants.map(({ id }) => ({ ...payload.print_areas[0], variant_ids: [id] })),
    }
    expect(matchDesignProduct(regrouped, payload)).toBe(true)
    expect(matchDesignProduct({ ...payload, variants: [{ ...payload.variants[0], price: 1 }] }, payload)).toBe(false)
    const layered = structuredClone(payload)
    layered.print_areas[0]!.placeholders[0]!.images.push({ ...layered.print_areas[0]!.placeholders[0]!.images[0]! })
    expect(matchDesignProduct(layered, payload)).toBe(false)
    const flipped = structuredClone(payload)
    Object.assign(flipped.print_areas[0]!.placeholders[0]!.images[0]!, { flipX: true })
    expect(matchDesignProduct(flipped, payload)).toBe(false)
  })
  it.each([
    "http://images.printify.com/original.png",
    "https://printify.com.attacker.test/art.png",
    "https://user:password@images.printify.com/art.png",
    "https://127.0.0.1/private",
    "file:///tmp/art.png",
  ])("refuses an unapproved original source %s", async (src) => {
    const request = vi.fn<typeof fetch>()
    await expect(readPrintifyArtworkSource(src, request)).rejects.toThrow("verification")
    expect(request).not.toHaveBeenCalled()
  })
  it("accepts required care-label metadata but rejects unrequested production controls", () => {
    const raw = structuredClone(payload) as unknown as Record<string, unknown>
    const areas = raw.print_areas as {
      background?: string
      font_color?: string
      font_family?: string
      placeholders: Record<string, unknown>[]
    }[]
    areas[0]!.background = "transparent"
    areas[0]!.font_color = "auto"
    areas[0]!.font_family = "Roboto"
    areas[0]!.placeholders.push({
      position: "neck",
      decoration_method: "dtf",
      images: [structuredClone(providerCareImage)],
    })
    expect(matchDesignProduct(raw, payload)).toBe(true)
    for (const fields of [{ font_color: "red" }, { font_family: "custom-font" }]) {
      const custom = structuredClone(raw)
      Object.assign((custom.print_areas as Record<string, unknown>[])[0]!, fields)
      expect(matchDesignProduct(custom, payload)).toBe(false)
    }
    const noCareLabel = structuredClone(raw)
    ;(noCareLabel.print_areas as { placeholders: { position: string }[] }[])[0]!.placeholders =
      areas[0]!.placeholders.filter((placeholder) => placeholder.position !== "neck") as { position: string }[]
    expect(matchDesignProduct(noCareLabel, payload)).toBe(false)
    expect(matchDesignProduct({ ...raw, print_details: { print_on_side: "mirror" } }, payload)).toBe(false)
    const embroidery = structuredClone(raw)
    ;(embroidery.print_areas as { placeholders: Record<string, unknown>[] }[])[0]!.placeholders[0]!.decoration_method =
      "embroidery"
    expect(matchDesignProduct(embroidery, payload)).toBe(false)
    const filled = structuredClone(raw)
    ;(filled.print_areas as { background: string }[])[0]!.background = "#ffffff"
    expect(matchDesignProduct(filled, payload)).toBe(false)
  })
  it.each([
    ["font_family", "custom-font"],
    ["font_color", "red"],
    ["font_weight", 700],
    ["font_style", "italic"],
    ["font_size", 24],
    ["text_align", "left"],
    ["input_text", "Custom neck artwork"],
    ["layerType", "text"],
    ["pattern", { repeat: "tile" }],
  ])("does not hide added %s controls inside required care metadata", (field, value) => {
    const raw = structuredClone(payload) as unknown as { print_areas: { placeholders: Record<string, unknown>[] }[] }
    raw.print_areas[0]!.placeholders.push({
      position: "neck",
      decoration_method: "dtf",
      images: [{ ...providerCareImage, [field]: value }],
    })
    expect(readProductArtworkImages(raw)).toMatchObject({ hasOtherArtwork: true, hasUnsupportedArtwork: true })
    expect(matchDesignProduct(raw, payload)).toBe(false)
  })
  it.each([400, 401, 403, 404, 422])(
    "distinguishes a definitive JSON %i rejection without exposing its body",
    async (status) => {
      const client = new PrintifyDesignDraftClient(
        "token",
        "42",
        vi.fn(async () =>
          Response.json({ status: "error", message: "secret capability URL and merchant details" }, { status })
        )
      )
      await expect(client.createProduct(payload)).rejects.toMatchObject({
        code: "PROVIDER_REJECTED",
        httpStatus: status,
      })
      await expect(client.createProduct(payload)).rejects.not.toThrow("secret")
    }
  )
  it.each([408, 429, 500, 503])("leaves %i responses uncertain even with a JSON error", async (status) => {
    const client = new PrintifyDesignDraftClient(
      "token",
      "42",
      vi.fn(async () => Response.json({ status: "error", message: "error" }, { status }))
    )
    await expect(client.createProduct(payload)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" })
  })
  it("does not treat malformed rejection evidence as permission to repeat a product POST", async () => {
    const client = new PrintifyDesignDraftClient(
      "token",
      "42",
      vi.fn(async () => new Response("not provider JSON", { status: 422 }))
    )
    await expect(client.createProduct(payload)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" })
  })
  it("rejects duplicate designs with conflicting requested revisions", () => {
    const designId = "42abac60-4ab9-4566-bf5f-af638e329558"
    expect(() =>
      validateDesignDraftInput({
        ...input,
        selection: {
          kind: "revisions",
          items: [
            { designId, revisionId: input.requestId },
            { designId, revisionId: designId },
          ],
        },
      })
    ).toThrow("each design once")
  })
  it("accepts harmless text normalization while retaining price, variant and substantive text checks", () => {
    expect(
      matchDesignProduct(
        { ...payload, title: `  ${payload.title} `, description: `\r\n${payload.description}\r\n` },
        payload
      )
    ).toBe(true)
    expect(matchDesignProduct({ ...payload, description: "Different product claim" }, payload)).toBe(false)
    expect(
      matchDesignProduct({ ...payload, variants: payload.variants.map((v) => ({ ...v, is_enabled: false })) }, payload)
    ).toBe(false)
  })
})
