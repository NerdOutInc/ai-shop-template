import { ImageResponse } from "next/og"

import { storeConfig } from "@/lib/store-config"

export const alt = `${storeConfig.name}. ${storeConfig.tagline}`
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: "100%",
        height: "100%",
        background: storeConfig.theme.primary,
        color: storeConfig.theme.primaryForeground,
        padding: "70px 80px",
        fontFamily: "sans-serif",
      }}
    >
      <span style={{ fontSize: 28 }}>{storeConfig.tagline}</span>
      <span style={{ fontSize: 90, fontWeight: 700, lineHeight: 1.1 }}>{storeConfig.name}</span>
      <span style={{ fontSize: 30 }}>{storeConfig.description}</span>
    </div>,
    size
  )
}
