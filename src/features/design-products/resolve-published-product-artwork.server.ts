import "server-only"

import { createHash } from "node:crypto"
import type { Pool } from "pg"
import sharp from "sharp"

import { getAdminDatabase } from "@/features/admin/get-admin-database.server"
import { publishedArtworkSchema } from "@/features/publishing/published-artwork-schema"
import { PublishedImageError } from "@/features/publishing/published-image-error"

import { DesignDraftError } from "./design-draft-error"
import { mapPrivateArtworkAsset } from "./map-private-artwork-asset"
import { productArtworkFingerprint } from "./product-artwork-fingerprint"
import { readApprovedProductArtwork } from "./read-approved-product-artwork.server"
import { readPrintifyArtworkSource } from "./read-printify-artwork-source.server"
import { readProductArtworkImages } from "./read-product-artwork-images"
import { withinDesignDeadline } from "./within-design-deadline.server"

type Input = {
  shopId: string
  productId: string
  productionFingerprint: string
  source: Record<string, unknown>
  deadline: number
}

type Options = {
  database?: Pool
  readSource?: (src: string, signal: AbortSignal) => Promise<Buffer>
  now?: () => number
}

function previewArtwork(source: Record<string, unknown>) {
  if (!Array.isArray(source.print_areas)) return null
  const printAreas = source.print_areas.map((raw: unknown) => {
    if (!raw || typeof raw !== "object" || !("placeholders" in raw) || !Array.isArray(raw.placeholders)) return raw
    const area = { ...raw } as Record<string, unknown>
    const placeholders = raw.placeholders.map((entry: unknown) => {
      if (!entry || typeof entry !== "object") return entry
      const placeholder = entry as Record<string, unknown>
      return placeholder.position === "front_dtg" &&
        (placeholder.decoration_method === undefined || placeholder.decoration_method === "dtg")
        ? { ...placeholder, position: "front" }
        : placeholder
    })
    const onlyRaster = placeholders.every(
      (placeholder) =>
        placeholder &&
        typeof placeholder === "object" &&
        "images" in placeholder &&
        Array.isArray(placeholder.images) &&
        placeholder.images.every(
          (entry: unknown) =>
            entry &&
            typeof entry === "object" &&
            Object.entries(entry).every(([key, value]) => {
              if (key === "type") return value === undefined || value === "image/png"
              if (key === "layerType") return value === undefined || value === "image"
              return (
                !/^(?:input_text|font_|text_align)/.test(key) || value === undefined || value === null || value === ""
              )
            })
        )
    )
    // Raster-only responses can retain Roboto/black defaults from the editor without a text layer.
    if (
      onlyRaster &&
      area.font_family === "Roboto" &&
      [undefined, null, "", "auto", "#000"].some((value) => value === area.font_color)
    ) {
      delete area.font_family
      delete area.font_color
    }
    return { ...area, placeholders }
  })
  const artwork = readProductArtworkImages({ ...source, print_areas: printAreas })
  return artwork &&
    artwork.front.length &&
    !artwork.hasOtherArtwork &&
    !artwork.hasLayeredArtwork &&
    !artwork.hasUnsupportedArtwork &&
    new Set(artwork.front.map((image) => image.id)).size === 1
    ? artwork
    : null
}

function selectCandidate(candidates: Record<string, unknown>[]) {
  if (
    !candidates.length ||
    candidates.length > 100 ||
    new Set(candidates.map((candidate) => candidate.canonical_design_id)).size !== 1
  )
    return null
  const bound = candidates.filter((candidate) => candidate.bound_revision === true)
  const registered = candidates.filter((candidate) => candidate.registered_revision === true)
  // Identical copies are not permission to pin whichever revision happens to be current today.
  return candidates.length === 1
    ? candidates[0]!
    : bound.length === 1
      ? bound[0]!
      : registered.length === 1
        ? registered[0]!
        : null
}

/** A signed publication can recover exact library pixels without inventing a human product approval. */
export async function resolvePublishedProductArtwork(input: Input, options: Options = {}) {
  const now = options.now ?? Date.now
  const remaining = () => {
    const milliseconds = input.deadline - now() - 1500
    if (!Number.isFinite(milliseconds) || milliseconds < 1000)
      throw new PublishedImageError("IMAGE_SOURCE_UNAVAILABLE", true)
    return milliseconds
  }
  const bounded = async <T>(work: () => Promise<T>) => {
    try {
      return await withinDesignDeadline(AbortSignal.timeout(remaining()), work)
    } catch (error) {
      if (error instanceof PublishedImageError) throw error
      throw new PublishedImageError("IMAGE_RECEIPT_UNAVAILABLE", true)
    }
  }
  remaining()
  if (productArtworkFingerprint(input.source, input) !== input.productionFingerprint)
    throw new PublishedImageError("IMAGE_SOURCE_CHANGED", false)
  const database = options.database ?? getAdminDatabase()
  const approved = await bounded(() => readApprovedProductArtwork(input, database))
  if (approved) return approved

  const artwork = previewArtwork(input.source)
  if (!artwork) return null
  const registeredImages = (
    await bounded(() =>
      database.query<Record<string, unknown>>(
        `select distinct a.*,d.canonical_design_id,
        exists(select 1 from public.library_product_bindings b
          where b.shop_id=$1 and b.product_id=$2 and b.revision_id=a.revision_id) as bound_revision,
        true as registered_revision
      from commerce.design_product_artwork r
      join public.library_assets a on a.id=r.print_asset_id and a.revision_id=r.revision_id and a.sha256=r.print_sha256
      join public.library_artwork_revisions revision on revision.id=a.revision_id
      join public.library_designs d on d.id=revision.design_id
      where r.shop_id=$1 and r.printify_image_id=$3
        and a.kind='print' and a.status='ready' and a.mime_type='image/png'
        and a.has_alpha and a.has_transparency
      order by a.id limit 101`,
        [input.shopId, input.productId, artwork.front[0]!.id]
      )
    )
  ).rows
  if (registeredImages.length) {
    // A Printify src can be a 2048px thumbnail. Immutable upload receipts still prove its full original.
    const identities = new Set(
      registeredImages.map((candidate) => `${candidate.pixel_sha256}:${candidate.width}:${candidate.height}`)
    )
    const candidate = identities.size === 1 ? selectCandidate(registeredImages) : null
    if (
      !candidate ||
      !candidate.pixel_sha256 ||
      artwork.front.some(
        (image) =>
          (image.width !== undefined && image.width !== candidate.width) ||
          (image.height !== undefined && image.height !== candidate.height)
      )
    )
      return null
    return {
      revisionId: String(candidate.revision_id),
      productionFingerprint: input.productionFingerprint,
      printAsset: mapPrivateArtworkAsset(candidate),
    }
  }
  const publications = (
    await bounded(() =>
      database.query<Record<string, unknown>>(
        `select a.*,p.snapshot,p.shop_id as snapshot_shop_id,p.product_id as snapshot_product_id
        from commerce.printify_products p
        join public.library_assets a
          on a.revision_id::text=p.snapshot->'storefront_artwork'->>'revisionId'
          and a.sha256=p.snapshot->'storefront_artwork'->>'sourceSha256'
        where p.shop_id=$1 and p.snapshot is not null
          and p.snapshot->'storefront_artwork_enabled'='true'::jsonb
          and p.snapshot->'print_areas' @> jsonb_build_array(jsonb_build_object(
            'placeholders',jsonb_build_array(jsonb_build_object(
              'images',jsonb_build_array(jsonb_build_object('id',$2::text))))))
          and a.kind='print' and a.status='ready' and a.mime_type='image/png'
          and a.has_alpha and a.has_transparency
        order by p.product_id,a.id limit 101`,
        [input.shopId, artwork.front[0]!.id]
      )
    )
  ).rows
  if (publications.length > 100) return null
  const verified = new Map<string, Record<string, unknown>>()
  for (const saved of publications) {
    if (
      !saved.snapshot ||
      typeof saved.snapshot !== "object" ||
      Array.isArray(saved.snapshot) ||
      saved.snapshot_shop_id !== input.shopId ||
      typeof saved.snapshot_product_id !== "string"
    )
      continue
    const snapshot = saved.snapshot as Record<string, unknown>
    const pin = publishedArtworkSchema.safeParse(snapshot.storefront_artwork)
    const original = previewArtwork(snapshot)
    if (
      snapshot.storefront_artwork_enabled === true &&
      pin.success &&
      saved.revision_id === pin.data.revisionId &&
      saved.sha256 === pin.data.sourceSha256 &&
      productArtworkFingerprint(snapshot, {
        shopId: saved.snapshot_shop_id,
        productId: saved.snapshot_product_id,
      }) === pin.data.productionFingerprint &&
      original?.front[0]?.id === artwork.front[0]!.id &&
      [...original.front, ...artwork.front].every(
        (image) =>
          (image.width === undefined || image.width === saved.width) &&
          (image.height === undefined || image.height === saved.height)
      )
    ) {
      verified.set(`${saved.id}:${pin.data.revisionId}:${pin.data.sourceSha256}`, saved)
    }
  }
  // Reusing one immutable upload can change the garment and placement, but cannot choose between conflicting pins.
  if (verified.size > 1) return null
  const saved = verified.values().next().value
  if (saved) {
    return {
      revisionId: String(saved.revision_id),
      productionFingerprint: input.productionFingerprint,
      printAsset: mapPrivateArtworkAsset(saved),
    }
  }
  const src = artwork.front.find((image) => image.src)?.src
  if (!src) return null
  let bytes: Buffer
  try {
    const signal = AbortSignal.timeout(Math.min(15_000, remaining()))
    bytes = await withinDesignDeadline(signal, () =>
      options.readSource ? options.readSource(src, signal) : readPrintifyArtworkSource(src, fetch, signal)
    )
  } catch (error) {
    if (error instanceof DesignDraftError && error.code === "CONFLICT") return null
    throw new PublishedImageError("IMAGE_SOURCE_UNAVAILABLE", true)
  }

  let pixels: { pixelSha256: string; width: number; height: number }
  try {
    if (bytes.length > 64 * 1024 * 1024) return null
    const source = sharp(bytes, { limitInputPixels: 40_000_000, failOn: "warning" }).timeout({
      seconds: Math.max(1, Math.floor(remaining() / 1000)),
    })
    const metadata = await source.metadata()
    if (metadata.format !== "png" || !metadata.hasAlpha || (metadata.pages ?? 1) !== 1) return null
    const { data, info } = await source
      .timeout({ seconds: Math.max(1, Math.floor(remaining() / 1000)) })
      .toColourspace("srgb")
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    let transparent = false,
      visible = false
    for (let index = 3; index < data.length && !(transparent && visible); index += 4) {
      transparent ||= data[index]! < 255
      visible ||= data[index]! > 0
    }
    if (!transparent || !visible) return null
    pixels = {
      width: info.width,
      height: info.height,
      pixelSha256: createHash("sha256").update(`${info.width}x${info.height}:rgba8\0`).update(data).digest("hex"),
    }
  } catch (error) {
    if (error instanceof PublishedImageError || (error instanceof Error && /timeout/i.test(error.message)))
      throw new PublishedImageError("IMAGE_SOURCE_UNAVAILABLE", true)
    return null
  }
  if (
    artwork.front.some(
      (image) =>
        (image.width !== undefined && image.width !== pixels.width) ||
        (image.height !== undefined && image.height !== pixels.height)
    )
  )
    return null
  remaining()
  const candidates = (
    await bounded(() =>
      database.query<Record<string, unknown>>(
        `select a.*,d.canonical_design_id,
        exists(select 1 from public.library_product_bindings b
          where b.shop_id=$1 and b.product_id=$2 and b.revision_id=a.revision_id) as bound_revision,
        exists(select 1 from commerce.design_product_artwork p
          where p.shop_id=$1 and p.product_id=$2 and p.revision_id=a.revision_id
            and p.print_asset_id=a.id and p.print_sha256=a.sha256) as registered_revision
      from public.library_assets a
      join public.library_artwork_revisions r on r.id=a.revision_id
      join public.library_designs d on d.id=r.design_id
      join public.library_designs canonical on canonical.id=d.canonical_design_id
      where a.kind='print' and a.status='ready' and a.mime_type='image/png'
        and a.has_alpha and a.has_transparency
        and a.pixel_sha256=$3 and a.width=$4 and a.height=$5
        and d.state='active' and canonical.state='active'
      order by a.id limit 101`,
        [input.shopId, input.productId, pixels.pixelSha256, pixels.width, pixels.height]
      )
    )
  ).rows
  const candidate = selectCandidate(candidates)
  if (!candidate) return null
  return {
    revisionId: String(candidate.revision_id),
    productionFingerprint: input.productionFingerprint,
    printAsset: mapPrivateArtworkAsset(candidate),
  }
}
