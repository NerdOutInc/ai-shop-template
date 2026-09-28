import { describe, expect, it, vi } from "vitest"
import { logAdminLibraryFailure } from "./log-admin-library-failure.server"

vi.mock("server-only", () => ({}))

// Mirror pg's DatabaseError, whose message, detail and internal query all repeat private SQL.
function databaseError(code: unknown) {
  return Object.assign(new Error("permission denied for schema private"), {
    code,
    detail: "select consumed_at from private.admin_setup_state",
    internalQuery: "select exists(select 1 from public.admin_memberships where active)",
  })
}

describe("Admin library failure diagnostics", () => {
  it.each([
    ["42501", "permission-denied"],
    ["42P01", "missing-relation"],
    ["3F000", "missing-relation"],
    ["08006", "connection-failure"],
    ["08001", "connection-failure"],
    ["28P01", "connection-failure"],
    ["57P03", "connection-failure"],
    ["53300", "connection-failure"],
    ["ECONNREFUSED", "connection-failure"],
    ["ENOTFOUND", "connection-failure"],
    ["ETIMEDOUT", "connection-failure"],
    ["CERT_HAS_EXPIRED", "connection-failure"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "connection-failure"],
    ["42703", "missing-relation"],
    ["57014", "other"],
    ["23505", "other"],
    ["ENOENT", "other"],
  ])("classifies code %s as %s", (code, cause) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    logAdminLibraryFailure("ADMIN_SETUP_STATUS_UNAVAILABLE", databaseError(code))
    expect(log.mock.calls).toEqual([["Admin library unavailable", { code: "ADMIN_SETUP_STATUS_UNAVAILABLE", cause }]])
  })

  it("treats errors without a string code and non-error values as other", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    for (const error of [new Error("timeout exceeded when trying to connect"), databaseError(42501), "offline", null])
      logAdminLibraryFailure("ADMIN_ACTOR_LOOKUP_FAILED", error)
    expect(log.mock.calls).toEqual(
      Array(4).fill(["Admin library unavailable", { code: "ADMIN_ACTOR_LOOKUP_FAILED", cause: "other" }])
    )
  })

  it("records only the fixed reason code and coarse cause, never messages, SQL or credentials", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const error = Object.assign(
      new Error("connect ECONNREFUSED postgres://store_app_runtime:private-password@db.example.test:5432/postgres"),
      { code: "ECONNREFUSED", address: "db.example.test", port: 5432 }
    )
    logAdminLibraryFailure("ADMIN_ACTOR_LOOKUP_FAILED", error)
    logAdminLibraryFailure("ADMIN_SETUP_STATUS_UNAVAILABLE", databaseError("42501"))
    expect(log.mock.calls).toEqual([
      ["Admin library unavailable", { code: "ADMIN_ACTOR_LOOKUP_FAILED", cause: "connection-failure" }],
      ["Admin library unavailable", { code: "ADMIN_SETUP_STATUS_UNAVAILABLE", cause: "permission-denied" }],
    ])
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|postgres|select|store_app_runtime|example\.test/)
  })
})
