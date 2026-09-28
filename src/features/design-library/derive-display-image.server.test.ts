// @vitest-environment node
import { createHash } from "node:crypto"

import sharp from "sharp"
import { beforeAll, expect, it, vi } from "vitest"

import type { LibraryStoredAsset } from "./library-types"

import { deriveDisplayImage } from "./derive-display-image.server"

vi.mock("server-only", () => ({}))

let master: Buffer

async function transparentMaster() {
  // A wide, mostly empty canvas with opaque ink, so both the resize and the alpha survive.
  return sharp({ create: { width: 2100, height: 2400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      {
        input: await sharp({
          create: { width: 900, height: 700, channels: 4, background: { r: 24, g: 38, b: 45, alpha: 1 } },
        })
          .png()
          .toBuffer(),
        left: 600,
        top: 850,
      },
    ])
    .png()
    .toBuffer()
}

function assetFor(bytes: Buffer, overrides: Partial<LibraryStoredAsset> = {}): LibraryStoredAsset {
  return {
    id: "3f1d6a9c-4b2e-4f01-9a77-1c2d5e8b7a40",
    url: "/api/admin/assets/3f1d6a9c-4b2e-4f01-9a77-1c2d5e8b7a40",
    kind: "print",
    status: "ready",
    mimeType: "image/png",
    width: 2100,
    height: 2400,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    pixelSha256: "a".repeat(64),
    perceptualHash: null,
    hasAlpha: true,
    hasTransparency: true,
    enlarged: false,
    pathname: "concepts/x/y.png",
    sourcePath: null,
    originalFilename: "design.png",
    ...overrides,
  }
}

beforeAll(async () => {
  master = await transparentMaster()
}, 30_000)

it("fits each size inside its longest edge and keeps the whole canvas", async () => {
  for (const [size, edge] of [
    ["small", 480],
    ["medium", 800],
    ["large", 1440],
  ] as const) {
    const result = await deriveDisplayImage(master, assetFor(master), size)
    expect(Math.max(result.width, result.height)).toBe(edge)
    // 2100x2400 keeps its ratio; cropping would move the artwork off its print placement.
    expect(result.width / result.height).toBeCloseTo(2100 / 2400, 2)
  }
})

it("keeps transparency and stays far smaller than the master", async () => {
  const result = await deriveDisplayImage(master, assetFor(master), "medium")
  const metadata = await sharp(result.bytes).metadata()
  expect(metadata.format).toBe("webp")
  expect(metadata.hasAlpha).toBe(true)
  const stats = await sharp(result.bytes).stats()
  expect(stats.channels[3]?.min).toBe(0)
  expect(result.bytes.length).toBeLessThan(master.length / 4)
})

it("addresses the output by its own hash", async () => {
  const result = await deriveDisplayImage(master, assetFor(master), "small")
  expect(result.sha256).toBe(createHash("sha256").update(result.bytes).digest("hex"))
})

it("refuses artwork that was never prepared transparent", async () => {
  const opaque = await sharp({ create: { width: 300, height: 300, channels: 3, background: "#123456" } })
    .png()
    .toBuffer()
  // The server never removes a background, so an opaque master is a preparation problem.
  await expect(
    deriveDisplayImage(
      opaque,
      assetFor(opaque, { width: 300, height: 300, hasAlpha: false, hasTransparency: false }),
      "small"
    )
  ).rejects.toMatchObject({ code: "INVALID_INPUT" })
})

it("refuses bytes that do not match the registered asset", async () => {
  await expect(deriveDisplayImage(master, assetFor(master, { sha256: "b".repeat(64) }), "small")).rejects.toMatchObject(
    { code: "INVALID_INPUT" }
  )
  await expect(deriveDisplayImage(master, assetFor(master, { width: 999 }), "small")).rejects.toMatchObject({
    code: "INVALID_INPUT",
  })
})
