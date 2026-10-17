import { z } from "zod"
import { authorizeHeroAdmin } from "@/features/weekly-heroes/authorize-hero-admin.server"
import { getWeeklyHeroStore } from "@/features/weekly-heroes/get-weekly-hero-store.server"
import { readHeroImage } from "@/features/weekly-heroes/read-hero-image.server"
import { privateResponseHeaders } from "@/lib/private-response-headers"

export const dynamic = "force-dynamic"
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authorizeHeroAdmin(request)
  if (actor instanceof Response) return actor
  const { id } = await params
  if (!z.uuid().safeParse(id).success) return new Response(null, { status: 404, headers: privateResponseHeaders })
  try {
    const asset = await getWeeklyHeroStore().asset(id)
    const image = asset ? await readHeroImage(asset) : null
    return image
      ? new Response(new Uint8Array(image.bytes), {
          headers: {
            ...privateResponseHeaders,
            "Content-Type": image.contentType,
            "X-Content-Type-Options": "nosniff",
          },
        })
      : new Response(null, { status: 404, headers: privateResponseHeaders })
  } catch {
    return new Response(null, { status: 503, headers: privateResponseHeaders })
  }
}
