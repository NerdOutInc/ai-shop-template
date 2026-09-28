// @vitest-environment node
import { BlobNotFoundError } from "@vercel/blob"
import { describe, expect, it, vi } from "vitest"

import { productArtworkFingerprint } from "@/features/design-products/product-artwork-fingerprint"
import { publishedArtworkFixture } from "../../../test/published-artwork-fixture"

import * as artworkDerivation from "./derive-published-artwork.server"
import { derivePublishedArtwork } from "./derive-published-artwork.server"
import { hostPublishedArtwork } from "./host-published-artwork.server"

vi.mock("server-only", () => ({}))

async function setup() {
  const fixture = await publishedArtworkFixture()
  const fingerprint = productArtworkFingerprint(fixture.product, fixture.expected)!
  const blobHost = "catalog.public.blob.vercel-storage.com"
  const readApproved = vi.fn(async () => ({
    revisionId: fixture.revisionId,
    productionFingerprint: fingerprint,
    printAsset: fixture.asset,
  }))
  const readAsset = vi.fn(
    async () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(fixture.bytes)
          controller.close()
        },
      })
  )
  const blob = {
    head: vi.fn<NonNullable<Parameters<typeof hostPublishedArtwork>[0]["blob"]>["head"]>(async () => {
      throw new BlobNotFoundError()
    }),
    put: vi.fn<NonNullable<Parameters<typeof hostPublishedArtwork>[0]["blob"]>["put"]>(async (pathname: string) => ({
      url: `https://${blobHost}/${pathname}`,
      pathname,
      contentType: "image/webp",
    })),
  }
  const options = {
    snapshot: fixture.product as Record<string, unknown>,
    source: fixture.product,
    expected: fixture.expected,
    revisionKey: "event1:source1",
    uploads: { read: vi.fn(async (): Promise<string | null> => null), save: vi.fn(async () => undefined) },
    deadline: 30000,
    now: () => 0,
    blobHost,
    readApproved,
    readAsset,
    blob,
  }
  return { ...fixture, fingerprint, options }
}

describe("private artwork publication", () => {
  it("resolves the exact production revision and publicly uploads only its bounded derivative", async () => {
    const fixture = await setup()
    const result = await hostPublishedArtwork(fixture.options)
    const derivative = await derivePublishedArtwork(fixture.bytes, fixture.asset)
    const [path, bytes, options] = fixture.options.blob.put.mock.calls[0]!
    expect(path).toBe(`published-artwork/v1/${derivative.sha256}.webp`)
    expect(bytes.equals(derivative.bytes)).toBe(true)
    expect(bytes.equals(fixture.bytes)).toBe(false)
    expect(options).toMatchObject({
      access: "public",
      contentType: "image/webp",
      allowOverwrite: false,
      addRandomSuffix: false,
    })
    expect(fixture.options.readApproved).toHaveBeenCalledExactlyOnceWith({
      ...fixture.expected,
      productionFingerprint: fixture.fingerprint,
    })
    expect(result).toMatchObject({
      complete: true,
      snapshot: {
        storefront_artwork_enabled: true,
        storefront_artwork: {
          revisionId: fixture.revisionId,
          productionFingerprint: fixture.fingerprint,
          width: 960,
          height: 1200,
        },
      },
    })
    expect(JSON.stringify(result.snapshot)).not.toMatch(/private-approved-master|\/api\/admin\/assets|concepts\//)
    expect(fixture.options.uploads.save).toHaveBeenCalledExactlyOnceWith(
      expect.any(String),
      `https://${fixture.options.blobHost}/${path}`
    )
    expect(fixture.product.storefront_artwork_enabled).toBe(false)
  })

  it("rejects a changed production fingerprint before reading private bytes or uploading", async () => {
    const fixture = await setup()
    const changed = structuredClone(fixture.product)
    changed.print_areas[0]!.placeholders[0]!.images[0]!.id = "mutable-draft-B"
    await expect(hostPublishedArtwork({ ...fixture.options, source: changed })).rejects.toMatchObject({
      code: "IMAGE_SOURCE_CHANGED",
    })
    expect(fixture.options.readApproved).not.toHaveBeenCalled()
    expect(fixture.options.readAsset).not.toHaveBeenCalled()
    expect(fixture.options.blob.put).not.toHaveBeenCalled()
  })

  it("rejects a resolver returning another revision fingerprint", async () => {
    const fixture = await setup()
    fixture.options.readApproved.mockResolvedValue({
      revisionId: fixture.revisionId,
      productionFingerprint: `artwork-v1:${"b".repeat(64)}`,
      printAsset: fixture.asset,
    })
    await expect(hostPublishedArtwork(fixture.options)).rejects.toMatchObject({ code: "IMAGE_SOURCE_CHANGED" })
    expect(fixture.options.readAsset).not.toHaveBeenCalled()
  })

  it.each([false, true])("rejects an unmatched new product even when its preview flag is %s", async (enabled) => {
    const fixture = await setup()
    fixture.product.storefront_artwork_enabled = enabled
    await expect(hostPublishedArtwork({ ...fixture.options, readApproved: async () => null })).rejects.toMatchObject({
      code: "ARTWORK_NOT_RESOLVED",
      retryable: false,
    })
    expect(fixture.options.readAsset).not.toHaveBeenCalled()
    expect(fixture.options.blob.put).not.toHaveBeenCalled()
  })

  it.each([null, { revisionId: "stale" }])(
    "rejects an unresolved attached preview without changing it: %j",
    async (pin) => {
      const fixture = await setup()
      const productId = "111111000000000000000002"
      const source = { ...fixture.product, id: productId }
      const snapshot = {
        ...source,
        storefront_artwork_enabled: true,
        storefront_artwork: pin,
      }
      await expect(
        hostPublishedArtwork({
          ...fixture.options,
          source,
          snapshot,
          expected: { ...fixture.expected, productId },
          readApproved: async () => null,
        })
      ).rejects.toMatchObject({ code: "ARTWORK_NOT_RESOLVED", retryable: false })
      expect(snapshot.storefront_artwork).toEqual(pin)
      expect(snapshot.storefront_artwork_enabled).toBe(true)
      expect(fixture.options.readAsset).not.toHaveBeenCalled()
      expect(fixture.options.blob.put).not.toHaveBeenCalled()
    }
  )

  it("defers before private work when the existing worker deadline is exhausted", async () => {
    const fixture = await setup()
    expect(await hostPublishedArtwork({ ...fixture.options, now: () => 29000 })).toEqual({
      snapshot: fixture.product,
      complete: false,
    })
    expect(fixture.options.readAsset).not.toHaveBeenCalled()
    expect(fixture.options.blob.put).not.toHaveBeenCalled()
  })

  it("reuses content addressed storage on retry without a second upload", async () => {
    const fixture = await setup()
    const derivative = await derivePublishedArtwork(fixture.bytes, fixture.asset)
    const pathname = `published-artwork/v1/${derivative.sha256}.webp`
    fixture.options.blob.head.mockResolvedValue({
      url: `https://${fixture.options.blobHost}/${pathname}`,
      pathname,
      size: derivative.bytes.length,
      contentType: "image/webp",
    })
    expect((await hostPublishedArtwork(fixture.options)).complete).toBe(true)
    expect(fixture.options.blob.put).not.toHaveBeenCalled()
    expect(fixture.options.uploads.save).toHaveBeenCalledOnce()
  })

  it.each([true, false])("verifies public bytes after an uncertain PUT (matching %s)", async (matches) => {
    const fixture = await setup()
    const derivative = await derivePublishedArtwork(fixture.bytes, fixture.asset)
    const pathname = `published-artwork/v1/${derivative.sha256}.webp`
    fixture.options.blob.head.mockRejectedValueOnce(new BlobNotFoundError()).mockResolvedValue({
      url: `https://${fixture.options.blobHost}/${pathname}`,
      pathname,
      size: derivative.bytes.length,
      contentType: "image/webp",
    })
    fixture.options.blob.put.mockRejectedValue(new Error("response lost"))
    const bytes = matches ? derivative.bytes : Buffer.alloc(derivative.bytes.length)
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(new Uint8Array(bytes)))
    const result = hostPublishedArtwork({ ...fixture.options, fetch: fetchMock })
    if (matches) await expect(result).resolves.toMatchObject({ complete: true })
    else await expect(result).rejects.toMatchObject({ code: "IMAGE_STORAGE_CONFLICT", retryable: false })
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `https://${fixture.options.blobHost}/${pathname}`,
      expect.objectContaining({ redirect: "error" })
    )
    expect(fixture.options.blob.put).toHaveBeenCalledOnce()
  })

  it("rejects an upload receipt pointing at a private master", async () => {
    const fixture = await setup()
    fixture.options.uploads.read.mockResolvedValue(
      `https://private.private.blob.vercel-storage.com/${fixture.asset.pathname}`
    )
    await expect(hostPublishedArtwork(fixture.options)).rejects.toMatchObject({ code: "IMAGE_STORAGE_CONFLICT" })
    expect(fixture.options.blob.put).not.toHaveBeenCalled()
  })
  it("allocates encoding from the deadline remaining after the private read", async () => {
    const fixture = await setup()
    const derivative = await derivePublishedArtwork(fixture.bytes, fixture.asset)
    const spy = vi.spyOn(artworkDerivation, "derivePublishedArtwork").mockResolvedValue(derivative)
    let elapsed = 0
    const readAsset = fixture.options.readAsset.getMockImplementation()!
    try {
      await hostPublishedArtwork({
        ...fixture.options,
        now: () => elapsed,
        readAsset: async () => {
          const stream = await readAsset()
          elapsed = 10000
          return stream
        },
      })
      expect(spy).toHaveBeenCalledWith(fixture.bytes, fixture.asset, 14)
    } finally {
      spy.mockRestore()
    }
  })
})
