import { storeConfig } from "@/lib/store-config"
import { z } from "zod"
import { getWeeklyHeroStore } from "@/features/weekly-heroes/get-weekly-hero-store.server"
import { readHeroImage } from "@/features/weekly-heroes/read-hero-image.server"
import { matchesEntityTag } from "@/lib/matches-entity-tag"
import { privateResponseHeaders } from "@/lib/private-response-headers"

export const dynamic = "force-dynamic"
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!storeConfig.features.designOfTheWeek) return new Response(null, { status: 404, headers: privateResponseHeaders })
  const { id } = await params
  if (!z.uuid().safeParse(id).success) return new Response(null, { status: 404, headers: privateResponseHeaders })
  try {
    const asset = await getWeeklyHeroStore().currentAsset(id.toLowerCase())
    if (!asset) return new Response(null, { status: 404, headers: privateResponseHeaders })
    const etag = `"${asset.sha256}"`
    const headers = { ...privateResponseHeaders, "Cache-Control": "private, no-cache", ETag: etag }
    if (matchesEntityTag(request.headers.get("if-none-match"), etag))
      return new Response(null, { status: 304, headers })
    const image = await readHeroImage(asset)
    if (!image) return new Response(null, { status: 404, headers: privateResponseHeaders })
    // Browser copies revalidate through the uncached eligibility gate on every use.
    return new Response(new Uint8Array(image.bytes), {
      headers: { ...headers, "Content-Type": image.contentType },
    })
  } catch {
    return new Response(null, { status: 503, headers: privateResponseHeaders })
  }
}
