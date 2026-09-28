import type { MetadataRoute } from "next"

import { storeConfig } from "@/lib/store-config"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: storeConfig.name,
    short_name: storeConfig.name,
    id: "/",
    start_url: "/",
    scope: "/",
    display: "browser",
    background_color: storeConfig.theme.background,
    theme_color: storeConfig.theme.primary,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
