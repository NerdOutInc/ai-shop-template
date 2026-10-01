import http from "node:http"
import https from "node:https"
import { syncBuiltinESMExports } from "node:module"

import { commerceTestConfig as config } from "./test-config"

if (
  process.env.COMMERCE_E2E !== "true" ||
  process.env.STRIPE_SECRET_KEY !== config.stripeKey ||
  process.env.PRINTIFY_API_TOKEN !== config.printifyToken ||
  process.env.RESEND_API_KEY !== config.resendKey
)
  throw new Error("Commerce provider routing requires explicit synthetic credentials")

// Stripe uses Node's HTTPS transport; Printify and Resend use fetch. All terminate on loopback.
https.request = ((options: https.RequestOptions, callback?: (response: http.IncomingMessage) => void) => {
  if (options.hostname === "api.stripe.com" || options.host === "api.stripe.com") {
    const request = http.request(
      {
        ...options,
        protocol: "http:",
        hostname: "127.0.0.1",
        host: "127.0.0.1",
        port: config.providerPort,
        agent: undefined,
      },
      callback
    )
    // The unchanged Stripe HTTPS client waits for secureConnect before writing its body.
    request.on("socket", (socket) => {
      if (socket.connecting) socket.once("connect", () => socket.emit("secureConnect"))
    })
    return request
  }
  throw new Error("External HTTPS blocked by commerce fixture")
}) as typeof https.request
syncBuiltinESMExports()

const originalFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input)
  if (url.origin === "https://api.resend.com") {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    if (headers.get("authorization") !== `Bearer ${config.resendKey}`) throw new Error("Unexpected Resend credentials")
    return originalFetch(new URL(url.pathname + url.search, config.providerURL), {
      ...init,
      headers,
      redirect: "error",
    })
  }
  if (url.origin === "https://api.printify.com") {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    if (headers.get("authorization") !== `Bearer ${config.printifyToken}`)
      throw new Error("Unexpected Printify credentials")
    return originalFetch(new URL(url.pathname + url.search, config.providerURL), {
      ...init,
      headers,
      redirect: "error",
    })
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error("External fetch blocked by commerce fixture")
  return originalFetch(input, init)
}
