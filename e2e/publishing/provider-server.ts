import { createServer } from "node:http"

import { z } from "zod"

import { createPublishingImage } from "./create-publishing-image"
import { publishingTestConfig as config } from "./publishing-test-config"

if (process.env.PUBLISHING_E2E !== "true") throw new Error("This provider is only for publishing browser tests")

const productSchema = z
  .object({ id: z.string().regex(/^[a-f0-9]{24}$/), shop_id: z.literal(Number(config.shopId)) })
  .passthrough()
let product: Record<string, unknown> | null = null
let failingReads = false
let apiReads: string[] = []
let callbacks: { action: string; body: unknown }[] = []
let unexpected: string[] = []
let imageOutage: string | null = null
let imageReads: string[] = []
let imageUploads: string[] = []
let imagePutAttempts: string[] = []
const blobs = new Map<string, Buffer>()

const server = createServer(async (request, response) => {
  const send = (body: unknown, status = 200) => {
    response.writeHead(status, { "content-type": "application/json" })
    response.end(JSON.stringify(body))
  }
  try {
    const url = new URL(request.url ?? "/", config.providerURL)
    if (url.pathname === "/health") return send({ ready: true })
    if (request.method === "GET" && url.pathname.startsWith("/images/mockup/")) {
      const pathname = url.pathname.slice("/images".length)
      imageReads.push(pathname)
      if (imageOutage === pathname) return send({ error: "Synthetic image outage" }, 503)
      response.writeHead(200, { "content-type": "image/png" })
      return response.end(await createPublishingImage(pathname))
    }
    if (request.method === "GET" && url.pathname.startsWith("/blob-content/published-mockups/v1/")) {
      const bytes = blobs.get(url.pathname.slice("/blob-content/".length))
      if (!bytes) return send({ error: "Unknown image" }, 404)
      response.writeHead(200, { "content-type": "image/png", "content-length": bytes.length })
      return response.end(bytes)
    }
    if (url.pathname === "/blob" || url.pathname === "/blob/") {
      if (request.headers.authorization !== `Bearer ${config.blobToken}`)
        return send({ error: { code: "forbidden", message: "Unexpected fixture credentials" } }, 403)
      const pathname = url.searchParams.get(request.method === "PUT" ? "pathname" : "url")
      if (!pathname || !/^published-mockups\/v1\/[a-f0-9]{64}\.png$/.test(pathname))
        return send({ error: { code: "bad_request", message: "Unexpected fixture pathname" } }, 400)
      if (request.method === "PUT") {
        imagePutAttempts.push(pathname)
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        if (blobs.has(pathname)) return send({ error: { code: "bad_request", message: "Already exists" } }, 409)
        blobs.set(pathname, Buffer.concat(chunks))
        imageUploads.push(pathname)
      }
      const bytes = blobs.get(pathname)
      if (!bytes) return send({ error: { code: "not_found", message: "Unknown image" } }, 404)
      return send({
        url: `https://${config.blobHost}/${pathname}`,
        downloadUrl: `https://${config.blobHost}/${pathname}`,
        pathname,
        size: bytes.length,
        contentType: "image/png",
        uploadedAt: new Date().toISOString(),
        etag: "synthetic-etag",
      })
    }
    let text = ""
    for await (const chunk of request) {
      text += String(chunk)
      if (text.length > 128 * 1024) return send({ error: "Body too large" }, 413)
    }
    const body: unknown = text ? JSON.parse(text) : null
    if (url.pathname.startsWith("/control/")) {
      if (request.headers.authorization !== `Bearer ${config.cronSecret}`) return send({ error: "Unauthorized" }, 401)
      if (request.method === "GET" && url.pathname === "/control/state")
        return send({ product, callbacks, unexpected, imageReads, imageUploads, imagePutAttempts, apiReads })
      if (request.method === "POST" && ["/control/reset", "/control/product"].includes(url.pathname)) {
        product = productSchema.parse(body)
        if (url.pathname === "/control/reset") {
          failingReads = false
          apiReads = []
          callbacks = []
          unexpected = []
          imageOutage = null
          imageReads = []
          imageUploads = []
          imagePutAttempts = []
          blobs.clear()
        }
        return send({ saved: true })
      }
      if (request.method === "POST" && url.pathname === "/control/outage") {
        failingReads = z.object({ enabled: z.boolean() }).parse(body).enabled
        return send({ saved: true })
      }
      if (request.method === "POST" && url.pathname === "/control/image-outage") {
        imageOutage = z.object({ pathname: z.string().nullable() }).parse(body).pathname
        return send({ saved: true })
      }
      return send({ error: "Unknown control" }, 404)
    }
    const auth = request.headers.authorization
    if (![config.readToken, config.writeToken].some((token) => auth === `Bearer ${token}`))
      return send({ error: "Unexpected credentials" }, 401)
    if (request.method === "GET") apiReads.push(url.pathname)
    if (request.method === "GET" && url.pathname === `/v1/shops/${config.shopId}/products.json`)
      return failingReads
        ? send({ error: "Synthetic provider outage" }, 503)
        : send({ data: product ? [product] : [], current_page: 1, last_page: 1, total: product ? 1 : 0 })
    const match = url.pathname.match(
      new RegExp(`^/v1/shops/${config.shopId}/products/([a-f0-9]{24})(?:/([a-z_]+))?\\.json$`)
    )
    if (match && product && product.id === match[1]) {
      const action = match[2]
      if (request.method === "GET" && !action)
        return failingReads ? send({ error: "Synthetic provider outage" }, 503) : send(product)
      if (
        request.method === "POST" &&
        action &&
        ["publishing_succeeded", "publishing_failed", "unpublish"].includes(action) &&
        auth === `Bearer ${config.writeToken}`
      ) {
        callbacks.push({ action, body })
        product.is_locked = false
        if (action === "publishing_succeeded") {
          product.external = z.object({ external: z.unknown() }).parse(body).external
        }
        if (action === "unpublish") product.visible = false
        return send({})
      }
    }
    if (request.method === "GET" && url.pathname === `/v1/shops/${config.shopId}/orders.json`)
      return send({ data: [], current_page: 1, last_page: 1, total: 0 })
    if (request.method === "POST" && url.pathname === `/v1/shops/${config.shopId}/orders/shipping.json`)
      return send({ standard: 500 })
    unexpected.push(`${request.method} ${url.pathname}`)
    send({ error: "Unexpected provider operation" }, 501)
  } catch {
    send({ error: "Invalid fixture request" }, 400)
  }
})

server.listen(config.providerPort, "127.0.0.1")
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => process.exit(0)))
