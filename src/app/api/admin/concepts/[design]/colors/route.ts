import { z } from "zod"

import { getAdminActor } from "@/features/admin/get-admin-actor.server"
import { createPostgresLibraryStore } from "@/features/design-library/postgres-library-store.server"
import { LibraryError } from "@/features/design-library/library-error"
import { env } from "@/lib/env"
import { getSiteUrl } from "@/lib/get-site-url"
import { hasSameOrigin } from "@/lib/has-same-origin"
import { privateResponseHeaders } from "@/lib/private-response-headers"

export const dynamic = "force-dynamic"

const body = z.object({ colorName: z.string().trim().min(1).max(120) }).strict()

async function change(
  request: Request,
  context: { params: Promise<{ design: string }> },
  apply: (designId: string, userId: string, colorName: string) => Promise<unknown>
) {
  const respond = (value: unknown, status = 200) => Response.json(value, { status, headers: privateResponseHeaders })
  const deployment = env.VERCEL_ENV === "preview" && env.VERCEL_URL ? new URL(`https://${env.VERCEL_URL}`) : undefined
  if (!hasSameOrigin(request, getSiteUrl(), deployment))
    return respond({ error: "Use the design library to change garment colors." }, 403)
  const actor = await getAdminActor()
  if (!actor) return respond({ error: "Sign in as an administrator." }, 401)
  const { design: designId } = await context.params
  if (!z.uuid().safeParse(designId).success) return respond({ error: "Design not found." }, 404)
  const input = body.safeParse(await request.json().catch(() => null))
  if (!input.success) return respond({ error: "Choose a garment color." }, 400)
  try {
    return respond(await apply(designId, actor.userId, input.data.colorName))
  } catch (error) {
    if (error instanceof LibraryError) {
      switch (error.code) {
        case "FORBIDDEN":
          return respond({ error: "Sign in as a current administrator." }, 403)
        case "NOT_FOUND":
          return respond({ error: "That design or color is no longer available." }, 404)
        case "INVALID_INPUT":
          return respond({ error: "Choose a garment color this product model offers." }, 400)
        case "CONFLICT":
          return respond({ error: "This design already offers five colors. Remove one first." }, 409)
      }
    }
    return respond({ error: "Garment colors are temporarily unavailable. Try again shortly." }, 503)
  }
}

export async function POST(request: Request, context: { params: Promise<{ design: string }> }) {
  return change(request, context, (designId, userId, colorName) =>
    createPostgresLibraryStore().promoteDesignColor(userId, { designId, colorName })
  )
}

export async function DELETE(request: Request, context: { params: Promise<{ design: string }> }) {
  return change(request, context, (designId, userId, colorName) =>
    createPostgresLibraryStore().removeDesignColor(userId, { designId, colorName })
  )
}
