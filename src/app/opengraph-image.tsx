import { ImageResponse } from "next/og"

import { storeConfig } from "@/lib/store-config"

export const alt = `${storeConfig.name}. ${storeConfig.tagline}`
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function OpenGraphImage() {
  const nameFontSize = storeConfig.name.length > 40 ? 54 : storeConfig.name.length > 20 ? 72 : 90
  const nameLines = storeConfig.name.length > 40 ? 4 : storeConfig.name.length > 20 ? 3 : 2

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
        fontWeight: 400,
      }}
    >
      <div style={{ display: "flex", height: 70, flexShrink: 0 }}>
        <span style={{ display: "block", fontSize: 28, lineHeight: 1.25, lineClamp: 2, wordBreak: "break-word" }}>
          {storeConfig.tagline}
        </span>
      </div>
      {/* Fixed regions keep long copy apart; next/og supplies a regular-weight font. */}
      <div style={{ display: "flex", alignItems: "center", height: 240, flexShrink: 0 }}>
        <span
          style={{
            display: "block",
            fontSize: nameFontSize,
            lineHeight: 1.1,
            lineClamp: nameLines,
            wordBreak: "break-word",
          }}
        >
          {storeConfig.name}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", height: 117, flexShrink: 0 }}>
        <span style={{ display: "block", fontSize: 30, lineHeight: 1.3, lineClamp: 3, wordBreak: "break-word" }}>
          {storeConfig.description}
        </span>
      </div>
    </div>,
    size
  )
}
