// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { buildDesignRecipe } from "./build-design-recipe"
import { listPublishedProductRecipes } from "./list-published-product-recipes.server"

const { listPublishedProducts } = vi.hoisted(() => ({ listPublishedProducts: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/features/publishing/list-published-products-for-admin.server", () => ({ listPublishedProducts }))

const sizeGuide =
  '<p><strong>The tee</strong></p><p>A soft illustrated tee.</p><table id="size-guide"><thead><tr><th></th><th>M</th><th>XL</th></tr></thead><tbody><tr><td>Width, in</td><td>20</td><td>24</td></tr></tbody></table>'

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: "tee-a",
    title: "Sample Morning Scene",
    description: sizeGuide,
    blueprint_id: 1317,
    print_provider_id: 99,
    options: [
      { name: "Colors", type: "color", values: [{ id: 1, title: "CVC Black" }] },
      { name: "Sizes", type: "size", values: [{ id: 10, title: "M" }] },
    ],
    variants: [{ id: 1001, price: 2800, is_enabled: true, options: [1, 10] }],
    print_areas: [
      {
        variant_ids: [1001],
        placeholders: [{ position: "front", images: [{ id: "art", x: 0.5, y: 0.1, scale: 0.63, angle: 0 }] }],
      },
    ],
    ...overrides,
  }
}

beforeEach(() => vi.clearAllMocks())

describe("listPublishedProductRecipes", () => {
  it("offers one entry per published model, recovered from the products themselves", async () => {
    listPublishedProducts.mockResolvedValue([product(), product({ id: "tee-b", title: "Sample Evening Scene" })])
    const result = await listPublishedProductRecipes()

    expect(result.productsRead).toBe(2)
    expect(result.models).toHaveLength(1)
    const [model] = result.models
    expect(model).toMatchObject({ blueprintId: 1317, printProviderId: 99, productIds: ["tee-a", "tee-b"] })
    expect(model!.variants).toEqual([{ id: 1001, price: 2800, color: "CVC Black", size: "M" }])
    expect(model!.placement).toEqual({ position: "front", x: 0.5, y: 0.1, scale: 0.63, angle: 0 })
    expect(model!.placementDonorProductId).toBe("tee-a")
    expect(model!.placementDonorTitle).toBe("Sample Morning Scene")
    expect(model!.unverified).not.toContain("placement")
    expect(model!.blocked).toEqual([])
  })

  // Price is absent from the production fingerprint, so a change at Printify would not have failed a
  // publish. The agent must say the number is as of the last publish rather than present it as current.
  it("flags the recovered price as unverified rather than presenting it as current", async () => {
    listPublishedProducts.mockResolvedValue([product()])
    expect((await listPublishedProductRecipes()).models[0]!.unverified).toContain("variants[].price")
  })

  it("names the published product whose size chart would be copied", async () => {
    listPublishedProducts.mockResolvedValue([product()])
    // Its title travels with it, so the copy can tell a heading repeating it from the garment's own.
    expect((await listPublishedProductRecipes()).models[0]!.sizeGuideDonor).toMatchObject({
      productId: "tee-a",
      title: "Sample Morning Scene",
      sizes: ["M", "XL"],
    })
  })

  // The list arrives in the owner's Featured order. Whose prices and measurements get copied must
  // not move when the owner drags a tee up the Products page.
  it("copies from the lowest product id, whatever order the shop lists its tees in", async () => {
    const later = product({
      id: "tee-b",
      description: sizeGuide.replaceAll("XL", "2XL"),
      variants: [{ id: 1001, price: 3100, is_enabled: true, options: [1, 10] }],
    })
    listPublishedProducts.mockResolvedValue([later, product()])
    const featuredFirst = await listPublishedProductRecipes()
    listPublishedProducts.mockResolvedValue([product(), later])
    expect(await listPublishedProductRecipes()).toEqual(featuredFirst)

    const [model] = featuredFirst.models
    expect(model!.productIds).toEqual(["tee-a", "tee-b"])
    expect(model!.variants).toEqual([{ id: 1001, price: 2800, color: "CVC Black", size: "M" }])
    expect(model!.sizeGuideDonor).toMatchObject({ productId: "tee-a", sizes: ["M", "XL"] })
  })

  it("keeps an earlier unmarked chart usable when it becomes the donor ahead of a marked chart", async () => {
    const garment = sizeGuide.replace(' id="size-guide"', "")
    const earlier = product({ description: garment })
    const later = product({ id: "tee-b", description: sizeGuide.replace("20", "21") })
    listPublishedProducts.mockResolvedValue([later, earlier])
    const recovered = await listPublishedProductRecipes()
    listPublishedProducts.mockResolvedValue([earlier, later])
    expect(await listPublishedProductRecipes()).toEqual(recovered)

    const model = recovered.models[0]!
    expect(model.sizeGuideDonor).toMatchObject({ productId: "tee-a", description: garment, sizes: ["M", "XL"] })
    const result = buildDesignRecipe({
      model,
      modelLabel: "Next Level 6210",
      catalog: [{ id: 1001, color: "CVC Black", size: "M", available: true }],
      design: { summary: "A fresh joke.", colors: [{ name: "CVC Black", position: 0 }] },
    })
    expect(result.blockers).toEqual([])
    expect(result.recipe?.description).toBe(`<p><strong>The design</strong></p><p>A fresh joke.</p>${garment}`)
  })

  it("skips an earlier ambiguous description so a later copyable chart can still produce a draft", async () => {
    const chart = sizeGuide.slice(sizeGuide.indexOf("<table")).replace(' id="size-guide"', "")
    const marked = chart.replace("<table>", '<table id="size-guide">')
    const earlier = product({
      description: `${marked}<p>Somebody else's joke.</p><p><strong>The tee</strong></p><p>Soft cotton.</p>${chart.replace("20", "21")}`,
    })
    const laterDescription = `<p>Another old joke.</p>${sizeGuide}`
    const later = product({ id: "tee-b", description: laterDescription })
    listPublishedProducts.mockResolvedValue([earlier, later])
    const recovered = await listPublishedProductRecipes()
    listPublishedProducts.mockResolvedValue([later, earlier])
    expect(await listPublishedProductRecipes()).toEqual(recovered)

    const model = recovered.models[0]!
    expect(model.sizeGuideDonor).toMatchObject({
      productId: "tee-b",
      description: laterDescription,
      sizes: ["M", "XL"],
    })
    const result = buildDesignRecipe({
      model,
      modelLabel: "Next Level 6210",
      catalog: [{ id: 1001, color: "CVC Black", size: "M", available: true }],
      design: { summary: "A fresh joke.", colors: [{ name: "CVC Black", position: 0 }] },
    })
    expect(result.blockers).toEqual([])
    expect(result.recipe?.description).toBe(`<p><strong>The design</strong></p><p>A fresh joke.</p>${sizeGuide}`)
  })

  it.each([' id="size-guide"', ""])(
    "recovers a leading chart and builds from the same measurements (%s)",
    async (marker) => {
      const chart = sizeGuide.slice(sizeGuide.indexOf("<table")).replace(' id="size-guide"', marker)
      const details = "<p><strong>The tee</strong></p><p>Soft cotton.</p>"
      const description = `<h2>Size guide</h2>${chart}<p>Somebody else's joke.</p>${details}`
      listPublishedProducts.mockResolvedValue([product({ description })])

      const model = (await listPublishedProductRecipes()).models[0]!
      expect(model.sizeGuideDonor).toMatchObject({ productId: "tee-a", sizes: ["M", "XL"] })
      const result = buildDesignRecipe({
        model,
        modelLabel: "Next Level 6210",
        catalog: [{ id: 1001, color: "CVC Black", size: "M", available: true }],
        design: { summary: "A fresh joke.", colors: [{ name: "CVC Black", position: 0 }] },
      })
      expect(result.blockers).toEqual([])
      expect(result.recipe?.description).toBe(
        `<p><strong>The design</strong></p><p>A fresh joke.</p>${details}${chart}`
      )
    }
  )

  it("blocks a model with only unreadable charts or missing garment sections", async () => {
    const chart = sizeGuide.slice(sizeGuide.indexOf("<table")).replace(' id="size-guide"', "")
    listPublishedProducts.mockResolvedValue([
      product({ description: '<p><strong>The tee</strong></p><table id="size-guide"></table>' }),
      product({ id: "tee-b", description: `<p>No garment heading.</p>${chart}` }),
    ])

    const model = (await listPublishedProductRecipes()).models[0]!
    expect(model.sizeGuideDonor).toBeNull()
    expect(model.blocked).toContain(
      "No published product of this model has a garment section with a size chart to copy"
    )
  })

  // A size chart describes the garment, not the artwork, so a tee printed on the back can lend its
  // measurements even though its placement cannot stand in for another tee's.
  it("copies a size chart from a tee whose own placement is unreadable", async () => {
    listPublishedProducts.mockResolvedValue([
      product({
        print_areas: [
          {
            variant_ids: [1001],
            placeholders: [{ position: "back", images: [{ id: "b", x: 0.5, y: 0.5, scale: 1, angle: 0 }] }],
          },
        ],
      }),
      product({ id: "tee-b", description: "<p>Just a tee.</p>" }),
    ])
    const [model] = (await listPublishedProductRecipes()).models
    expect(model!.sizeGuideDonor).toMatchObject({ productId: "tee-a" })
    expect(model!.placement).toEqual({ position: "front", x: 0.5, y: 0.1, scale: 0.63, angle: 0 })
    expect(model!.blocked).toEqual([])
  })

  // Measurements are facts about a real garment. With nothing to copy, the model is refused rather
  // than offered with invented ones.
  it("refuses a model with no size chart to copy", async () => {
    listPublishedProducts.mockResolvedValue([product({ description: "<p>Just a tee.</p>" })])
    expect((await listPublishedProductRecipes()).models[0]!.blocked).toContain(
      "No published product of this model has a garment section with a size chart to copy"
    )
    expect((await listPublishedProductRecipes()).models[0]!.sizeGuideDonor).toBeNull()
  })

  it("copies a stable placement donor when distinct published designs are sized differently", async () => {
    const later = product({
      id: "tee-b",
      print_areas: [
        {
          variant_ids: [1001],
          placeholders: [{ position: "front", images: [{ id: "art", x: 0.5, y: 0.4, scale: 0.9, angle: 0 }] }],
        },
      ],
    })
    listPublishedProducts.mockResolvedValue([later, product()])
    const result = await listPublishedProductRecipes()
    expect(result.models[0]).toMatchObject({
      placement: { position: "front", x: 0.5, y: 0.1, scale: 0.63, angle: 0 },
      placementDonorProductId: "tee-a",
      placementDonorTitle: "Sample Morning Scene",
      unverified: ["variants[].price", "placement"],
      blocked: [],
    })
    listPublishedProducts.mockResolvedValue([product(), later])
    expect(await listPublishedProductRecipes()).toEqual(result)
  })

  it("keeps an untitled donor's identity separate from the other published titles", async () => {
    listPublishedProducts.mockResolvedValue([
      product({ title: undefined }),
      product({ id: "tee-b", title: "Sample Evening Scene" }),
    ])
    expect((await listPublishedProductRecipes()).models[0]).toMatchObject({
      titles: ["Sample Evening Scene"],
      placementDonorProductId: "tee-a",
      placementDonorTitle: null,
      unverified: ["variants[].price"],
    })
  })

  it("does not flag an unsupported later product as a conflicting placement", async () => {
    listPublishedProducts.mockResolvedValue([
      product(),
      product({
        id: "tee-b",
        print_areas: [
          {
            variant_ids: [1001],
            placeholders: [
              { position: "front", images: [{ id: "art", x: 0.5, y: 0.4, scale: 0.9, angle: 0 }] },
              { position: "back", images: [{ id: "back", x: 0.5, y: 0.5, scale: 1, angle: 0 }] },
            ],
          },
        ],
      }),
    ])
    expect((await listPublishedProductRecipes()).models[0]).toMatchObject({
      placementDonorProductId: "tee-a",
      unverified: ["variants[].price"],
      blocked: [],
    })
  })

  it.each(["auto", "#000", "#000000", "#000000FF"])(
    "recovers raster placement alongside care-label %s defaults",
    async (color) => {
      listPublishedProducts.mockResolvedValue([
        product({
          print_details: [],
          print_areas: [
            {
              variant_ids: [1001],
              background: "transparent",
              font_color: color,
              font_family: "Roboto",
              placeholders: [
                {
                  position: "front",
                  decoration_method: "dtg",
                  images: [{ id: "art", x: 0.5, y: 0.1, scale: 0.63, angle: 0 }],
                },
                { position: "back", decoration_method: "dtg", images: [] },
                {
                  position: "neck",
                  decoration_method: "dtf",
                  images: [
                    { id: "care", name: "text_layer.svg", type: "text/plain", x: 0.5, y: 0.5, scale: 1, angle: 0 },
                  ],
                },
              ],
            },
          ],
        }),
      ])
      expect((await listPublishedProductRecipes()).models[0]).toMatchObject({
        placement: { position: "front", x: 0.5, y: 0.1, scale: 0.63, angle: 0 },
        placementDonorProductId: "tee-a",
        blocked: [],
      })
    }
  )

  it("skips a donor whose variants disagree about placement and selects the next usable product", async () => {
    const conflicting = product({
      print_areas: [
        {
          variant_ids: [1001],
          placeholders: [{ position: "front", images: [{ id: "a", x: 0.5, y: 0.1, scale: 0.6, angle: 0 }] }],
        },
        {
          variant_ids: [1002],
          placeholders: [{ position: "front", images: [{ id: "a", x: 0.5, y: 0.2, scale: 0.6, angle: 0 }] }],
        },
      ],
    })
    listPublishedProducts.mockResolvedValue([conflicting])
    expect((await listPublishedProductRecipes()).models[0]!.placement).toBeNull()

    listPublishedProducts.mockResolvedValue([conflicting, product({ id: "tee-b" })])
    expect((await listPublishedProductRecipes()).models[0]).toMatchObject({
      placementDonorProductId: "tee-b",
      blocked: [],
    })
  })

  // Each fixture keeps a front placement that reads perfectly well on its own, so the only thing
  // that can refuse it is the guard the case is named for.
  it.each([
    [
      "artwork on the back as well",
      {
        variant_ids: [1001],
        placeholders: [
          { position: "front", images: [{ id: "a", x: 0.5, y: 0.1, scale: 0.63, angle: 0 }] },
          { position: "back", images: [{ id: "b", x: 0.5, y: 0.5, scale: 1, angle: 0 }] },
        ],
      },
    ],
    [
      "two layers on the front",
      {
        variant_ids: [1001],
        placeholders: [
          {
            position: "front",
            images: [
              { id: "a", x: 0.5, y: 0.1, scale: 0.6, angle: 0 },
              { id: "b", x: 0.5, y: 0.1, scale: 0.6, angle: 0 },
            ],
          },
        ],
      },
    ],
  ])("refuses a model with %s, which no single placement can describe", async (_label, area) => {
    listPublishedProducts.mockResolvedValue([product({ print_areas: [area] })])
    const [model] = (await listPublishedProductRecipes()).models
    expect(model!.placement).toBeNull()
    expect(model!.placementDonorProductId).toBeNull()
    expect(model!.placementDonorTitle).toBeNull()
    expect(model!.blocked).toContain("No usable artwork placement was recovered")
  })

  it("separates two different models rather than merging them", async () => {
    listPublishedProducts.mockResolvedValue([product(), product({ id: "hoodie", blueprint_id: 49 })])
    expect((await listPublishedProductRecipes()).models.map((model) => model.blueprintId)).toEqual([49, 1317])
  })

  it("reports a product it could not read instead of quietly dropping it", async () => {
    listPublishedProducts.mockResolvedValue([product(), { id: "broken" }])
    const result = await listPublishedProductRecipes()
    expect(result.skipped).toEqual([{ productId: "broken", reasons: ["The saved product could not be read"] }])
    expect(result.models).toHaveLength(1)
  })
})
