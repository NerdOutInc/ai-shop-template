import "server-only"
import { getAdminDatabase } from "@/features/admin/get-admin-database.server"
import { DesignAgentGrantStore } from "./design-agent-grant-store.server"
import type { DesignAgentScope } from "./design-agent-types"
export async function assertDesignAgentGrantActive(input: {
  userId: string
  grantId: string
  scope: DesignAgentScope
}) {
  await new DesignAgentGrantStore(getAdminDatabase()).requireActive(input, input.scope)
}
