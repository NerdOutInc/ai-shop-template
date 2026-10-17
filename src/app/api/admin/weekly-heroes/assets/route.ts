import { authorizeHeroAdmin } from "@/features/weekly-heroes/authorize-hero-admin.server"
import { uploadHeroImage } from "@/features/weekly-heroes/upload-hero-image.server"
import { WeeklyHeroError } from "@/features/weekly-heroes/weekly-hero-error"
import { privateResponseHeaders } from "@/lib/private-response-headers"

export const dynamic = "force-dynamic"
export async function POST(request: Request) {
  const actor = await authorizeHeroAdmin(request)
  if (actor instanceof Response) return actor
  try {
    return Response.json({ asset: await uploadHeroImage(request, actor.userId) }, { headers: privateResponseHeaders })
  } catch (error) {
    return Response.json(
      {
        error: error instanceof WeeklyHeroError ? error.message : "The image could not be uploaded. Try again shortly.",
      },
      { status: error instanceof WeeklyHeroError ? 400 : 503, headers: privateResponseHeaders }
    )
  }
}
