import "server-only"

export type AdminLibraryFailureCode =
  "ADMIN_SETUP_STATUS_UNAVAILABLE" | "ADMIN_ACTOR_LOOKUP_FAILED" | "ADMIN_AUTH_ACTION_FAILED"

export type AdminLibraryFailureCause = "permission-denied" | "missing-relation" | "connection-failure" | "other"

// Socket, DNS and TLS failures surface before Postgres can assign a SQLSTATE, so they carry Node codes.
const networkCodes = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
])

function classifyFailure(error: unknown): AdminLibraryFailureCause {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined
  if (typeof code !== "string") return "other"
  if (code === "42501") return "permission-denied"
  if (code === "42P01" || code === "3F000" || code === "42703") return "missing-relation"
  // SQLSTATE classes 08 (connection exception) and 28 (rejected at connect), 57P0x (server not accepting
  // sessions) and 53300 (too many connections) all mean the session could not be established as configured.
  // pg's own connect and query timeouts carry no code and stay "other".
  if (/^(08|28|57P)/.test(code) || code === "53300" || networkCodes.has(code)) return "connection-failure"
  return "other"
}

export function logAdminLibraryFailure(code: AdminLibraryFailureCode, error: unknown) {
  // pg errors repeat the failing SQL and connection failures can quote the credentialed URL, so only the
  // fixed reason code and a coarse cause are recorded.
  console.error("Admin library unavailable", { code, cause: classifyFailure(error) })
}
