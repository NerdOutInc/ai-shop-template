import { z } from "zod"

import { getAdminActor } from "@/features/admin/get-admin-actor.server"
import { createPostgresLibraryStore } from "@/features/design-library/postgres-library-store.server"
import { LibraryError } from "@/features/design-library/library-error"
import { env } from "@/lib/env"
import { getSiteUrl } from "@/lib/get-site-url"
import { hasSameOrigin } from "@/lib/has-same-origin"
import { privateResponseHeaders } from "@/lib/private-response-headers"

export const dynamic = "force-dynamic"

export async function PUT(request: Request, context: { params: Promise<{ design: string }> }) {
  const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: privateResponseHeaders })
  const deployment = env.VERCEL_ENV === "preview" && env.VERCEL_URL ? new URL(`https://${env.VERCEL_URL}`) : undefined
  if (!hasSameOrigin(request, getSiteUrl(), deployment))
    return respond({ error: "Use the gallery to update your favorites." }, 403)
  const actor = await getAdminActor()
  if (!actor) return respond({ error: "Sign in as an administrator." }, 401)
  const { design: designId } = await context.params
  if (!z.uuid().safeParse(designId).success) return respond({ error: "Design not found." }, 404)
  const input = z
    .object({ selected: z.boolean(), revisionId: z.uuid(), colorName: z.string().max(120).nullish() })
    .strict()
    .safeParse(await request.json().catch(() => null))
  if (!input.success) return respond({ error: "Choose an available artwork revision." }, 400)
  try {
    const result = await createPostgresLibraryStore().setFavorite(actor.userId, { designId, ...input.data })
    return respond(result)
  } catch (error) {
    if (error instanceof LibraryError) {
      switch (error.code) {
        case "FORBIDDEN":
          return respond({ error: "Sign in as a current administrator." }, 403)
        case "NOT_FOUND":
          return respond({ error: "This artwork revision is no longer available." }, 404)
        case "INVALID_INPUT":
          return respond({ error: "Choose an available artwork revision." }, 400)
        case "CONFLICT":
          return respond({ error: "This selection changed. Reload the design and try again." }, 409)
      }
    }
    return respond({ error: "Favorites are temporarily unavailable. Try again shortly." }, 503)
  }
}
