import "server-only"

import { env } from "@/lib/env"
import { AdminStore } from "./admin-store.server"
import { createAdminServerClient } from "./create-admin-server-client.server"
import { getAdminAuthConfig } from "./get-admin-auth-config.server"
import { getAdminDatabase } from "./get-admin-database.server"
import { logAdminLibraryFailure } from "./log-admin-library-failure.server"

export async function getAdminActor(): Promise<{ userId: string } | null> {
  if (!env.ADMIN_LIBRARY_ENABLED || !getAdminAuthConfig()) return null
  try {
    const client = await createAdminServerClient()
    const { data, error } = await client.auth.getUser()
    if (error || !data.user || data.user.is_anonymous || !data.user.email || !data.user.email_confirmed_at) return null
    const store = new AdminStore(getAdminDatabase())
    return (await store.isActiveMember(data.user.id)) ? { userId: data.user.id } : null
  } catch (error) {
    logAdminLibraryFailure("ADMIN_ACTOR_LOOKUP_FAILED", error)
    return null
  }
}
