// @vitest-environment node
import { createHash } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import { LibraryError } from "./library-error"

import type { LibraryStoredAsset } from "./library-types"

import { servePrivateLibraryAsset } from "./serve-private-library-asset.server"

vi.mock("server-only", () => ({}))

const id = "dd2c979c-e182-43f4-8b80-cfce948059d1"
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const asset: LibraryStoredAsset = {
  id,
  url: `/api/admin/assets/${id}`,
  kind: "original",
  status: "ready",
  mimeType: "image/png",
  width: 1122,
  height: 1402,
  bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  pixelSha256: "a".repeat(64),
  perceptualHash: null,
  hasAlpha: true,
  hasTransparency: true,
  enlarged: false,
  pathname: `concepts/${id}/source.png`,
  sourcePath: "private/archive.png",
  originalFilename: "Design #149 — original.png",
}

function fixture() {
  return {
    authenticate: vi.fn(async (): Promise<{ userId: string } | null> => ({ userId: "admin-a" })),
    getAsset: vi.fn(async (): Promise<LibraryStoredAsset | null> => asset),
    readAsset: vi.fn(
      async () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes)
            controller.close()
          },
        })
    ),
  }
}

describe("browsing sizes", () => {
  const sized = (size: string) => new Request(`https://store.example/api/admin/assets/${id}?size=${size}`)

  it("serves the derived size instead of the print master", async () => {
    const dependencies = {
      ...fixture(),
      readDisplay: vi.fn(async () => ({ body: Buffer.from([1, 2, 3]), bytes: 3, sha256: "c".repeat(64) })),
    }
    const result = await servePrivateLibraryAsset(sized("small"), id, dependencies)
    expect(result.status).toBe(200)
    expect(dependencies.readDisplay).toHaveBeenCalledWith(expect.objectContaining({ id }), "small")
    expect(dependencies.readAsset).not.toHaveBeenCalled()
    expect(result.headers.get("content-type")).toBe("image/webp")
    expect(result.headers.get("content-length")).toBe("3")
    // Private artwork is never cached by a browser, derived or not.
    expect(result.headers.get("cache-control")).toContain("no-store")
    expect(result.headers.get("cdn-cache-control")).toBe("no-store")
  })

  it("refuses an unknown size without reading anything", async () => {
    const dependencies = { ...fixture(), readDisplay: vi.fn() }
    const result = await servePrivateLibraryAsset(sized("enormous"), id, dependencies)
    expect(result.status).toBe(404)
    expect(dependencies.readDisplay).not.toHaveBeenCalled()
    expect(dependencies.readAsset).not.toHaveBeenCalled()
  })

  it("does not fall back to the master when no browsing size exists", async () => {
    const dependencies = { ...fixture(), readDisplay: vi.fn(async () => null) }
    const result = await servePrivateLibraryAsset(sized("large"), id, dependencies)
    expect(result.status).toBe(404)
    // Falling back would hand a gallery grid the very print-sized file this avoids.
    expect(dependencies.readAsset).not.toHaveBeenCalled()
  })

  it("still streams the master when no size is asked for", async () => {
    const dependencies = { ...fixture(), readDisplay: vi.fn() }
    const result = await servePrivateLibraryAsset(
      new Request(`https://store.example/api/admin/assets/${id}`),
      id,
      dependencies
    )
    expect(result.status).toBe(200)
    expect(result.headers.get("content-type")).toBe("image/png")
    expect(result.headers.get("cache-control")).toContain("no-store")
    expect(dependencies.readDisplay).not.toHaveBeenCalled()
  })
})

describe("private artwork delivery", () => {
  it.each(["a".repeat(36), "-".repeat(36)])("rejects malformed UUIDs before querying artwork", async (invalid) => {
    const dependencies = fixture()
    const result = await servePrivateLibraryAsset(
      new Request("https://store.example/api/admin/assets/a"),
      invalid,
      dependencies
    )
    expect(result.status).toBe(404)
    expect(dependencies.getAsset).not.toHaveBeenCalled()
  })
  it("denies visitors before any asset or Blob lookup, with uncached errors", async () => {
    const dependencies = fixture()
    dependencies.authenticate.mockResolvedValue(null)
    const result = await servePrivateLibraryAsset(
      new Request("https://store.example/api/admin/assets/a"),
      id,
      dependencies
    )
    expect(result.status).toBe(401)
    expect(dependencies.getAsset).not.toHaveBeenCalled()
    expect(dependencies.readAsset).not.toHaveBeenCalled()
    expect(result.headers.get("cache-control")).toContain("no-store")
    expect(result.headers.get("vary")).toBe("Cookie, Authorization")
  })

  it("streams the exact original bytes through the app, with its preserved filename", async () => {
    const dependencies = fixture()
    const result = await servePrivateLibraryAsset(
      new Request("https://store.example/api/admin/assets/a?download=1"),
      id,
      dependencies
    )
    expect(result.status).toBe(200)
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(bytes)
    expect(result.headers.get("content-disposition")).toContain("attachment;")
    expect(result.headers.get("content-disposition")).toContain("Design%20%23149")
    expect(result.headers.get("x-content-sha256")).toBe(asset.sha256)
    expect(result.headers.get("content-type")).toBe("image/png")
    expect(result.headers.get("cdn-cache-control")).toBe("no-store")
    expect(result.headers.get("vercel-cdn-cache-control")).toBe("no-store")
    expect(result.headers.get("x-robots-tag")).toContain("noindex")
    expect(dependencies.getAsset).toHaveBeenCalledWith("admin-a", id, undefined)
  })

  it("checks the signed browser session in the asset lookup and blocks revoked access before Blob", async () => {
    const dependencies = {
      ...fixture(),
      authenticate: vi.fn(async () => ({ userId: "admin-a", sessionId: "session-a" })),
    }
    dependencies.getAsset.mockRejectedValue(new LibraryError("FORBIDDEN", "revoked"))
    const result = await servePrivateLibraryAsset(
      new Request("https://store.example/api/admin/assets/a"),
      id,
      dependencies
    )
    expect(result.status).toBe(403)
    expect(dependencies.getAsset).toHaveBeenCalledWith("admin-a", id, "session-a")
    expect(dependencies.readAsset).not.toHaveBeenCalled()
  })

  it("cannot route arbitrary storage paths or pending originals into a download", async () => {
    const dependencies = fixture()
    expect(
      (
        await servePrivateLibraryAsset(
          new Request("https://store.example/api/admin/assets/a"),
          "../private/key",
          dependencies
        )
      ).status
    ).toBe(404)
    expect(dependencies.getAsset).not.toHaveBeenCalled()
    dependencies.getAsset.mockResolvedValue({ ...asset, status: "pending" })
    expect(
      (await servePrivateLibraryAsset(new Request("https://store.example/api/admin/assets/a"), id, dependencies)).status
    ).toBe(404)
    expect(dependencies.readAsset).not.toHaveBeenCalled()
  })

  it("does not reveal provider URLs, credentials, or archive locations when a read fails", async () => {
    const dependencies = fixture()
    dependencies.readAsset.mockRejectedValue(new Error("secret-token private/archive.png"))
    const result = await servePrivateLibraryAsset(
      new Request("https://store.example/api/admin/assets/a"),
      id,
      dependencies
    )
    expect(result.status).toBe(503)
    expect(await result.text()).not.toMatch(/secret-token|archive|blob/)
  })
})
