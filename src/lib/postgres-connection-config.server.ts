import "server-only"

import type { PoolConfig } from "pg"

export function postgresConnectionConfig(connectionString: string, certificate?: string): PoolConfig {
  const url = new URL(connectionString)
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  const modes = url.searchParams.getAll("sslmode")
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.port === "6543" ||
    url.searchParams.has("host") ||
    url.searchParams.has("port") ||
    (!loopback && (modes.length !== 1 || modes[0] !== "verify-full"))
  )
    throw new Error("A verified Postgres direct or session connection is required")

  if (!certificate || modes[0] !== "verify-full") return { connectionString }
  if (["sslcert", "sslkey", "sslrootcert"].some((key) => url.searchParams.has(key)))
    throw new Error("Configure the database CA through DATABASE_SSL_CA or the connection URL, not both")
  const negotiations = url.searchParams.getAll("sslnegotiation")
  const negotiation = url.searchParams.get("sslnegotiation")
  if (negotiations.length > 1 || (negotiation !== null && negotiation !== "postgres" && negotiation !== "direct"))
    throw new Error("Use a supported Postgres TLS negotiation mode")

  // pg replaces an explicit SSL object whenever the URL contains SSL options.
  // Validate verify-full first, then retain certificate and hostname verification here.
  for (const key of ["sslmode", "ssl", "uselibpqcompat", "sslnegotiation"]) url.searchParams.delete(key)
  return {
    connectionString: url.toString(),
    ssl: { ca: certificate, rejectUnauthorized: true },
    sslnegotiation: negotiation ?? undefined,
  }
}
