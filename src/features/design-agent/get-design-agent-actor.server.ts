import "server-only"
import { env } from "@/lib/env"
import { getAdminDatabase } from "@/features/admin/get-admin-database.server"
import { DesignAgentGrantStore } from "./design-agent-grant-store.server"
import type { DesignAgentActor, DesignAgentScope } from "./design-agent-types"

export async function getDesignAgentActor(request: Request, scope: DesignAgentScope): Promise<DesignAgentActor | null> {
  if (!env.ADMIN_LIBRARY_ENABLED) return null
  const match = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "")
  if (!match) return null
  return new DesignAgentGrantStore(getAdminDatabase()).authenticate(match[1]!, scope)
}
