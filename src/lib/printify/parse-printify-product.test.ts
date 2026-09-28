import { describe, expect, it, vi } from "vitest"

import { parsePrintifyProduct } from "./parse-printify-product"

vi.mock("server-only", () => ({}))

const expected = { productId: "published-shirt", shopId: "1234" }

function productFixture() {
  return {
    id: expected.productId,
    shop_id: 1234,
    title: "Sample Morning Scene",
    blueprint_id: 1317,
    print_provider_id: 99,
    print_areas: [
      {
        variant_ids: [101],
        placeholders: [
          {
            position: "front",
            images: [{ id: "retained-artwork", imageId: "response-a", x: 0.5, y: 0.4, scale: 0.9, angle: 0 }],
          },
        ],
      },
    ],
    variants: [{ id: 101, sku: "shirt-medium", price: 3000, is_enabled: true, is_available: true, options: [1] }],
    options: [{ name: "Size", values: [{ id: 1, title: "M" }] }],
  }
}

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, entry]) => [key, reverseObjectKeys(entry)])
  )
}

describe("Printify production product parsing", () => {
  it.each([
    { country: "Honduras" },
    { canvas: false },
    { country: "Nicaragua", canvas: true },
    { country: null, canvas: null },
    { country: 123, canvas: "unused-provider-value" },
  ])("ignores unused provider fields without changing production identity: %j", (additions) => {
    const product = productFixture()
    const before = parsePrintifyProduct(product, expected)!.variants[0]!
    Object.assign(product.print_areas[0]!, additions)
    const after = parsePrintifyProduct(product, expected)!.variants[0]!
    expect(after.fingerprint).toBe(before.fingerprint)
    expect(after.designFingerprint).toBe(before.designFingerprint)
    product.print_areas[0]!.placeholders[0]!.images[0]!.scale = 0.5
    expect(parsePrintifyProduct(product, expected)!.variants[0]!.fingerprint).not.toBe(before.fingerprint)
  })

  it.each(["garment", "provider"])("still fingerprints the %s while ignoring provider fields", (change) => {
    const product = productFixture()
    const original = parsePrintifyProduct(product, expected)!.variants[0]!
    if (change === "garment") product.blueprint_id = 999
    else product.print_provider_id = 11
    const changed = parsePrintifyProduct(product, expected)!.variants[0]!
    expect(changed.fingerprint).not.toBe(original.fingerprint)
    expect(changed.designFingerprint).not.toBe(original.designFingerprint)
    Object.assign(product.print_areas[0]!, { country: "Nicaragua", canvas: true })
    const withProviderFields = parsePrintifyProduct(product, expected)!.variants[0]!
    expect(withProviderFields.fingerprint).toBe(changed.fingerprint)
    expect(withProviderFields.designFingerprint).toBe(changed.designFingerprint)
  })

  it("selects the default mockup for each pictured variant", () => {
    const product = productFixture()
    product.variants.push({ ...product.variants[0]!, id: 102, sku: "shirt-large", options: [2] })
    product.print_areas[0]!.variant_ids.push(102)
    const parsed = parsePrintifyProduct(
      {
        ...product,
        images: [
          { src: "https://images.printify.com/large.jpg", variant_ids: [102], is_default: true },
          { src: "https://images.printify.com/medium-back.jpg", variant_ids: [101] },
          { src: "https://images.printify.com/medium-front.jpg", variant_ids: [101], is_default: true },
        ],
      },
      expected
    )
    expect(parsed?.variants.map(({ id, imageUrl }) => ({ id, imageUrl }))).toEqual([
      { id: 101, imageUrl: "https://images.printify.com/medium-front.jpg" },
      { id: 102, imageUrl: "https://images.printify.com/large.jpg" },
    ])
  })

  it("uses the first matching mockup when that variant has no default", () => {
    const parsed = parsePrintifyProduct(
      {
        ...productFixture(),
        images: [
          { src: "https://images.printify.com/another-color.jpg", variant_ids: [102], is_default: true },
          { src: "https://images.printify.com/medium-front.jpg", variant_ids: [101] },
          { src: "https://images.printify.com/medium-back.jpg", variant_ids: [101] },
        ],
      },
      expected
    )
    expect(parsed?.variants[0]?.imageUrl).toBe("https://images.printify.com/medium-front.jpg")
  })

  it("omits the photo when only other variants have mockups", () => {
    const parsed = parsePrintifyProduct(
      {
        ...productFixture(),
        images: [{ src: "https://images.printify.com/another-color.jpg", variant_ids: [102], is_default: true }],
      },
      expected
    )
    expect(parsed).not.toBeNull()
    expect(parsed!.variants[0]).not.toHaveProperty("imageUrl")
  })

  it.each([
    { name: "missing", images: undefined },
    { name: "null", images: null },
    { name: "object", images: {} },
    { name: "string", images: "invalid" },
    { name: "empty", images: [] },
  ])("keeps products with $name mockup data available without a photo", ({ images }) => {
    const parsed = parsePrintifyProduct({ ...productFixture(), images }, expected)
    expect(parsed).not.toBeNull()
    expect(parsed!.variants[0]).not.toHaveProperty("imageUrl")
  })

  it.each([
    null,
    {},
    { src: "not-a-url", variant_ids: [101] },
    { src: "http://images.printify.com/insecure.jpg", variant_ids: [101] },
    { src: "https://user:password@images.printify.com/private.jpg", variant_ids: [101] },
    { src: "https://user@images.printify.com/private.jpg", variant_ids: [101] },
    { src: "https://images.printify.com/missing-variants.jpg" },
    { src: "https://images.printify.com/invalid-variants.jpg", variant_ids: ["101"] },
    { src: "https://images.printify.com/invalid-default.jpg", variant_ids: [101], is_default: "true" },
  ])("skips a malformed or unsafe mockup while retaining valid photos: %j", (invalid) => {
    const parsed = parsePrintifyProduct(
      {
        ...productFixture(),
        images: [invalid, { src: "https://images.printify.com/valid.jpg", variant_ids: [101] }],
      },
      expected
    )
    expect(parsed?.variants[0]?.imageUrl).toBe("https://images.printify.com/valid.jpg")
  })

  it("preserves every production fingerprint when mockups are added or replaced", () => {
    const product = productFixture()
    const before = parsePrintifyProduct(product, expected)!.variants[0]!
    for (const src of ["https://images.printify.com/first.jpg", "https://images.printify.com/replaced.jpg"]) {
      const parsed = parsePrintifyProduct({ ...product, images: [{ src, variant_ids: [101] }] }, expected)
      expect(parsed?.variants[0]).toMatchObject({
        imageUrl: src,
        fingerprint: before.fingerprint,
        designFingerprint: before.designFingerprint,
      })
    }
  })

  it("keeps the production fingerprint stable across regenerated imageId and object key ordering", () => {
    const product = productFixture()
    const before = parsePrintifyProduct(product, expected)
    product.print_areas[0]!.placeholders[0]!.images[0]!.imageId = "response-b"
    const after = parsePrintifyProduct(reverseObjectKeys(product), expected)
    expect(before?.variants[0]?.fingerprint).toMatch(/^v2:[a-f0-9]{64}$/)
    expect(after?.variants[0]?.fingerprint).toBe(before?.variants[0]?.fingerprint)
  })

  it("generates the current production and design fingerprint format", () => {
    expect(parsePrintifyProduct(productFixture(), expected)?.variants[0]).toMatchObject({
      fingerprint: "v2:02de7a79fbc060a521994d4bc47aa110e62340350702d10cdb60e3681a66eb99",
      designFingerprint: "v2:72f0085b833dc6dd7e9d437d5cf0e240bfc8e96de307f9c16b13f27952754fd5",
    })
  })

  it("ignores retrieval URL and file-name metadata while retaining the uploaded file identity", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const product = productFixture()
    const before = parsePrintifyProduct(product, expected)
    Object.assign(product.print_areas[0]!.placeholders[0]!.images[0]!, {
      src: "https://images.printify.com/file.png?signature=refreshed",
      name: "Renamed source file.png",
    })
    expect(parsePrintifyProduct(product, expected)?.variants[0]?.fingerprint).toBe(before?.variants[0]?.fingerprint)
    expect(log).not.toHaveBeenCalled()
  })

  it.each([undefined, null, 123, false, { unused: "metadata" }, ["metadata"]])(
    "does not validate unused artwork retrieval metadata: %j",
    (value) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {})
      const product = productFixture()
      const before = parsePrintifyProduct(product, expected)!.variants[0]!
      const image = product.print_areas[0]!.placeholders[0]!.images[0]!
      for (const field of ["src", "name", "imageId"]) {
        if (value === undefined) Reflect.deleteProperty(image, field)
        else Object.assign(image, { [field]: value })
      }

      const after = parsePrintifyProduct(product, expected)!.variants[0]!
      expect(after.fingerprint).toBe(before.fingerprint)
      expect(after.designFingerprint).toBe(before.designFingerprint)
      expect(log).not.toHaveBeenCalled()
    }
  )

  it.each([undefined, null, 123, false, { unused: "name" }, ["name"]])(
    "does not require an unused option name to produce the selected size label: %j",
    (value) => {
      const product = productFixture()
      const before = parsePrintifyProduct(product, expected)
      if (value === undefined) Reflect.deleteProperty(product.options[0]!, "name")
      else Object.assign(product.options[0]!, { name: value })

      const after = parsePrintifyProduct(product, expected)
      expect(after).toEqual(before)
      expect(after?.variants[0]?.label).toBe("M")
    }
  )

  it("ignores sibling assignment changes and other variants' designs", () => {
    const product = productFixture()
    const original = parsePrintifyProduct(product, expected)!.variants[0]!
    product.variants.push({ ...product.variants[0]!, id: 102, sku: "shirt-large", options: [2] })
    product.print_areas[0]!.variant_ids = [102, 101]
    let parsed = parsePrintifyProduct(product, expected)!
    expect(parsed.variants[0]!.fingerprint).toBe(original.fingerprint)
    expect(parsed.variants[1]!.designFingerprint).toBe(original.designFingerprint)
    expect(parsed.variants[1]!.fingerprint).not.toBe(original.fingerprint)
    const siblingArea = structuredClone(product.print_areas[0]!)
    siblingArea.variant_ids = [102]
    siblingArea.placeholders[0]!.images[0]!.id = "sibling-only-artwork"
    product.print_areas[0]!.variant_ids = [101]
    product.print_areas.unshift(siblingArea)
    parsed = parsePrintifyProduct(product, expected)!
    expect(parsed.variants[0]!.fingerprint).toBe(original.fingerprint)
    expect(parsed.variants[1]!.designFingerprint).not.toBe(original.designFingerprint)
  })

  it("ignores placeholder and option ordering while preserving the order of printed layers", () => {
    const product = productFixture()
    const front = product.print_areas[0]!.placeholders[0]!
    front.images.push({ ...front.images[0]!, id: "overlaid-artwork" })
    product.print_areas[0]!.placeholders.push({ ...structuredClone(front), position: "back" })
    product.variants[0]!.options.push(2)
    const before = parsePrintifyProduct(product, expected)!
    product.print_areas[0]!.placeholders.reverse()
    product.variants[0]!.options.reverse()
    expect(parsePrintifyProduct(product, expected)!.variants[0]!.fingerprint).toBe(before.variants[0]!.fingerprint)
    front.images.reverse()
    expect(parsePrintifyProduct(product, expected)!.variants[0]!.fingerprint).not.toBe(before.variants[0]!.fingerprint)
  })

  it.each([
    { type: "text/plain" },
    { layerType: "text" },
    { width: 4000 },
    { height: 4800 },
    { flipX: true },
    { flipY: true },
    { input_text: "Another illustration caption", font_family: "Roboto", font_size: 24 },
    { font_color: "#ff0000", font_style: "italic", font_weight: "bold", text_align: "right" },
    { pattern: { spacing_x: 0.1, spacing_y: 0.2, angle: 30, offset: 0.5 } },
  ])("retains supported image, text, and pattern controls: %j", (control) => {
    const product = productFixture()
    const before = parsePrintifyProduct(product, expected)!
    Object.assign(product.print_areas[0]!.placeholders[0]!.images[0]!, control)
    const after = parsePrintifyProduct(product, expected)
    expect(after).not.toBeNull()
    expect(after!.variants[0]!.fingerprint).not.toBe(before.variants[0]!.fingerprint)
  })

  it.each(["background", "font", "decoration", "print-details", "layer-order"])(
    "retains production settings outside image geometry: %s",
    (change) => {
      const product = productFixture()
      const before = parsePrintifyProduct(product, expected)!
      const area = product.print_areas[0]!
      if (change === "background") Object.assign(area, { background: "#ff0000" })
      if (change === "font") Object.assign(area, { font_family: "Roboto", font_color: "#ff0000" })
      if (change === "decoration") Object.assign(area.placeholders[0]!, { decoration_method: "embroidery" })
      if (change === "print-details") Object.assign(product, { print_details: { print_on_side: "mirror" } })
      if (change === "layer-order")
        area.placeholders[0]!.images.unshift({ ...area.placeholders[0]!.images[0]!, id: "another-layer" })
      const after = parsePrintifyProduct(product, expected)
      expect(after).not.toBeNull()
      expect(after!.variants[0]!.fingerprint).not.toBe(before.variants[0]!.fingerprint)
    }
  )

  it.each(["image", "pattern", "placeholder", "area", "print-details"])(
    "ignores extra provider attributes at the %s level without changing v2 identity",
    (level) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {})
      const product = productFixture()
      const area = product.print_areas[0]!
      const pattern = { spacing_x: 0.1, spacing_y: 0.2, angle: 30, offset: 0.5 }
      const printDetails = { print_on_side: "regular" }
      if (level === "pattern") Object.assign(area.placeholders[0]!.images[0]!, { pattern })
      if (level === "print-details") Object.assign(product, { print_details: printDetails })
      const before = parsePrintifyProduct(product, expected)!.variants[0]!
      const extra = { provider_metadata: { value: "unused", revision: 2 } }
      if (level === "image") Object.assign(area.placeholders[0]!.images[0]!, extra)
      if (level === "pattern") Object.assign(pattern, extra)
      if (level === "placeholder") Object.assign(area.placeholders[0]!, extra)
      if (level === "area") Object.assign(area, extra)
      if (level === "print-details") Object.assign(printDetails, extra)

      const after = parsePrintifyProduct(product, expected)!.variants[0]!
      expect(after.fingerprint).toBe(before.fingerprint)
      expect(after.designFingerprint).toBe(before.designFingerprint)
      expect(log).not.toHaveBeenCalled()
    }
  )

  it.each(["image", "pattern", "placeholder", "area", "print-details"])(
    "rejects malformed production data at the %s level and emits a bounded signal",
    (level) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {})
      const product = productFixture()
      const area = product.print_areas[0]!
      if (level === "image") Object.assign(area.placeholders[0]!.images[0]!, { scale: "invalid" })
      if (level === "pattern")
        Object.assign(area.placeholders[0]!.images[0]!, {
          pattern: { spacing_x: "invalid", spacing_y: 0.2, angle: 30, offset: 0.5 },
        })
      if (level === "placeholder") Object.assign(area.placeholders[0]!, { position: 123 })
      if (level === "area") Object.assign(area, { background: { invalid: "color" } })
      if (level === "print-details") Object.assign(product, { print_details: { print_on_side: false } })
      expect(parsePrintifyProduct(product, expected)).toBeNull()
      expect(log).toHaveBeenCalledExactlyOnceWith("Printify production schema changed", {
        code: "PRODUCT_SCHEMA_DRIFT",
        productId: expected.productId,
        shopId: expected.shopId,
      })
    }
  )

  it("preserves distinct fingerprints for absent, array, and object print details", () => {
    const product = productFixture()
    const variants = [product, { ...product, print_details: [] }, { ...product, print_details: {} }].map(
      (raw) => parsePrintifyProduct(raw, expected)!.variants[0]!
    )

    expect(new Set(variants.map((variant) => variant.fingerprint)).size).toBe(3)
    expect(new Set(variants.map((variant) => variant.designFingerprint)).size).toBe(3)
  })

  it("logs one bounded signal without raw values, unknown field names, or unsafe identifiers", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const product = productFixture()
    product.id = "unsafe\nproduct-id"
    product.title = "Private product title"
    Object.assign(product.print_areas[0]!.placeholders[0]!.images[0]!, {
      "private-field-name": "https://private.example/art.png?token=secret",
      input_text: "Private printed text",
      scale: "Private invalid value",
    })
    Object.assign(product, { print_details: { print_on_side: { private_control: "private value" } } })
    expect(parsePrintifyProduct(product, { ...expected, productId: product.id })).toBeNull()
    expect(log).toHaveBeenCalledExactlyOnceWith("Printify production schema changed", {
      code: "PRODUCT_SCHEMA_DRIFT",
      shopId: expected.shopId,
    })
  })

  it("does not inspect production fields or log their failures for a mismatched product identity", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const product = productFixture()
    Object.assign(product.print_areas[0]!.placeholders[0]!.images[0]!, { scale: "invalid" })
    expect(parsePrintifyProduct(product, { ...expected, productId: "another-product" })).toBeNull()
    expect(parsePrintifyProduct(product, { ...expected, shopId: "2222" })).toBeNull()
    expect(log).not.toHaveBeenCalled()
  })

  it("rejects ambiguous enabled variant artwork while allowing unselected variants without a print area", () => {
    const product = productFixture()
    product.variants.push({ ...product.variants[0]!, id: 102, is_enabled: false })
    expect(parsePrintifyProduct(product, expected)).not.toBeNull()
    product.variants[1]!.is_enabled = true
    expect(parsePrintifyProduct(product, expected)).toBeNull()
    product.variants.pop()
    product.print_areas.push(structuredClone(product.print_areas[0]!))
    expect(parsePrintifyProduct(product, expected)).toBeNull()
  })

  it.each(["artwork", "placement", "scale", "rotation", "garment", "provider", "sku", "variant"])(
    "retains a real %s change in the production fingerprint",
    (change) => {
      const product = productFixture()
      const before = parsePrintifyProduct(product, expected)
      const image = product.print_areas[0]!.placeholders[0]!.images[0]!
      if (change === "artwork") image.id = "different-artwork"
      if (change === "placement") image.y = 0.8
      if (change === "scale") image.scale = 0.3
      if (change === "rotation") image.angle = 30
      if (change === "garment") product.blueprint_id = 999
      if (change === "provider") product.print_provider_id = 11
      if (change === "sku") product.variants[0]!.sku = "different-sku"
      if (change === "variant") product.variants[0]!.options = [2]
      expect(parsePrintifyProduct(product, expected)?.variants[0]?.fingerprint).not.toBe(
        before?.variants[0]?.fingerprint
      )
    }
  )

  it("separates listing and stock changes from production identity", () => {
    const product = productFixture()
    const before = parsePrintifyProduct(product, expected)
    product.title = "An unpublished title"
    product.variants[0]!.price = 3500
    product.variants[0]!.is_enabled = false
    product.variants[0]!.is_available = false
    product.options[0]!.values[0]!.title = "An unpublished size label"
    const after = parsePrintifyProduct(product, expected)
    expect(after?.variants[0]).toMatchObject({
      fingerprint: before?.variants[0]?.fingerprint,
      unitAmount: 3500,
      enabled: false,
      inStock: false,
      label: "An unpublished size label",
    })
  })

  it.each(["wrong-shop", "wrong-product", "duplicate-variant", "invalid-print-area"])(
    "rejects %s snapshots",
    (change) => {
      const product = productFixture()
      if (change === "wrong-shop") product.shop_id = 2222
      if (change === "wrong-product") product.id = "another-shirt"
      if (change === "duplicate-variant") product.variants.push(product.variants[0]!)
      const raw = change === "invalid-print-area" ? { ...product, print_areas: [] } : product
      expect(parsePrintifyProduct(raw, expected)).toBeNull()
    }
  )
})
