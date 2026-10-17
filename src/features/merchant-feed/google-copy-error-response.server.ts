import "server-only"

import { privateResponseHeaders } from "@/lib/private-response-headers"

const respond = (body: unknown, status: number) => Response.json(body, { status, headers: privateResponseHeaders })
const guardCodes = new Set([
  "GOOGLE_COPY_INVALID_TARGET",
  "GOOGLE_COPY_INVALID_RECORD",
  "GOOGLE_COPY_WRITE_BLOCKED",
  "GOOGLE_COPY_REVISION_CHANGED",
  "GOOGLE_COPY_INVALID_SNAPSHOT",
  "GOOGLE_COPY_UNSUPPORTED_BLUEPRINT",
  "GOOGLE_COPY_INVALID_SELECTION",
  "GOOGLE_COPY_METADATA_CONFLICT",
  "GOOGLE_COPY_INVALID_APPROVAL",
  "GOOGLE_COPY_ORIGIN_DOWNGRADE",
  "GOOGLE_COPY_PROVENANCE_INCOMPLETE",
])
export function googleCopyErrorResponse(error: unknown) {
  if (error instanceof Error && guardCodes.has(error.message))
    return respond(
      { code: error.message, error: "Copy request refused. Read the saved state and make a fresh preview." },
      409
    )
  return respond(
    { code: "GOOGLE_COPY_UNKNOWN", error: "Outcome unknown. Read the saved state before deciding what to do next." },
    503
  )
}
