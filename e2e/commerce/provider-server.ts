import { assertIsolatedDatabase } from "../../test/assert-isolated-database"
import { setTimeout as pause } from "node:timers/promises"
import { readProviderDelay } from "./read-provider-delay"

import { randomUUID } from "node:crypto"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

import type Stripe from "stripe"
import { Pool } from "pg"

import { configuredStoreConfig } from "../../test/configured-store-config"
import { commerceTestConfig as config } from "./test-config"

if (process.env.COMMERCE_E2E !== "true") throw new Error("Commerce provider server is test-only")
assertIsolatedDatabase(config.databaseUrl, "store_catalog_e2e")

const pool = new Pool({ connectionString: config.databaseUrl })
const delayMs = readProviderDelay()
const sessions = new Map<string, { session: Stripe.Checkout.Session; lines: unknown[]; creates: number }>()
type ProviderOrder = {
  id: string
  status: string
  metadata: { shop_order_id: string }
  line_items: unknown[]
  address_to: unknown
  submissions: number
}
const orders = new Map<string, ProviderOrder>()
const failProduction = new Set<string>()
const confirmationEmails = new Map<string, { id: string; to: string[]; text: string }>()

async function body(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString()
}
function json(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, { "content-type": "application/json" })
  response.end(JSON.stringify(value))
}

async function handle(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url!, config.providerURL)
  const path = url.pathname
  if (delayMs && (path.startsWith("/v1/") || path === "/emails")) await pause(delayMs)
  if (path === "/health") return json(response, { ok: true })
  if (path === "/confirmation-emails" && request.method === "GET")
    return json(
      response,
      [...confirmationEmails.values()].filter((message) => message.to[0] === url.searchParams.get("recipient"))
    )
  if (path === "/emails" && request.method === "POST") {
    if (request.headers.authorization !== `Bearer ${config.resendKey}`)
      return json(response, { error: "Unexpected Resend credentials" }, 401)
    const message = JSON.parse(await body(request)) as { to: string[]; text: string }
    const key = request.headers["idempotency-key"]
    if (
      typeof key !== "string" ||
      !key.startsWith("signup-confirmation/") ||
      message.to.length !== 1 ||
      !/@example\.(com|test)$/.test(message.to[0]!)
    )
      return json(response, { error: "Unexpected confirmation message" }, 400)
    const existing = confirmationEmails.get(key)
    if (existing) return json(response, { id: existing.id })
    const id = `fixture-confirmation-${randomUUID()}`
    confirmationEmails.set(key, { id, ...message })
    return json(response, { id })
  }
  // Control endpoints are bound to loopback and never exist in the application.
  if (path.startsWith("/fixtures/")) {
    const id = path.split("/")[2]!
    const fixture = sessions.get(id)
    if (!fixture) return json(response, { error: "Unknown session" }, 404)
    if (request.method === "POST" && path.endsWith("/paid")) {
      fixture.session.status = "complete"
      fixture.session.payment_status = "paid"
    }
    if (request.method === "POST" && path.endsWith("/fail-production")) failProduction.add(id)
    return json(response, {
      session: fixture.session,
      lines: fixture.lines,
      creates: fixture.creates,
      orders: [...orders.values()].filter((order) => order.metadata.shop_order_id === id),
    })
  }
  if (path.startsWith("/v1/checkout/") || path.startsWith("/v1/payment_intents/")) {
    if (request.headers.authorization !== `Bearer ${config.stripeKey}`)
      return json(response, { error: { message: "Unexpected Stripe credentials" } }, 401)
    // Mirrors the pinned client version in src/features/checkout/get-commerce-services.server.ts; update both
    // during Stripe upgrades (docs/dependency-maintenance.md).
    if (request.headers["stripe-version"] !== "2026-09-30.endive")
      return json(response, { error: { message: "Unexpected Stripe API version" } }, 400)
    if (path === "/v1/checkout/sessions" && request.method === "POST") {
      const params = new URLSearchParams(await body(request))
      if ([...params.keys()].some((key) => key === "payment_method_types" || key.startsWith("payment_method_types[")))
        return json(response, { error: { message: "payment_method_types was removed in Endive" } }, 400)
      const requestId = params.get("client_reference_id")!
      const existing = [...sessions.values()].find((value) => value.session.client_reference_id === requestId)
      if (existing) {
        existing.creates += 1
        return json(response, existing.session)
      }
      const id = `cs_live_${requestId.replaceAll("-", "")}`
      const lines = []
      let subtotal = 0
      for (let i = 0; params.has(`line_items[${i}][quantity]`); i++) {
        const key = `line_items[${i}]`
        const quantity = Number(params.get(`${key}[quantity]`))
        const amount = Number(params.get(`${key}[price_data][unit_amount]`))
        subtotal += quantity * amount
        lines.push({
          quantity,
          currency: "usd",
          amount_subtotal: quantity * amount,
          price: {
            unit_amount: amount,
            product: {
              metadata: {
                product_id: params.get(`${key}[price_data][product_data][metadata][product_id]`),
                variant_id: params.get(`${key}[price_data][product_data][metadata][variant_id]`),
              },
            },
          },
        })
      }
      const shipping = Number(params.get("shipping_options[0][shipping_rate_data][fixed_amount][amount]"))
      const session = {
        id,
        created: Math.floor(Date.now() / 1000),
        mode: "payment",
        status: "open",
        payment_status: "unpaid",
        livemode: true,
        currency: "usd",
        client_reference_id: requestId,
        metadata: {
          storefront: configuredStoreConfig.commerce.identity,
          checkout_request_id: requestId,
          shop_id: "123",
        },
        expires_at: Number(params.get("expires_at")),
        url: `https://checkout.stripe.com/c/pay/${id}`,
        payment_intent: `pi_${requestId.replaceAll("-", "")}`,
        amount_subtotal: subtotal,
        amount_total: subtotal + shipping,
        total_details: { amount_tax: 0, amount_discount: 0, amount_shipping: shipping },
        shipping_cost: {
          amount_subtotal: shipping,
          amount_total: shipping,
          amount_tax: 0,
          shipping_rate: {
            id: "shr_fixture",
            type: "fixed_amount",
            fixed_amount: { amount: shipping, currency: "usd" },
            tax_behavior: "exclusive",
            metadata: { kind: "shipping", checkout_request_id: requestId },
          },
        },
        customer_details: { name: "Robin Shopper", email: "robin@example.com", phone: "+16125550101" },
        collected_information: {
          shipping_details: {
            name: "Robin Shopper",
            address: {
              country: "US",
              state: "MN",
              city: "Minneapolis",
              line1: "123 Test Street",
              line2: "",
              postal_code: "55401",
            },
          },
        },
      } as unknown as Stripe.Checkout.Session
      sessions.set(id, { session, lines, creates: 1 })
      return json(response, session)
    }
    const sessionId = path.split("/")[4]
    if (path.startsWith("/v1/checkout/sessions/")) {
      const fixture = sessions.get(sessionId!)
      if (!fixture) return json(response, { error: { message: "Unknown session" } }, 404)
      return json(response, path.endsWith("/line_items") ? { data: fixture.lines, has_more: false } : fixture.session)
    }
    const id = path.split("/")[3]
    const session = [...sessions.values()].find((value) => value.session.payment_intent === id)?.session
    if (!session) return json(response, { error: { message: "Unknown payment" } }, 404)
    return json(response, {
      id,
      status: "succeeded",
      livemode: true,
      currency: "usd",
      amount_received: session.amount_total,
      latest_charge: {
        payment_intent: id,
        livemode: true,
        created: session.created,
        currency: "usd",
        amount: session.amount_total,
        amount_captured: session.amount_total,
        captured: true,
        paid: true,
        refunded: false,
        amount_refunded: 0,
        disputed: false,
      },
    })
  }
  if (path.startsWith("/v1/shops/123/")) {
    if (request.headers.authorization !== `Bearer ${config.printifyToken}`)
      return json(response, { error: "Unexpected Printify credentials" }, 401)
    const product = path.match(/\/products\/([^/]+)\.json$/)
    if (product) {
      const { rows } = await pool.query(
        "select snapshot from commerce.printify_products where shop_id='123' and product_id=$1",
        [product[1]]
      )
      return json(response, rows[0]?.snapshot ?? {}, rows.length ? 200 : 404)
    }
    if (path === "/v1/shops/123/orders.json") {
      if (request.method === "POST") {
        const input = JSON.parse(await body(request)) as {
          external_id: string
          line_items: unknown[]
          address_to: unknown
        }
        const id = `printify-${randomUUID()}`
        const order = {
          id,
          status: "on-hold",
          metadata: { shop_order_id: input.external_id },
          line_items: input.line_items,
          address_to: input.address_to,
          submissions: 0,
        }
        orders.set(id, order)
        return json(response, { id })
      }
      return json(response, { current_page: 1, last_page: 1, data: [...orders.values()] })
    }
    const order = [...orders.values()].find((value) => path.includes(`/orders/${value.id}`))
    if (order) {
      if (path.endsWith("/send_to_production.json")) {
        order.submissions += 1
        // Simulate acceptance followed by a lost response, so replay must reconcile rather than print twice.
        order.status = "in-production"
        if (failProduction.delete(order.metadata.shop_order_id)) return json(response, { error: "Lost response" }, 503)
      }
      return json(response, order)
    }
  }
  return json(response, { error: `Unexpected fixture request: ${request.method} ${path}` }, 404)
}

const server = createServer((request, response) => {
  void handle(request, response).catch(() => json(response, { error: "Fixture request failed" }, 500))
})
server.listen(config.providerPort, "127.0.0.1")
process.on("SIGTERM", () => server.close(() => void pool.end()))
