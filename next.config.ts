import type { NextConfig } from "next"

import { productImageRemotePatterns } from "./src/features/catalog/product-image-remote-patterns"
import { env } from "./src/lib/env"

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  agentRules: false,
  // Keep initial head hydration and navigation in one metadata lifecycle. The pinned
  // Next patch also applies this opt-out to prerendered pages (see docs/metadata.md).
  htmlLimitedBots: /.*/,
  async rewrites() {
    return [{ source: "/sitemap.xml", destination: "/sitemap" }]
  },
  images: {
    formats: ["image/avif", "image/webp"],
    // Mobile cards and 2x gallery photos fit between the framework's default widths.
    deviceSizes: [360, 480, 640, 750, 828, 1080, 1200, 1440, 1920, 2048, 3840],
    imageSizes: [32, 48, 64, 96, 128, 160, 192, 256],
    remotePatterns: productImageRemotePatterns(env.NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST),
  },
}

export default config
