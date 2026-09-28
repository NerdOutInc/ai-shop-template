// @vitest-environment node
import { readFileSync } from "node:fs"
import { createServer, type Socket } from "node:net"
import { createSecureContext, TLSSocket } from "node:tls"

import { Client } from "pg"
import { describe, expect, it, vi } from "vitest"

import { postgresConnectionConfig } from "./postgres-connection-config.server"

vi.mock("server-only", () => ({}))

const certificate = readFileSync("test/tls/localhost-cert.pem", "utf8")
const remote = "postgresql://user:password@db.example.com:5432/postgres"

describe("Postgres TLS configuration", () => {
  it.each([
    "",
    "?sslmode=disable",
    "?sslmode=no-verify",
    "?sslmode=require",
    "?sslmode=verify-ca",
    "?sslmode=verify-full&sslmode=disable",
    "?sslmode=verify-full&port=6543",
    "?sslmode=verify-full&host=elsewhere.example.com",
  ])("a custom CA does not bypass remote transport validation: %s", (query) => {
    expect(() => postgresConnectionConfig(`${remote}${query}`, certificate)).toThrow()
  })

  it("preserves the existing unencrypted local development connection", () => {
    const local = "postgresql://postgres@127.0.0.1:5432/test"
    expect(postgresConnectionConfig(local, certificate)).toEqual({ connectionString: local })
  })

  it("keeps URL credentials and non-TLS options while removing parser overrides", () => {
    const config = postgresConnectionConfig(
      `${remote}?sslmode=verify-full&ssl=false&uselibpqcompat=true&application_name=publishing`,
      certificate
    )
    const client = new Client(config)
    expect(client.host).toBe("db.example.com")
    expect(client.user).toBe("user")
    expect(client.database).toBe("postgres")
    expect(client.ssl).toEqual({ ca: certificate, rejectUnauthorized: true })
    expect(new URL(config.connectionString!).searchParams.get("application_name")).toBe("publishing")
  })

  it.each(["sslrootcert", "sslcert", "sslkey"])("rejects conflicting %s file configuration", (key) => {
    expect(() => postgresConnectionConfig(`${remote}?sslmode=verify-full&${key}=/unused.pem`, certificate)).toThrow(
      "Configure the database CA"
    )
  })

  it.each(["postgres", "direct"])("retains the CA when using %s TLS negotiation", (negotiation) => {
    const config = postgresConnectionConfig(`${remote}?sslmode=verify-full&sslnegotiation=${negotiation}`, certificate)
    expect(new Client(config).ssl).toEqual({ ca: certificate, rejectUnauthorized: true })
    expect(config.sslnegotiation).toBe(negotiation)
    expect(new URL(config.connectionString!).searchParams.has("sslnegotiation")).toBe(false)
  })

  it.each(["unknown", "direct&sslnegotiation=postgres"])("rejects ambiguous TLS negotiation: %s", (negotiation) => {
    expect(() =>
      postgresConnectionConfig(`${remote}?sslmode=verify-full&sslnegotiation=${negotiation}`, certificate)
    ).toThrow("Use a supported Postgres TLS negotiation mode")
  })

  it("connects through pg with a trusted private CA and hostname verification", async () => {
    await withTlsServer("localhost", async (connectionString) => {
      const client = new Client({
        ...postgresConnectionConfig(connectionString, certificate),
        connectionTimeoutMillis: 2000,
      })
      try {
        await client.connect()
        const socket = (client as unknown as { connection: { stream: TLSSocket } }).connection.stream
        expect(socket.encrypted).toBe(true)
        expect(socket.authorized).toBe(true)
      } finally {
        await client.end()
      }
    })
  })

  it("rejects an untrusted private CA", async () => {
    await withTlsServer("localhost", async (connectionString) => {
      const client = new Client({ ...postgresConnectionConfig(connectionString), connectionTimeoutMillis: 2000 })
      try {
        await expect(client.connect()).rejects.toMatchObject({ code: "DEPTH_ZERO_SELF_SIGNED_CERT" })
      } finally {
        await client.end()
      }
    })
  })

  it("rejects a trusted certificate for a different hostname", async () => {
    await withTlsServer("wrong-host", async (connectionString) => {
      const ca = readFileSync("test/tls/wrong-host-cert.pem", "utf8")
      const client = new Client({ ...postgresConnectionConfig(connectionString, ca), connectionTimeoutMillis: 2000 })
      try {
        await expect(client.connect()).rejects.toMatchObject({ code: "ERR_TLS_CERT_ALTNAME_INVALID" })
      } finally {
        await client.end()
      }
    })
  })
})

async function withTlsServer(name: string, check: (connectionString: string) => Promise<void>) {
  const context = createSecureContext({
    cert: readFileSync(`test/tls/${name}-cert.pem`),
    key: readFileSync(`test/tls/${name}-key.pem`),
  })
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
    socket.on("error", () => undefined)
    socket.once("data", (request) => {
      if (typeof request === "string" || !request.equals(Buffer.from([0, 0, 0, 8, 4, 210, 22, 47])))
        return socket.destroy()
      socket.write("S")
      const secure = new TLSSocket(socket, { isServer: true, secureContext: context })
      secure.on("error", () => undefined)
      secure.once("data", () => {
        // Minimal PostgreSQL startup: AuthenticationOk, then ReadyForQuery.
        secure.write(Buffer.from([82, 0, 0, 0, 8, 0, 0, 0, 0, 90, 0, 0, 0, 5, 73]))
      })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "localhost", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("TLS fixture did not start")
  try {
    await check(`postgresql://test@localhost:${address.port}/test?sslmode=verify-full`)
  } finally {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
}
