// @vitest-environment node
import { createHash } from "node:crypto"

import sharp from "sharp"
import { beforeAll, expect, it, vi } from "vitest"

import type { LibraryStoredAsset } from "./library-types"

import { readDisplayImage } from "./read-display-image.server"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({ env: { PRIVATE_BLOB_READ_WRITE_TOKEN: "private-test-token" } }))

let master: Buffer
let asset: LibraryStoredAsset

beforeAll(async () => {
  master = await sharp({
    create: { width: 600, height: 800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: await sharp({ create: { width: 200, height: 200, channels: 4, background: "#182630" } })
          .png()
          .toBuffer(),
        left: 200,
        top: 300,
      },
    ])
    .png()
    .toBuffer()
  asset = {
    id: "3f1d6a9c-4b2e-4f01-9a77-1c2d5e8b7a40",
    url: "/api/admin/assets/3f1d6a9c-4b2e-4f01-9a77-1c2d5e8b7a40",
    kind: "print",
    status: "ready",
    mimeType: "image/png",
    width: 600,
    height: 800,
    bytes: master.length,
    sha256: createHash("sha256").update(master).digest("hex"),
    pixelSha256: "a".repeat(64),
    perceptualHash: null,
    hasAlpha: true,
    hasTransparency: true,
    enlarged: false,
    pathname: "concepts/x/y.png",
    sourcePath: null,
    originalFilename: "design.png",
  }
}, 30_000)

function storage(stored = new Map<string, Buffer>()) {
  return {
    stored,
    get: vi.fn(async (pathname: string) => {
      const bytes = stored.get(pathname)
      return bytes
        ? {
            statusCode: 200,
            blob: { size: bytes.length, contentType: "image/webp" },
            stream: new Response(new Uint8Array(bytes)).body!,
          }
        : null
    }),
    put: vi.fn(async (pathname: string, bytes: Buffer) => {
      if (stored.has(pathname)) throw new Error("blob already exists")
      stored.set(pathname, bytes)
      return { url: `https://private.example/${pathname}`, pathname, contentType: "image/webp" }
    }),
  }
}

it("derives once, stores the result, and serves the stored copy afterwards", async () => {
  const blob = storage()
  const readAsset = vi.fn(async () => new Response(new Uint8Array(master)).body!)
  const first = await readDisplayImage(asset, "small", { storage: blob, readAsset })
  expect(blob.put).toHaveBeenCalledTimes(1)
  expect(readAsset).toHaveBeenCalledTimes(1)
  expect(first?.bytes).toBeGreaterThan(0)

  const second = await readDisplayImage(asset, "small", { storage: blob, readAsset })
  expect(blob.put).toHaveBeenCalledTimes(1)
  // The master is never read again once a browsing size exists.
  expect(readAsset).toHaveBeenCalledTimes(1)
  expect(second?.bytes).toBe(first?.bytes)
})

it("addresses each size by the master's hash so replaced artwork cannot serve a stale size", async () => {
  const blob = storage()
  const readAsset = vi.fn(async () => new Response(new Uint8Array(master)).body!)
  await readDisplayImage(asset, "small", { storage: blob, readAsset })
  await readDisplayImage(asset, "large", { storage: blob, readAsset })
  expect([...blob.stored.keys()]).toEqual([
    `concepts/${asset.id}/${asset.sha256}-small.webp`,
    `concepts/${asset.id}/${asset.sha256}-large.webp`,
  ])
})

it("uses what a racing request stored rather than failing the read", async () => {
  const blob = storage()
  const readAsset = vi.fn(async () => new Response(new Uint8Array(master)).body!)
  const raced = await readDisplayImage(asset, "medium", {
    storage: {
      ...blob,
      // The winner's write lands between this request's miss and its own put.
      put: vi.fn(async (pathname: string, bytes: Buffer) => {
        blob.stored.set(pathname, bytes)
        throw new Error("blob already exists")
      }),
    },
    readAsset,
  })
  expect(raced?.bytes).toBeGreaterThan(0)
})

it("has no browsing size to offer for artwork that is not prepared transparent", async () => {
  const blob = storage()
  const readAsset = vi.fn(async () => new Response(new Uint8Array(master)).body!)
  expect(
    await readDisplayImage({ ...asset, hasTransparency: false }, "small", {
      storage: blob,
      readAsset,
    })
  ).toBeNull()
  expect(await readDisplayImage({ ...asset, status: "pending" }, "small", { storage: blob, readAsset })).toBeNull()
  expect(blob.put).not.toHaveBeenCalled()
  expect(readAsset).not.toHaveBeenCalled()
})
