// Test-only network tripwire: public pages must render from their seeded database.
if (process.env.PRINTIFY_API_TOKEN !== "e2e-fixture-token")
  throw new Error("This tripwire requires the explicit fixture token")
const originalFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input)
  if (url.hostname === "api.printify.com") throw new Error("Unexpected Printify API call during a page load")
  return originalFetch(input, init)
}
