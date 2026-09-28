import { assertDesignAgentGrantActive } from "@/features/design-agent/assert-design-agent-grant-active.server"
import { readPrivateAsset } from "@/features/design-library/read-private-asset.server"
import { streamProviderArtwork } from "@/features/design-products/stream-provider-artwork.server"
import { readProviderArtworkCapability } from "@/features/design-products/read-provider-artwork-capability.server"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

async function serve(params: Promise<{ token: string }>, head: boolean, requestSignal: AbortSignal) {
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
  }
  try {
    const { token } = await params
    const asset = await readProviderArtworkCapability(token, { authorize: assertDesignAgentGrantActive })
    if (!asset) return new Response(null, { status: 404, headers })
    const signal = AbortSignal.any([
      requestSignal,
      AbortSignal.timeout(Math.max(1, Math.min(50_000, asset.capabilityExpiresAt - Date.now()))),
    ])
    const body = head ? null : await readPrivateAsset(asset, { signal })
    signal.throwIfAborted()
    if (!head && !body) return new Response(null, { status: 404, headers })
    return new Response(body ? streamProviderArtwork(body, signal) : null, {
      headers: {
        ...headers,
        "Content-Type": asset.mimeType,
        "Content-Length": String(asset.bytes),
        "Content-Disposition": "attachment; filename=print-artwork.png",
      },
    })
  } catch {
    return new Response(null, { status: 404, headers })
  }
}
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  return serve(context.params, false, _request.signal)
}
export async function HEAD(_request: Request, context: { params: Promise<{ token: string }> }) {
  return serve(context.params, true, _request.signal)
}
