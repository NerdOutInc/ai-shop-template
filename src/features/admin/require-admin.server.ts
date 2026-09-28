import "server-only"

import { notFound, redirect } from "next/navigation"
import { env } from "@/lib/env"
import { adminSignInDestination } from "./admin-sign-in-destination"
import { getAdminActor } from "./get-admin-actor.server"

export async function requireAdmin(returnTo?: string): Promise<{ userId: string }> {
  if (!env.ADMIN_LIBRARY_ENABLED) notFound()
  const actor = await getAdminActor()
  if (!actor) {
    const destination = adminSignInDestination(returnTo)
    redirect(
      destination === "/admin/concepts"
        ? "/admin/sign-in"
        : `/admin/sign-in?returnTo=${encodeURIComponent(destination)}`
    )
  }
  return actor
}
