import { selectedProductIds } from "./catalog-product-ids"

const titles = ["Fixture First Design", "Fixture Second Design", "Fixture Newest Design"]
// Reuse the last selected slot so a second garment does not alter catalog counts or weekly fixtures.
const cropTopIndex = selectedProductIds.length - 1
export const catalogProducts = selectedProductIds.map((id, index) => ({
  id: id,
  shop_id: 123,
  visible: true,
  print_provider_id: 99,
  print_areas: [
    {
      variant_ids: [1001, 1002, 1003, 1004],
      placeholders: [{ position: "front", images: [{ id: "fixture-artwork", x: 0.5, y: 0.5, scale: 1, angle: 0 }] }],
    },
  ],
  blueprint_id: index === cropTopIndex ? 1312 : 1317,
  title:
    index === cropTopIndex
      ? "Fixture Festival Crop - Women's Festival Crop Top"
      : (titles[index] ?? `Fixture Tee ${index + 1}`),
  storefront_artwork_enabled: index !== 1,
  ...(index === 0
    ? {
        storefront_artwork: {
          src: `https://fixture.public.blob.vercel-storage.com/published-artwork/v1/${"e0".repeat(32)}.webp`,
          revisionId: "00000000-0000-4000-8000-000000000001",
          productionFingerprint: `artwork-v1:${"e0".repeat(32)}`,
          width: 940,
          height: 1200,
        },
      }
    : {}),
  description:
    index === cropTopIndex
      ? '<p><strong>The design</strong></p><p>Good company, a shorter hem, and plenty of room for everyday plans.</p><p><strong>The crop top</strong></p><ul><li>Next Level 5080 festival crop top</li><li>65% polyester, 35% cotton</li><li>Modest crop with a relaxed fit</li></ul><p><strong>Care</strong></p><ol><li>Wash cold</li><li>Dry low</li></ol><table id="size-guide"><thead><tr><th></th><th>M</th><th>XL</th></tr></thead><tbody><tr><td>Width, in</td><td>19</td><td>21</td></tr><tr><td>Length, in</td><td>18</td><td>19</td></tr></tbody></table>'
      : '<p><strong>The design</strong></p><p>A soft everyday tee for good company.</p><p><strong>The tee</strong></p><p>Printed on the Next Level 6210 for everyday wear.</p><ul><li>60% cotton, 40% polyester</li><li>Lightweight fabric</li><li>Tear-away label</li></ul><p><strong>Care</strong></p><ol><li>Wash cold</li><li>Dry low</li></ol><table id="size-guide"><thead><tr><th></th><th>M</th><th>XL</th></tr></thead><tbody><tr><td>Width, in</td><td>20</td><td>24</td></tr><tr><td>Length, in</td><td>29</td><td>31</td></tr></tbody></table>',
  created_at: index < 3 ? `${2024 + index}-01-01 12:00:00+00:00` : "2023-01-01 12:00:00+00:00",
  variants: [
    { id: 1001, price: 2800, title: "Black / M", is_enabled: true, is_available: true, options: [1, 10] },
    { id: 1002, price: 2800, title: "Black / L", is_enabled: true, is_available: false, options: [1, 11] },
    { id: 1003, price: 2800, title: "Clay / M", is_enabled: true, is_available: true, options: [2, 10] },
    { id: 1004, price: 3200, title: "Clay / XL", is_enabled: true, is_available: true, options: [2, 12] },
  ],
  options: [
    {
      name: "Colors",
      type: "color",
      values: [
        { id: 1, title: "Black", colors: ["#17262d"] },
        { id: 2, title: "Clay", colors: ["#bc735c"] },
      ],
    },
    {
      name: "Sizes",
      type: "size",
      values: [
        { id: 10, title: "M" },
        { id: 11, title: "L" },
        { id: 12, title: "XL" },
      ],
    },
  ],
  images: [
    { src: "https://e2e.test/shirt.png", variant_ids: [1001, 1002], is_default: false },
    { src: "https://e2e.test/clay-shirt.png", variant_ids: [1003, 1004], is_default: true },
    ...(index === 0
      ? [
          { src: "https://e2e.test/shirt-back.png", variant_ids: [1001, 1002], is_default: false },
          { src: "https://e2e.test/clay-shirt-back.png", variant_ids: [1003, 1004], is_default: false },
        ]
      : []),
  ],
}))
