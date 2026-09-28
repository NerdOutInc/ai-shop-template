// @vitest-environment node
import { expect, it, vi } from "vitest"

import type { LibraryStoredAsset } from "./library-types"

import { issuePrivateAssetUpload } from "./issue-private-asset-upload.server"

const mocks = vi.hoisted(() => ({ generate: vi.fn(async () => "scoped-upload-token") }))
vi.mock("server-only", () => ({}))
vi.mock("@vercel/blob/client", () => ({ generateClientTokenFromReadWriteToken: mocks.generate }))
vi.mock("@/lib/env", () => ({ env: { PRIVATE_BLOB_READ_WRITE_TOKEN: "private-test-token" } }))

it("limits a direct upload to one immutable path, expected size and format for five minutes", async () => {
  const asset = {
    id: "dd2c979c-e182-43f4-8b80-cfce948059d1",
    sha256: "a".repeat(64),
    mimeType: "image/png",
    bytes: 1200,
    status: "pending",
  } as LibraryStoredAsset
  const before = Date.now()
  const result = await issuePrivateAssetUpload(asset)
  expect(result.access).toBe("private")
  expect(result.pathname).toBe(`concepts/${asset.id}/${asset.sha256}.png`)
  expect(result.expiresAt).toBeGreaterThanOrEqual(before + 299_000)
  expect(result.expiresAt).toBeLessThanOrEqual(Date.now() + 300_000)
  expect(mocks.generate).toHaveBeenCalledWith(
    expect.objectContaining({
      token: "private-test-token",
      pathname: result.pathname,
      maximumSizeInBytes: 1200,
      allowedContentTypes: ["image/png"],
      allowOverwrite: false,
      addRandomSuffix: false,
    })
  )
  await expect(issuePrivateAssetUpload({ ...asset, status: "ready" })).rejects.toThrow("pending")
  await expect(issuePrivateAssetUpload({ ...asset, bytes: 65 * 1024 * 1024 })).rejects.toThrow("limit")
})
