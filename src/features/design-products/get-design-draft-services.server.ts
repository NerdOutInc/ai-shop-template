import "server-only"

import type { Pool } from "pg"

import { getAdminDatabase } from "@/features/admin/get-admin-database.server"
import { inspectLibraryImage } from "@/features/design-library/inspect-library-image.server"
import type { LibraryStoredAsset } from "@/features/design-library/library-types"
import { readPrivateAsset } from "@/features/design-library/read-private-asset.server"
import { env } from "@/lib/env"
import { getSiteUrl } from "@/lib/get-site-url"

import type { DesignDraftClient, DesignDraftInput, DesignProductPayload } from "./design-draft-types"
import type { DesignDraftOperation } from "./postgres-design-draft-store.server"

import { DesignDraftError } from "./design-draft-error"
import { matchDesignProduct } from "./match-design-product"
import { PostgresDesignDraftStore } from "./postgres-design-draft-store.server"
import { PrintifyDesignDraftClient } from "./printify-design-draft-client.server"
import { readPrintifyArtworkSource } from "./read-printify-artwork-source.server"
import { readProductArtworkImages } from "./read-product-artwork-images"
import { readDesignAssetBytes } from "./read-design-asset-bytes.server"
import { withinDesignDeadline } from "./within-design-deadline.server"

async function readBytes(asset: LibraryStoredAsset, signal: AbortSignal) {
  const stream = await readPrivateAsset(asset, { signal })
  if (!stream) throw new DesignDraftError("CONFLICT", "The prepared private artwork is unavailable")
  return readDesignAssetBytes(stream, signal)
}

function payloadFor(operation: DesignDraftOperation): DesignProductPayload {
  const recipe = operation.recipe,
    { position, ...placement } = recipe.placement
  return {
    title: operation.title,
    description: recipe.description,
    blueprint_id: recipe.blueprintId,
    print_provider_id: recipe.printProviderId,
    variants: recipe.variants.map(({ id, price }) => ({ id, price, is_enabled: true })),
    print_areas: [
      {
        variant_ids: recipe.variants.map(({ id }) => id),
        placeholders: [{ position, images: [{ id: operation.uploadedImageId!, ...placement }] }],
      },
    ],
  }
}

function isDraft(raw: Record<string, unknown>) {
  const external = raw.external
  return (
    raw.is_locked === false &&
    (!external || (typeof external === "object" && Object.values(external).every((value) => !value)))
  )
}

/** One frozen selection per call keeps a frozen batch resumable within an HTTP request budget. */
export function getDesignDraftServices(options: {
  userId: string
  /** Null for a signed-in administrator; `authorize` then re-checks that session, not a grant. */
  grantId: string | null
  authorize: () => Promise<void>
  database?: Pool
  client?: DesignDraftClient
  readAssetBytes?: (asset: LibraryStoredAsset, signal: AbortSignal) => Promise<Buffer>
  siteUrl?: URL
  readArtworkSource?: (src: string, signal: AbortSignal) => Promise<Buffer>
  signal?: AbortSignal
}) {
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(50_000)])
    : AbortSignal.timeout(50_000)
  const bounded = <T>(work: () => Promise<T>) => withinDesignDeadline(signal, work)
  const authorize = async () => {
    try {
      await bounded(options.authorize)
    } catch {
      throw new DesignDraftError(
        signal.aborted ? "PROVIDER_UNAVAILABLE" : "FORBIDDEN",
        signal.aborted
          ? "The draft command deadline was reached"
          : options.grantId
            ? "A current owner grant is required for this draft command"
            : "Current administrator access is required for this draft command"
      )
    }
  }
  if (!options.client && !env.PRINTIFY_DRAFTS_API_TOKEN?.trim())
    throw new DesignDraftError(
      "INVALID_INPUT",
      "Configure PRINTIFY_DRAFTS_API_TOKEN with products.read, products.write, uploads.write and catalog.read before creating draft requests"
    )
  const client =
    options.client ??
    new PrintifyDesignDraftClient(env.PRINTIFY_DRAFTS_API_TOKEN ?? "", env.PRINTIFY_SHOP_ID ?? "", fetch, signal)
  const store = new PostgresDesignDraftStore(
    options.database ?? getAdminDatabase(),
    options.userId,
    options.grantId,
    client.shopId
  )
  const readAsset = options.readAssetBytes ?? readBytes
  async function verifiedAsset(asset: LibraryStoredAsset) {
    const inspected = await bounded(async () => inspectLibraryImage(await readAsset(asset, signal)))
    if (
      inspected.sha256 !== asset.sha256 ||
      inspected.pixelSha256 !== asset.pixelSha256 ||
      inspected.width !== asset.width ||
      inspected.height !== asset.height ||
      inspected.mimeType !== "image/png" ||
      !inspected.hasAlpha ||
      !inspected.hasTransparency
    )
      throw new DesignDraftError("CONFLICT", "The exact prepared transparent artwork could not be verified")
  }
  async function verifyCandidate(operation: DesignDraftOperation, id: string, payload: DesignProductPayload) {
    await authorize()
    const product = await bounded(() => client.getProduct(id))
    if (product) await store.saveReadback(operation, product)
    if (!product || !matchDesignProduct(product, payload, operation.selection.asset) || !isDraft(product)) {
      await store.attention(operation, "PRODUCT_CHANGED_OR_PUBLISHED")
      return false
    }
    await store.verify(operation, product, payload.print_areas[0]!.placeholders[0]!.images[0]!.id)
    return true
  }
  async function sourceEvidence(image: { id: string; src?: string }) {
    let evidence = await store.readImageEvidence(image.id, image.src)
    if (!evidence) {
      if (!image.src) throw new Error("Full original unavailable")
      const inspected = await bounded(async () =>
        inspectLibraryImage(
          await (options.readArtworkSource
            ? options.readArtworkSource(image.src!, signal)
            : readPrintifyArtworkSource(image.src!, fetch, signal))
        )
      )
      await store.saveImageEvidence(image.id, image.src, inspected)
      evidence = inspected
    }
    return evidence
  }
  async function findMatch(operation: DesignDraftOperation, payload: DesignProductPayload) {
    await authorize()
    const inventory = await bounded(() => client.listProducts())
    const possible: { product: Record<string, unknown>; imageId: string }[] = []
    for (const product of inventory.filter((entry) => entry.blueprint_id === operation.recipe.blueprintId)) {
      const artwork = readProductArtworkImages(product)
      if (!artwork) {
        await store.blockInventory(operation, String(product.id))
        return "blocked" as const
      }
      let matchingImageId: string | null = null
      for (const image of artwork.images) {
        if (image.id === operation.uploadedImageId) {
          matchingImageId = image.id
          await store.recordCandidate(operation, String(product.id), image.id)
          break
        }
        try {
          const evidence = await sourceEvidence(image)
          if (
            evidence.pixelSha256 === operation.selection.asset.pixelSha256 &&
            evidence.width === operation.selection.asset.width &&
            evidence.height === operation.selection.asset.height
          ) {
            matchingImageId = image.id
            await store.recordCandidate(operation, String(product.id), image.id)
            break
          }
        } catch (error) {
          if (error instanceof DesignDraftError && error.code === "FORBIDDEN") throw error
          await store.blockInventory(operation, String(product.id))
          return "blocked" as const
        }
      }
      if (matchingImageId) {
        await store.recordCandidate(operation, String(product.id), matchingImageId)
        possible.push({ product, imageId: matchingImageId })
      }
    }
    if (!possible.length) {
      if (operation.knownProductIds.length) {
        await store.attention(operation, "PREVIOUS_PRODUCT_NOW_ABSENT")
        return "blocked" as const
      }
      return "absent" as const
    }
    if (
      possible.length !== 1 ||
      (operation.observedProductId && possible[0]!.product.id !== operation.observedProductId)
    ) {
      await store.attention(operation, "AMBIGUOUS_ARTWORK_MODEL")
      return "blocked" as const
    }
    const candidate = possible[0]!
    if (!operation.productPayload) {
      payload = structuredClone(payload)
      payload.print_areas[0]!.placeholders[0]!.images[0]!.id = candidate.imageId
      if (!(await store.startCreate(operation, payload))) return "blocked" as const
      operation.productPayload = payload
      await store.observed(operation, String(candidate.product.id))
    }
    return (await verifyCandidate(operation, String(candidate.product.id), payload))
      ? ("verified" as const)
      : ("blocked" as const)
  }

  return {
    async create(input: DesignDraftInput) {
      await authorize()
      await store.freeze(input)
      const operation = await store.next(input.requestId)
      if (!operation) return store.results(input.requestId)
      let intentPreparedHere = false
      let createDispatched = false
      try {
        await verifiedAsset(operation.selection.asset)
        await authorize()
        await bounded(() => client.validateRecipe(operation.recipe))
        if (!operation.uploadedImageId) {
          await authorize()
          const token = await store.issueCapability(operation)
          const origin = options.siteUrl ?? getSiteUrl()
          if (
            origin.protocol !== "https:" &&
            !(options.siteUrl && ["localhost", "127.0.0.1"].includes(origin.hostname))
          )
            throw new DesignDraftError("INVALID_INPUT", "The authorized store origin must support HTTPS")
          await authorize()
          let receipt: Awaited<ReturnType<DesignDraftClient["uploadImage"]>>
          try {
            receipt = await bounded(() =>
              client.uploadImage({
                fileName: `design-${operation.selection.displayNumber}-${operation.selection.asset.sha256}.png`,
                url: new URL(`/api/printify/artwork/${token}`, origin).href,
              })
            )
          } catch (error) {
            await store.retryUpload(operation)
            if (error instanceof DesignDraftError && ["FORBIDDEN", "PROVIDER_REJECTED"].includes(error.code))
              throw error
            throw new DesignDraftError(
              "PROVIDER_UNAVAILABLE",
              "Artwork upload was not confirmed; retry this same request. An unused provider image may require cleanup"
            )
          }
          if (
            receipt.width !== operation.selection.asset.width ||
            receipt.height !== operation.selection.asset.height ||
            receipt.mimeType !== "image/png"
          ) {
            await store.retryUpload(operation, receipt)
            return store.results(input.requestId)
          }
          if (!(await store.saveUpload(operation, receipt.id)))
            throw new DesignDraftError(
              "CONFLICT",
              "Another worker owns the upload receipt; continue the existing request"
            )
          operation.uploadedImageId = receipt.id
        }
        const payload = payloadFor(operation)
        const match = await findMatch(operation, payload)
        if (match !== "absent") return store.results(input.requestId)
        await authorize()
        if (!(await store.startCreate(operation, payload))) return store.results(input.requestId)
        // A crash after this receipt stays uncertain; only this live invocation can prove a POST was not sent.
        operation.productPayload = payload
        intentPreparedHere = true
        await authorize()
        const response = await bounded(() => {
          createDispatched = true
          return client.createProduct(payload)
        })
        await store.observed(operation, response.id)
        await verifyCandidate(operation, response.id, payload)
      } catch (error) {
        const rejected =
          error instanceof DesignDraftError &&
          error.code === "PROVIDER_REJECTED" &&
          [400, 401, 403, 404, 422].includes(error.httpStatus ?? 0)
        if (intentPreparedHere && (!createDispatched || rejected)) {
          if (await store.resetUnsubmitted(operation, rejected ? error.httpStatus : undefined)) {
            if (rejected) return store.results(input.requestId)
            throw error
          }
        }
        if (operation.productPayload) {
          await store.attention(operation, "CREATE_OR_RECEIPT_UNCERTAIN")
          if (error instanceof DesignDraftError && error.code === "FORBIDDEN") throw error
          return store.results(input.requestId)
        }
        if (!operation.uploadedImageId) await store.retryUpload(operation)
        await store.releaseLease(
          operation,
          error instanceof DesignDraftError && ["INVALID_INPUT", "CONFLICT", "PROVIDER_REJECTED"].includes(error.code)
        )
        if (error instanceof DesignDraftError) throw error
        throw new DesignDraftError(
          "PROVIDER_UNAVAILABLE",
          "Draft work could not be confirmed; continue or reconcile the same request"
        )
      }
      return store.results(input.requestId)
    },
    /** Null when this owner has frozen no such request in this shop. */
    async frozenInput(input: { requestId: string }) {
      await authorize()
      return store.readInput(input.requestId)
    },
    async reconcile(input: { requestId: string }) {
      await authorize()
      await store.results(input.requestId)
      const operation = await store.next(input.requestId, true)
      if (operation) {
        try {
          await verifiedAsset(operation.selection.asset)
          const match = await findMatch(operation, operation.productPayload ?? payloadFor(operation))
          if (match === "absent") {
            if (operation.productPayload) await store.attention(operation, "NO_PROVEN_PRODUCT_MATCH")
            else await store.resumeAfterInspection(operation)
          }
        } catch (error) {
          if (error instanceof DesignDraftError && error.code === "FORBIDDEN") {
            await store.releaseLease(operation)
            throw error
          }
          await store.attention(operation, "RECONCILIATION_UNAVAILABLE")
        }
      }
      return store.results(input.requestId)
    },
    async reconcileBinding(input: { bindingId: string }) {
      await authorize()
      const binding = await store.readBinding(input.bindingId)
      if (!binding.productId || !binding.asset || !binding.revisionId)
        return {
          status: "needs-reconciliation",
          message:
            "This binding has no exact recorded product and prepared revision; inspect its saved operation evidence",
        }
      await verifiedAsset(binding.asset)
      const raw = await bounded(() => client.getProduct(binding.productId!))
      if (!raw) {
        await store.markBinding(input.bindingId, "removed")
        return {
          status: "removed",
          message: "The recorded provider product is absent; its model reservation remains in place",
        }
      }
      const images = readProductArtworkImages(raw),
        unique = new Map(images?.front.map((image) => [image.id, image]) ?? [])
      if (
        raw.blueprint_id !== Number(binding.modelId.replace("printify-blueprint:", "")) ||
        images?.hasOtherArtwork ||
        images?.hasLayeredArtwork ||
        images?.hasUnsupportedArtwork ||
        unique.size !== 1 ||
        !images?.front.length
      ) {
        await store.markBinding(input.bindingId, "needs-reconciliation")
        return {
          status: "needs-reconciliation",
          message: "The model or artwork layers need explicit review",
        }
      }
      const image = [...unique.values()][0]!
      const inventory = await bounded(() => client.listProducts())
      const candidates: Record<string, unknown>[] = []
      for (const product of inventory.filter((entry) => entry.blueprint_id === raw.blueprint_id)) {
        let matched = false
        const artwork = readProductArtworkImages(product)
        if (!artwork) {
          await store.markBinding(input.bindingId, "needs-reconciliation")
          return {
            status: "needs-reconciliation",
            blockingProductIds: [String(product.id)],
            message: "Inspect this provider product's original artwork before resolving the binding",
          }
        }
        for (const item of artwork.images) {
          try {
            const evidence = await sourceEvidence(item)
            if (
              evidence.pixelSha256 === binding.asset.pixelSha256 &&
              evidence.width === binding.asset.width &&
              evidence.height === binding.asset.height
            )
              matched = true
          } catch (error) {
            if (error instanceof DesignDraftError && error.code === "FORBIDDEN") throw error
            await store.markBinding(input.bindingId, "needs-reconciliation")
            return {
              status: "needs-reconciliation",
              blockingProductIds: [String(product.id)],
              message:
                "Retrieve the exact original for this provider product, then reconcile again; previews cannot prove absence of duplicate artwork",
            }
          }
        }
        if (matched) candidates.push(product)
      }
      if (candidates.length !== 1 || candidates[0]?.id !== binding.productId) {
        await store.markBinding(input.bindingId, "needs-reconciliation")
        return {
          status: "needs-reconciliation",
          message: "Provider artwork matches more than one product; resolve those bindings explicitly",
        }
      }
      if (!image.src) {
        await store.markBinding(input.bindingId, "needs-reconciliation")
        return {
          status: "needs-reconciliation",
          message: "The full original artwork source is unavailable; a library preview cannot verify it",
        }
      }
      try {
        const inspected = await bounded(async () =>
          inspectLibraryImage(
            await (options.readArtworkSource
              ? options.readArtworkSource(image.src!, signal)
              : readPrintifyArtworkSource(image.src!, fetch, signal))
          )
        )
        if (
          inspected.pixelSha256 !== binding.asset.pixelSha256 ||
          inspected.width !== binding.asset.width ||
          inspected.height !== binding.asset.height ||
          !inspected.hasAlpha ||
          !inspected.hasTransparency
        )
          throw new Error("Artwork differs")
        await authorize()
        const fresh = await bounded(() => client.getProduct(binding.productId!))
        if (
          !fresh ||
          JSON.stringify(fresh.print_areas) !== JSON.stringify(raw.print_areas) ||
          fresh.blueprint_id !== raw.blueprint_id ||
          fresh.print_provider_id !== raw.print_provider_id
        )
          throw new Error("Product changed")
        const status = await store.verifyBinding(
          input.bindingId,
          fresh,
          binding.revisionId,
          binding.asset,
          image.id,
          isDraft(fresh)
        )
        return {
          status,
          message:
            status === "published"
              ? "Exact artwork and the current published storefront snapshot verified"
              : status === "draft"
                ? "Exact artwork and provider draft verified"
                : "Exact artwork registered; confirm the current published storefront snapshot",
        }
      } catch (error) {
        if (error instanceof DesignDraftError && error.code === "FORBIDDEN") throw error
        await store.markBinding(input.bindingId, "needs-reconciliation")
        return {
          status: "needs-reconciliation",
          message: "The exact original artwork or current provider state could not be verified; no product was created",
        }
      }
    },
  }
}
