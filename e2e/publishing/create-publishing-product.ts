import { publishingTestConfig as config } from "./publishing-test-config"

export function createPublishingProduct(id: string) {
  return {
    id,
    shop_id: Number(config.shopId),
    title: "Publishing Good Hangs",
    description: "<p>Published description for good company.</p>",
    is_locked: true,
    visible: true,
    blueprint_id: 1317,
    print_provider_id: 99,
    created_at: "2026-09-01T12:00:00Z",
    updated_at: "2026-09-09T12:00:00Z",
    print_areas: [
      {
        variant_ids: [101, 102],
        placeholders: [{ position: "front", images: [{ id: "fixture-art", x: 0.5, y: 0.5, scale: 1, angle: 0 }] }],
      },
    ],
    variants: [
      { id: 101, sku: "fixture-forest-m", price: 3000, is_enabled: true, is_available: true, options: [1, 3] },
      { id: 102, sku: "fixture-clay-m", price: 3200, is_enabled: true, is_available: true, options: [2, 3] },
    ],
    options: [
      {
        name: "Colors",
        type: "color",
        values: [
          { id: 1, title: "Forest", colors: ["#254b41"] },
          { id: 2, title: "Clay", colors: ["#bc735c"] },
        ],
      },
      { name: "Sizes", type: "size", values: [{ id: 3, title: "M" }] },
    ],
    images: [
      {
        src: `https://images-api.printify.com/mockup/${id}/forest.png`,
        variant_ids: [101],
        is_default: true,
        is_selected_for_publishing: true,
      },
      {
        src: `https://images-api.printify.com/mockup/${id}/clay.png`,
        variant_ids: [102],
        is_default: false,
        is_selected_for_publishing: true,
      },
    ],
  }
}
