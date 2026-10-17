import { z } from "zod"
import { refreshStorefront } from "@/features/design-of-the-week/refresh-storefront.server"
import { authorizeHeroAdmin } from "@/features/weekly-heroes/authorize-hero-admin.server"
import { getWeeklyHeroStore } from "@/features/weekly-heroes/get-weekly-hero-store.server"
import { weeklyHeroSchema } from "@/features/weekly-heroes/weekly-hero-schema"
import { WeeklyHeroError } from "@/features/weekly-heroes/weekly-hero-error"
import { privateResponseHeaders } from "@/lib/private-response-headers"

export const dynamic = "force-dynamic"
export async function PUT(request: Request) {
  const actor = await authorizeHeroAdmin(request)
  if (actor instanceof Response) return actor
  const input = z
    .object({
      liveAt: z.iso.datetime(),
      version: z.uuid().nullable(),
      scheduled: z.boolean(),
      manifest: weeklyHeroSchema,
    })
    .strict()
    .safeParse(await request.json().catch(() => null))
  if (!input.success)
    return Response.json(
      { error: input.error.issues[0]?.message ?? "Check the hero details." },
      { status: 400, headers: privateResponseHeaders }
    )
  try {
    const hero = await getWeeklyHeroStore().save(input.data, actor.userId)
    refreshStorefront()
    return Response.json({ hero }, { headers: privateResponseHeaders })
  } catch (error) {
    return Response.json(
      { error: error instanceof WeeklyHeroError ? error.message : "The hero could not be saved. Try again shortly." },
      { status: error instanceof WeeklyHeroError ? 409 : 503, headers: privateResponseHeaders }
    )
  }
}

export async function DELETE(request: Request) {
  const actor = await authorizeHeroAdmin(request)
  if (actor instanceof Response) return actor
  const input = z
    .object({ liveAt: z.iso.datetime(), version: z.uuid() })
    .strict()
    .safeParse(await request.json().catch(() => null))
  if (!input.success)
    return Response.json(
      { error: "Reload the saved hero before withdrawing." },
      { status: 400, headers: privateResponseHeaders }
    )
  try {
    const hero = await getWeeklyHeroStore().withdraw(input.data, actor.userId)
    refreshStorefront()
    return Response.json({ hero }, { headers: privateResponseHeaders })
  } catch (error) {
    return Response.json(
      { error: error instanceof WeeklyHeroError ? error.message : "The hero could not be withdrawn." },
      { status: error instanceof WeeklyHeroError ? 409 : 503, headers: privateResponseHeaders }
    )
  }
}
