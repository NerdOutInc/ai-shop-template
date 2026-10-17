import { storeConfig } from "@/lib/store-config"
import { z } from "zod"
import { getWeeklyHeroStore } from "@/features/weekly-heroes/get-weekly-hero-store.server"
import { readHeroImage } from "@/features/weekly-heroes/read-hero-image.server"
import { privateResponseHeaders } from "@/lib/private-response-headers"

export const dynamic = "force-dynamic"
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!storeConfig.features.designOfTheWeek) return new Response(null, { status: 404, headers: privateResponseHeaders })
  const { id } = await params
  if (!z.uuid().safeParse(id).success) return new Response(null, { status: 404, headers: privateResponseHeaders })
  try {
    const asset = await getWeeklyHeroStore().currentAsset(id)
    if (!asset) return new Response(null, { status: 404, headers: privateResponseHeaders })
    const image = await readHeroImage(asset)
    if (!image) return new Response(null, { status: 404, headers: privateResponseHeaders })
    // Source reads and the responsive renderer are uncached, so withdrawal revokes future requests.
    return new Response(new Uint8Array(image.bytes), {
      headers: { ...privateResponseHeaders, "Content-Type": image.contentType },
    })
  } catch {
    return new Response(null, { status: 503, headers: privateResponseHeaders })
  }
}
