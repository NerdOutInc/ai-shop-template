// @vitest-environment node
import sharp from "sharp"
import { beforeEach, expect, it, vi } from "vitest"

import type { LibraryStoredAsset } from "./library-types"

import { inspectLibraryImage } from "./inspect-library-image.server"
import { privateAssetPathname } from "./private-asset-pathname"
import { verifyPrivateAssetUpload } from "./verify-private-asset-upload.server"

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  env: { PRIVATE_BLOB_READ_WRITE_TOKEN: "private-test-token" as string | undefined },
}))
vi.mock("server-only", () => ({}))
vi.mock("@vercel/blob", () => ({ get: mocks.get }))
vi.mock("@/lib/env", () => ({ env: mocks.env }))

async function fixture(transparent = true) {
  const bytes = await sharp(Buffer.from([255, 0, 0, 255, 0, 0, 0, transparent ? 0 : 255]), {
    raw: { width: 2, height: 1, channels: 4 },
  })
    .png()
    .toBuffer()
  const asset: LibraryStoredAsset = {
    ...(await inspectLibraryImage(bytes)),
    id: "dd2c979c-e182-43f4-8b80-cfce948059d1",
    kind: "print",
    status: "pending",
    url: "/api/admin/assets/dd2c979c-e182-43f4-8b80-cfce948059d1",
    pathname: null,
    sourcePath: null,
    originalFilename: "selected.png",
    enlarged: false,
  }
  return { bytes, asset }
}

function uploaded(bytes: Buffer) {
  mocks.get.mockResolvedValue({
    statusCode: 200,
    blob: { size: bytes.length, contentType: "image/png" },
    stream: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes)
        controller.close()
      },
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.env.PRIVATE_BLOB_READ_WRITE_TOKEN = "private-test-token"
})

it("verifies actual private bytes and returns the immutable location for database finalization", async () => {
  const { bytes, asset } = await fixture()
  uploaded(bytes)
  await expect(verifyPrivateAssetUpload(asset)).resolves.toEqual({
    assetId: asset.id,
    pathname: privateAssetPathname(asset),
    sha256: asset.sha256,
    pixelSha256: asset.pixelSha256,
    bytes: bytes.length,
  })
  expect(mocks.get).toHaveBeenCalledWith(privateAssetPathname(asset), {
    access: "private",
    token: "private-test-token",
    useCache: false,
  })
})

it("rejects content that differs from the registered selection even when size and MIME match", async () => {
  const { bytes, asset } = await fixture()
  uploaded(bytes)
  await expect(verifyPrivateAssetUpload({ ...asset, pixelSha256: "0".repeat(64) })).rejects.toThrow(
    "selected artwork revision"
  )
  uploaded(bytes)
  await expect(verifyPrivateAssetUpload({ ...asset, perceptualHash: "f".repeat(16) })).rejects.toThrow(
    "selected artwork revision"
  )
})

it("rejects opaque print masters even when all registered hashes match", async () => {
  const { bytes, asset } = await fixture(false)
  uploaded(bytes)
  await expect(verifyPrivateAssetUpload(asset)).rejects.toThrow("transparent PNG")
})

it("resumes identical artwork with a rounding-boundary fingerprint without accepting changed bytes or pixels", async () => {
  const { bytes, asset } = await fixture()
  // Every row is identical, so the final comparison is a flat-color rounding boundary.
  const alternate = (BigInt(`0x${asset.perceptualHash}`) ^ 1n).toString(16).padStart(16, "0")
  const registered = { ...asset, perceptualHash: alternate }
  uploaded(bytes)
  await expect(verifyPrivateAssetUpload(registered)).resolves.toMatchObject({
    assetId: asset.id,
    sha256: asset.sha256,
    pixelSha256: asset.pixelSha256,
  })
  uploaded(bytes)
  await expect(verifyPrivateAssetUpload({ ...registered, sha256: "0".repeat(64) })).rejects.toThrow(
    "selected artwork revision"
  )
  uploaded(bytes)
  await expect(verifyPrivateAssetUpload({ ...registered, pixelSha256: "0".repeat(64) })).rejects.toThrow(
    "selected artwork revision"
  )
})

it("cancels mismatched metadata without inspecting or finalizing the stream", async () => {
  const { asset } = await fixture()
  const cancel = vi.fn()
  mocks.get.mockResolvedValue({
    statusCode: 200,
    blob: { size: asset.bytes! + 1, contentType: asset.mimeType },
    stream: { cancel },
  })
  await expect(verifyPrivateAssetUpload(asset)).rejects.toThrow("registered artwork")
  expect(cancel).toHaveBeenCalledOnce()
})

it("fails closed when the private store is unavailable or the asset is not uploadable", async () => {
  const { asset } = await fixture()
  mocks.env.PRIVATE_BLOB_READ_WRITE_TOKEN = undefined
  await expect(verifyPrivateAssetUpload(asset)).rejects.toThrow("not configured")
  expect(mocks.get).not.toHaveBeenCalled()
  mocks.env.PRIVATE_BLOB_READ_WRITE_TOKEN = "private-test-token"
  await expect(verifyPrivateAssetUpload({ ...asset, status: "unavailable" })).rejects.toThrow("not uploadable")
  mocks.get.mockResolvedValue(null)
  await expect(verifyPrivateAssetUpload(asset)).rejects.toThrow("has not completed")
})
