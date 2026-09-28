import { createHash } from "node:crypto"

import sharp from "sharp"

import type { LibraryStoredAsset } from "@/features/design-library/library-types"

export async function publishedArtworkFixture() {
  const bytes = await sharp({ create: { width: 1600, height: 2000, channels: 4, background: "#00000000" } })
    .composite([
      {
        input: Buffer.from(
          '<svg width="1600" height="2000"><rect x="200" y="200" width="1200" height="1600" fill="#cc4422"/></svg>'
        ),
      },
    ])
    .png()
    .toBuffer()
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  const asset: LibraryStoredAsset = {
    id: "5c87fbe5-31a8-4e9d-a04a-c3ecb3f0c7ea",
    kind: "print",
    status: "ready",
    mimeType: "image/png",
    width: 1600,
    height: 2000,
    bytes: bytes.length,
    sha256,
    pixelSha256: null,
    perceptualHash: null,
    hasAlpha: true,
    hasTransparency: true,
    enlarged: false,
    pathname: `concepts/5c87fbe5-31a8-4e9d-a04a-c3ecb3f0c7ea/${sha256}.png`,
    sourcePath: null,
    originalFilename: "private-approved-master.png",
    url: "/api/admin/assets/5c87fbe5-31a8-4e9d-a04a-c3ecb3f0c7ea",
  }
  const product = {
    id: "shirt",
    shop_id: 123,
    title: "Published A",
    description: "A tee",
    blueprint_id: 1317,
    print_provider_id: 99,
    print_areas: [
      {
        variant_ids: [101],
        placeholders: [{ position: "front", images: [{ id: "approved-art-v1", x: 0.5, y: 0.5, scale: 1, angle: 0 }] }],
      },
    ],
    variants: [{ id: 101, sku: "green-m", price: 3000, is_enabled: true, is_available: true, options: [1] }],
    options: [{ name: "Colors", type: "color", values: [{ id: 1, title: "Forest", colors: ["#254b41"] }] }],
    images: [{ src: "https://images-api.printify.com/mockup/shirt/forest.png", variant_ids: [101], is_default: true }],
    storefront_artwork_enabled: false,
  }
  return {
    bytes,
    asset,
    product,
    revisionId: "34d7df72-f329-45f9-acd5-faa4a0c10e25",
    expected: { shopId: "123", productId: "shirt" },
  }
}
