import type { NextConfig } from "next"

import { productImageRemotePatterns } from "./src/features/catalog/product-image-remote-patterns"
import { localImagePatterns } from "./src/lib/local-image-patterns"
import { storeConfig } from "./src/lib/store-config"
import { env } from "./src/lib/env"

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  agentRules: false,
  // Keep initial head hydration and navigation in one metadata lifecycle. The pinned
  // Next patch also applies this opt-out to prerendered pages (see docs/metadata.md).
  htmlLimitedBots: /.*/,
  async rewrites() {
    // Route folders are kebab-case, so the dotted public names map onto plain routes.
    return [
      { source: "/sitemap.xml", destination: "/sitemap" },
      { source: "/llms.txt", destination: "/llms" },
    ]
  },
  images: {
    formats: ["image/avif", "image/webp"],
    // Mobile cards and 2x gallery photos fit between the framework's default widths.
    deviceSizes: [360, 480, 640, 750, 828, 1080, 1200, 1440, 1920, 2048, 3840],
    localPatterns: localImagePatterns(storeConfig.logo.src),
    imageSizes: [32, 48, 64, 96, 128, 160, 192, 256],
    remotePatterns: productImageRemotePatterns(env.NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST),
  },
}

export default config
