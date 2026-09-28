import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { parseEnv } from "node:util"

const tokenKeys = ["PRINTIFY_API_TOKEN", "PRINTIFY_PUBLISHING_API_TOKEN", "PRINTIFY_DRAFTS_API_TOKEN"]
const shopsUrl = "https://api.printify.com/v1/shops.json"

export async function auditPrintifyShopScope(environment, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  const lines = []
  const shopId = environment.PRINTIFY_SHOP_ID
  if (typeof shopId !== "string" || !/^[1-9]\d*$/.test(shopId))
    return { exitCode: 1, lines: ["FAIL PRINTIFY_SHOP_ID: provide a positive numeric shop ID; values are hidden."] }

  const configuredKeys = tokenKeys.filter((key) => environment[key] !== undefined && environment[key] !== "")
  if (configuredKeys.length === 0)
    return { exitCode: 1, lines: ["FAIL No configured Printify token keys were supplied in the explicit file."] }

  let failed = false
  let unverified = false
  for (const key of configuredKeys) {
    const token = environment[key]
    if (
      typeof token !== "string" ||
      !token.trim() ||
      /[\r\n]/.test(token) ||
      /^\[(?:SENSITIVE|ENCRYPTED|REDACTED)\]$/i.test(token.trim())
    ) {
      failed = true
      lines.push(`FAIL ${key}: provide a literal single-line credential; values are hidden.`)
      continue
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let receivedResponse = false
    try {
      // Never follow a redirect with a credential or retry a denied request with broader scopes.
      const response = await fetchImpl(shopsUrl, {
        method: "GET",
        redirect: "error",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "User-Agent": "store-template-shop-scope-audit",
        },
      })
      receivedResponse = true
      if (response.status !== 200) {
        unverified = true
        const reason =
          response.status === 401
            ? "authentication rejected (HTTP 401)"
            : response.status === 403
              ? "shop listing denied (HTTP 403); existing permissions may omit shops.read"
              : `shop listing unavailable (HTTP ${response.status})`
        lines.push(`UNVERIFIED ${key}: ${reason}; shop visibility is unknown.`)
        await response.body?.cancel()
        continue
      }

      const shops = await response.json()
      if (!Array.isArray(shops) || !shops.every((shop) => shop && Number.isSafeInteger(shop.id) && shop.id > 0)) {
        unverified = true
        lines.push(`UNVERIFIED ${key}: malformed shop listing; response contents are hidden.`)
        continue
      }

      const ids = new Set(shops.map((shop) => String(shop.id)))
      if (!ids.has(shopId)) {
        failed = true
        lines.push(`FAIL ${key}: configured shop is absent from the listing; visible shops=${ids.size}.`)
      } else if (ids.size > 1) {
        lines.push(
          `WARN ${key}: configured shop is visible; visible shops=${ids.size}, other shops=${ids.size - 1}. Confirm the owner's shared-account exception.`
        )
      } else {
        lines.push(`PASS ${key}: configured shop is visible; visible shops=1, other shops=0.`)
      }
    } catch {
      unverified = true
      const reason = controller.signal.aborted
        ? "request timed out"
        : receivedResponse
          ? "shop listing could not be read"
          : "request failed"
      lines.push(`UNVERIFIED ${key}: ${reason}; error details are hidden.`)
    } finally {
      clearTimeout(timer)
    }
  }

  lines.push("Keep runtime token scopes unchanged; verify denied listings through the owner/account setup workflow.")
  lines.push("Shop visibility does not prove shop isolation, other permissions, publication or fulfillment.")
  return { exitCode: failed ? 1 : unverified ? 2 : 0, lines }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== "--env-file" || !args[1] || args[1].startsWith("--")) {
    console.error("Usage: node -- scripts/template/printify-shop-scope.mjs --env-file PATH")
    process.exitCode = 1
    return
  }
  let environment
  try {
    // Only literal file values participate; ambient credentials and .env.local are never merged.
    environment = parseEnv(readFileSync(args[1], "utf8"))
  } catch {
    console.error("FAIL The explicit environment file could not be read; values and path are hidden.")
    process.exitCode = 1
    return
  }
  const result = await auditPrintifyShopScope(environment)
  for (const line of result.lines) console.log(line)
  process.exitCode = result.exitCode
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
