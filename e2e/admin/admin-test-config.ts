import { readFileSync } from "node:fs"

import { adminFixturePorts } from "./admin-fixture-ports"

export function adminTestConfig() {
  const status = JSON.parse(readFileSync(".tmp/admin-e2e/status.json", "utf8")) as Record<string, string>
  const { apiPort, databasePort, serverPort } = adminFixturePorts()
  const api = new URL(status.API_URL!)
  const database = new URL(status.DB_URL!)
  if (
    api.origin !== `http://127.0.0.1:${apiPort}` ||
    database.hostname !== "127.0.0.1" ||
    database.port !== databasePort
  )
    throw new Error("Admin browser tests require the dedicated local Supabase fixture")
  return {
    serverPort,
    baseURL: `http://localhost:${serverPort}`,
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
