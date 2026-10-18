export function galleryProductFixture() {
  const host = "galleryfixtures.public.blob.vercel-storage.com"
  return {
    id: "shirt",
    shop_id: 123,
    title: "Fixture tee",
    description: "A cotton T-shirt.",
    blueprint_id: 12,
    print_provider_id: 99,
    variants: [
      { id: 101, sku: "black-m", price: 3300, is_enabled: true, is_available: true, options: [10, 100] },
      { id: 201, sku: "navy-m", price: 3300, is_enabled: true, is_available: true, options: [20, 100] },
    ],
    options: [
      {
        name: "Colors",
        type: "color",
        values: [
          { id: 10, title: "Black", colors: ["#222222"] },
          { id: 20, title: "Navy", colors: ["#001144"] },
        ],
      },
      {
        name: "Sizes",
        type: "size",
        values: [
          { id: 100, title: "M" },
          { id: 102, title: "L" },
        ],
      },
    ],
    print_areas: [
      {
        variant_ids: [101, 201],
        placeholders: [{ position: "front", images: [{ id: "art-v1", x: 0.5, y: 0.4, scale: 1, angle: 0 }] }],
      },
    ],
    images: [
      { src: `https://${host}/published-mockups/v1/${"a".repeat(64)}.jpg`, variant_ids: [101, 201], is_default: true },
    ],
    storefront_artwork_enabled: false,
  }
}
