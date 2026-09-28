import { publishingTestConfig as config } from "./publishing-test-config"

if (
  process.env.PUBLISHING_E2E !== "true" ||
  process.env.PRINTIFY_API_TOKEN !== config.readToken ||
  process.env.PRINTIFY_PUBLISHING_API_TOKEN !== config.writeToken ||
  process.env.PRINTIFY_SHOP_ID !== config.shopId
)
  throw new Error("The publishing provider fixture requires explicit synthetic credentials")

const originalFetch = globalThis.fetch

// Only the dedicated test server loads this module. Partner requests terminate at our loopback stub.
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input)
  if (url.origin === "https://api.printify.com") {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    if (![config.readToken, config.writeToken].some((token) => headers.get("authorization") === `Bearer ${token}`))
      throw new Error("Unexpected provider credentials in publishing browser test")
    return originalFetch(new URL(url.pathname + url.search, config.providerURL), {
      ...init,
      headers,
      redirect: "error",
    })
  }
  if (url.origin === "https://images-api.printify.com" && url.pathname.startsWith("/mockup/"))
    return originalFetch(new URL(`/images${url.pathname}`, config.providerURL), { ...init, redirect: "error" })
  if (url.origin === `https://${config.blobHost}` && url.pathname.startsWith("/published-mockups/v1/"))
    return originalFetch(new URL(`/blob-content${url.pathname}`, config.providerURL), { ...init, redirect: "error" })
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error("External fetch blocked by publishing browser test")
  return originalFetch(input, init)
}
