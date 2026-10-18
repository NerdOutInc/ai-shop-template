import "server-only"

import { z } from "zod"
import { privateResponseHeaders } from "@/lib/private-response-headers"

import type { LibraryStoredAsset } from "./library-types"
import type { DisplayImageSize } from "./display-image-sizes"
import { DISPLAY_IMAGE_SIZES } from "./display-image-sizes"
import { LibraryError } from "./library-error"

type Dependencies = {
  authenticate: (request: Request) => Promise<{ userId: string; sessionId?: string } | null>
  getAsset: (userId: string, assetId: string, sessionId?: string) => Promise<LibraryStoredAsset | null>
  readAsset: (asset: LibraryStoredAsset) => Promise<ReadableStream<Uint8Array> | null>
  readDisplay?: (
    asset: LibraryStoredAsset,
    size: DisplayImageSize
  ) => Promise<{ body: Buffer | ReadableStream<Uint8Array>; bytes: number; sha256: string | null } | null>
}

const displaySize = z.enum(Object.keys(DISPLAY_IMAGE_SIZES) as [DisplayImageSize, ...DisplayImageSize[]])

export async function servePrivateLibraryAsset(request: Request, assetId: string, dependencies: Dependencies) {
  const error = (status: number, message: string) =>
    Response.json({ error: message }, { status, headers: privateResponseHeaders })
  try {
    const actor = await dependencies.authenticate(request)
    if (!actor) return error(401, "Sign in as an administrator to access artwork.")
    if (!z.uuid().safeParse(assetId).success) return error(404, "Artwork not found.")
    const asset = await dependencies.getAsset(actor.userId, assetId, actor.sessionId)
    if (!asset || asset.status !== "ready") return error(404, "Artwork is not available yet.")
    const parameters = new URL(request.url).searchParams
    const requested = parameters.get("size")
    const name = asset.originalFilename.replace(/[\r\n\u0000-\u001f\u007f]/g, "").slice(0, 200)
    const fallback = name.replace(/[^a-zA-Z0-9._-]/g, "_") || "artwork"
    const disposition = parameters.get("download") === "1" ? "attachment" : "inline"
    const encode = (value: string) =>
      encodeURIComponent(value).replace(
        /['()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
      )
    // A browsing size is WebP whatever the master is, and all three sizes plus the master
    // would otherwise arrive under one name, so each says which file it actually is.
    const named = (label: string | null) => {
      const suffix = label ? `-${label}.webp` : ""
      const full = label ? `${name.replace(/\.[^.]+$/, "")}${suffix}` : name
      const safe = (label ? fallback.replace(/\.[^.]+$/, "") + suffix : fallback).replace(/[^a-zA-Z0-9._-]/g, "_")
      return `${disposition}; filename="${safe || "artwork"}"; filename*=UTF-8''${encode(full)}`
    }

    if (requested !== null) {
      const size = displaySize.safeParse(requested)
      if (!size.success) return error(404, "That artwork size is not available.")
      const display = dependencies.readDisplay ? await dependencies.readDisplay(asset, size.data) : null
      // Falling back to the master would hand a browsing grid the very print-sized file
      // this size exists to avoid, so an unprepared asset simply has no browsing size.
      if (!display) return error(404, "A browsing size needs prepared transparent artwork.")
      return new Response(display.body as BodyInit, {
        headers: {
          ...privateResponseHeaders,
          // No browser cache, like other admin responses: the admin proxy response sets
          // private, no-store across /api/admin. The derivative is cached server-side in
          // the private Blob store, so a repeat visit costs a read rather than a resize.
          "Content-Type": "image/webp",
          "Content-Disposition": named(size.data),
          "Content-Length": String(display.bytes),
          ...(display.sha256 ? { "X-Content-SHA256": display.sha256 } : {}),
          "Content-Security-Policy": "default-src 'none'; sandbox",
        },
      })
    }

    const stream = await dependencies.readAsset(asset)
    if (!stream) return error(404, "Artwork is not available yet.")
    return new Response(stream, {
      headers: {
        ...privateResponseHeaders,
        "Content-Type": asset.mimeType,
        "Content-Disposition": named(null),
        ...(asset.bytes ? { "Content-Length": String(asset.bytes) } : {}),
        ...(asset.sha256 ? { "X-Content-SHA256": asset.sha256 } : {}),
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    })
  } catch (cause) {
    if (cause instanceof LibraryError && cause.code === "FORBIDDEN")
      return error(403, "Current administrator access is required.")
    return error(503, "Artwork is temporarily unavailable. Try again shortly.")
  }
}
