// @vitest-environment node
import { createHash } from "node:crypto"
import sharp from "sharp"
import { describe, expect, it, vi } from "vitest"

import { publishedArtworkFixture } from "../../../test/published-artwork-fixture"

import { derivePublishedArtwork } from "./derive-published-artwork.server"

vi.mock("server-only", () => ({}))

describe("published artwork derivative", () => {
  it("preserves the full approved canvas as a bounded transparent WebP without changing the print master", async () => {
    const fixture = await publishedArtworkFixture()
    const derivative = await derivePublishedArtwork(fixture.bytes, fixture.asset)
    expect(derivative).toMatchObject({ width: 960, height: 1200 })
    expect(await sharp(derivative.bytes).metadata()).toMatchObject({
      format: "webp",
      width: 960,
      height: 1200,
      hasAlpha: true,
    })
    const alpha = (await sharp(derivative.bytes).stats()).channels[3]!
    expect([alpha.min, alpha.max]).toEqual([0, 255])
    expect(derivative.bytes.equals(fixture.bytes)).toBe(false)
    expect(createHash("sha256").update(fixture.bytes).digest("hex")).toBe(fixture.asset.sha256)
  })

  it.each(["pending", "sha256", "kind", "dimensions", "transparency"])(
    "rejects unverified %s evidence",
    async (scenario) => {
      const fixture = await publishedArtworkFixture()
      if (scenario === "pending") fixture.asset.status = "pending"
      if (scenario === "sha256") fixture.asset.sha256 = "b".repeat(64)
      if (scenario === "kind") fixture.asset.kind = "original"
      if (scenario === "dimensions") fixture.asset.width = 1601
      if (scenario === "transparency") fixture.asset.hasTransparency = false
      await expect(derivePublishedArtwork(fixture.bytes, fixture.asset)).rejects.toMatchObject({ retryable: false })
    }
  )

  it("checks decoded transparency rather than trusting a registered alpha flag", async () => {
    const fixture = await publishedArtworkFixture()
    const bytes = await sharp(fixture.bytes).flatten({ background: "white" }).ensureAlpha().png().toBuffer()
    const asset = { ...fixture.asset, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }
    await expect(derivePublishedArtwork(bytes, asset)).rejects.toMatchObject({
      code: "IMAGE_CONTENT_INVALID",
      retryable: false,
    })
  })
  it("reduces a small ready master below its original resolution", async () => {
    const fixture = await publishedArtworkFixture()
    const bytes = await sharp(fixture.bytes).resize(1000, 1200).png().toBuffer()
    const asset = {
      ...fixture.asset,
      width: 1000,
      height: 1200,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }
    const derivative = await derivePublishedArtwork(bytes, asset)
    expect(derivative).toMatchObject({ width: 750, height: 900 })
    expect((await sharp(derivative.bytes).stats()).channels[3]!.min).toBe(0)
  })
  it("reports an exhausted encode budget as actionable attention instead of repeated provider retries", async () => {
    const fixture = await publishedArtworkFixture()
    await expect(derivePublishedArtwork(fixture.bytes, fixture.asset, 0)).rejects.toMatchObject({
      code: "IMAGE_DERIVATION_TIMEOUT",
      retryable: false,
    })
  })
})
