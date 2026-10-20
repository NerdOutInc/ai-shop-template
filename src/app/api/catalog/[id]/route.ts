import { createAgentCatalogResponse } from "@/features/agent-catalog/create-agent-catalog-response.server"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return createAgentCatalogResponse(id)
}
