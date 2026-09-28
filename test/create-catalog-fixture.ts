export function createCatalogFixture(id = "shirt") {
  return {
    id,
    shop_id: 123,
    title: "Published tee",
    description: "Published description",
    blueprint_id: 1317,
    print_provider_id: 99,
    print_areas: [
      {
        variant_ids: [1, 2, 3],
        placeholders: [{ position: "front", images: [{ id: "private-artwork", x: 0.5, y: 0.5, scale: 1, angle: 0 }] }],
      },
    ],
    variants: [
      { id: 1, price: 2500, is_enabled: true, is_available: false, options: [10] },
      { id: 2, price: 2800, is_enabled: true, is_available: true, options: [20] },
      { id: 3, price: 3000, is_enabled: false, is_available: true, options: [30] },
    ],
    options: [
      {
        name: "Colors",
        type: "color",
        values: [
          { id: 10, title: "Grey", colors: ["#888888"] },
          { id: 20, title: "Green", colors: ["#126644"] },
          { id: 30, title: "Blue", colors: ["#123456"] },
        ],
      },
    ],
    images: [
      { src: "https://images.printify.com/grey.jpg", variant_ids: [1], is_default: false },
      { src: "https://images.printify.com/green.jpg", variant_ids: [2], is_default: true },
    ],
  }
}
