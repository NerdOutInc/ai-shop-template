import { getAdminAssetActor } from "@/features/admin/get-admin-asset-actor.server"
import { getDesignAgentActor } from "@/features/design-agent/get-design-agent-actor.server"
import { createPostgresLibraryStore } from "@/features/design-library/postgres-library-store.server"
import { readDisplayImage } from "@/features/design-library/read-display-image.server"
import { readPrivateAsset } from "@/features/design-library/read-private-asset.server"
import { servePrivateLibraryAsset } from "@/features/design-library/serve-private-library-asset.server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request, context: { params: Promise<{ asset: string }> }) {
  const { asset: assetId } = await context.params
  return servePrivateLibraryAsset(request, assetId, {
    authenticate: () => request.headers.has("authorization") ? getDesignAgentActor(request, "library:read") : getAdminAssetActor(),
    getAsset: (userId, id, sessionId) => createPostgresLibraryStore().getAsset(userId, id, sessionId),
    readAsset: readPrivateAsset,
    readDisplay: (asset, size) => readDisplayImage(asset, size),
  })
}
