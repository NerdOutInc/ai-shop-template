import { getDesignAgentCommandScope } from "@/features/design-agent/get-design-agent-command-scope"
import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { env } from "@/lib/env"
import { getAdminDatabase } from "@/features/admin/get-admin-database.server"
import { getDesignAgentActor } from "@/features/design-agent/get-design-agent-actor.server"
import { parseDesignAgentCommand } from "@/features/design-agent/parse-design-agent-command"
import { executeDesignAgentCommand } from "@/features/design-agent/execute-design-agent-command.server"
import { DesignAgentError } from "@/features/design-agent/design-agent-error"
import { DesignDraftError } from "@/features/design-products/design-draft-error"
import { LibraryError } from "@/features/design-library/library-error"
import { privateResponseHeaders } from "@/lib/private-response-headers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60
const headers = privateResponseHeaders
export async function POST(request: Request) {
  if (!env.ADMIN_LIBRARY_ENABLED) return NextResponse.json({ error: "Not found" }, { status: 404, headers })
  // A bearer token alone authorizes this API; cookie sessions never silently substitute for a grant.
  if (!/^Bearer \S+$/.test(request.headers.get("authorization") ?? ""))
    return NextResponse.json({ error: "A current scoped agent grant is required" }, { status: 401, headers })
  try {
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      return NextResponse.json({ error: "JSON required" }, { status: 415, headers })
    const reader = request.body?.getReader()
    if (!reader) throw new SyntaxError("Missing body")
    const chunks: Uint8Array[] = []
    let bytes = 0
    try {
      for (;;) {
        const result = await reader.read()
        if (result.done) break
        bytes += result.value.byteLength
        if (bytes > 512 * 1024) {
          await reader.cancel()
          return NextResponse.json({ error: "Command exceeds 512 KiB" }, { status: 413, headers })
        }
        chunks.push(result.value)
      }
    } finally {
      reader.releaseLock()
    }
    const command = parseDesignAgentCommand(JSON.parse(Buffer.concat(chunks).toString("utf8")))
    const actor = await getDesignAgentActor(request, getDesignAgentCommandScope(command.command))
    if (!actor)
      return NextResponse.json({ error: "A current scoped agent grant is required" }, { status: 401, headers })
    const result = await executeDesignAgentCommand(getAdminDatabase(), actor, command, { signal: request.signal })
    return NextResponse.json({ result }, { headers })
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError)
      return NextResponse.json({ error: "Invalid command input" }, { status: 400, headers })
    if (error instanceof DesignAgentError || error instanceof LibraryError || error instanceof DesignDraftError) {
      const status =
        error.code === "FORBIDDEN"
          ? 403
          : error.code === "NOT_FOUND"
            ? 404
            : error.code === "CONFLICT"
              ? 409
              : error.code === "PROVIDER_UNAVAILABLE"
                ? 503
                : 400
      return NextResponse.json({ error: error.message, code: error.code }, { status, headers })
    }
    return NextResponse.json(
      { error: "Operation is incomplete. Resume the same request after checking service availability." },
      { status: 503, headers }
    )
  }
}
