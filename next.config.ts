import type { NextConfig } from "next"

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
    remotePatterns: [
      ...(env.NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST
        ? [
            {
              protocol: "https" as const,
              hostname: env.NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST,
              port: "",
              pathname: "/published-mockups/v1/**",
              search: "",
            },
            {
              protocol: "https" as const,
              hostname: env.NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST,
              port: "",
              pathname: "/published-artwork/v1/**",
              search: "",
            },
          ]
        : []),
      {
        protocol: "https",
        hostname: "images-api.printify.com",
        port: "",
        pathname: "/mockup/**",
        // Camera labels vary by garment view; preserve the provider's query string.
      },
    ],
  },
}

export default config
