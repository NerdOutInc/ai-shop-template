import { createAgentCatalogResponse } from "@/features/agent-catalog/create-agent-catalog-response.server"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export function GET() {
  return createAgentCatalogResponse()
}
