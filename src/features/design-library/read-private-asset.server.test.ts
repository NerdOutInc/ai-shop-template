// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest"

import type { LibraryStoredAsset } from "./library-types"

import { privateAssetPathname } from "./private-asset-pathname"
import { readPrivateAsset } from "./read-private-asset.server"

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  env: { PRIVATE_BLOB_READ_WRITE_TOKEN: "private-test-token" as string | undefined },
}))
vi.mock("server-only", () => ({}))
vi.mock("@vercel/blob", () => ({ get: mocks.get }))
vi.mock("@/lib/env", () => ({ env: mocks.env }))
const asset = {
  id: "dd2c979c-e182-43f4-8b80-cfce948059d1",
  sha256: "a".repeat(64),
  mimeType: "image/png",
  bytes: 10,
  status: "ready",
} as LibraryStoredAsset
asset.pathname = privateAssetPathname(asset)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.env.PRIVATE_BLOB_READ_WRITE_TOKEN = "private-test-token"
})

it("requires a dedicated private token and an immutable asset pathname", async () => {
  mocks.env.PRIVATE_BLOB_READ_WRITE_TOKEN = undefined
  await expect(readPrivateAsset(asset)).rejects.toThrow("not configured")
  expect(mocks.get).not.toHaveBeenCalled()
  mocks.env.PRIVATE_BLOB_READ_WRITE_TOKEN = "private-test-token"
  await expect(readPrivateAsset({ ...asset, pathname: "https://attacker.example/image.png" })).rejects.toThrow(
    "not ready"
  )
  expect(mocks.get).not.toHaveBeenCalled()
})

it("fetches privately and refuses changed Blob metadata before serving bytes", async () => {
  const stream = { cancel: vi.fn() }
  mocks.get.mockResolvedValue({ statusCode: 200, stream, blob: { size: 11, contentType: "image/png" } })
  await expect(readPrivateAsset(asset)).rejects.toThrow("no longer matches")
  expect(stream.cancel).toHaveBeenCalledOnce()
  expect(mocks.get).toHaveBeenCalledWith(asset.pathname, { access: "private", token: "private-test-token" })
})
