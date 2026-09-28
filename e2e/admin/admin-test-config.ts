import { readFileSync } from "node:fs"

export function adminTestConfig() {
  const status = JSON.parse(readFileSync(".tmp/admin-e2e/status.json", "utf8")) as Record<string, string>
  const api = new URL(status.API_URL!)
  const database = new URL(status.DB_URL!)
  if (api.origin !== "http://127.0.0.1:58831" || database.hostname !== "127.0.0.1" || database.port !== "58832")
    throw new Error("Admin browser tests require the dedicated local Supabase fixture")
  return {
    baseURL: "http://localhost:3300",
    publicSignup: status.TEST_PUBLIC_SIGNUP === "true",
    ownerEmail: "library-owner@example.test",
    setupSecret: "local-only-admin-owner-setup-proof-12345678",
    authURL: status.API_URL!,
    publishableKey: status.PUBLISHABLE_KEY!,
    secretKey: status.SECRET_KEY!,
    databaseUrl: status.DB_URL!,
    mailURL: status.MAILPIT_URL!,
  }
}
