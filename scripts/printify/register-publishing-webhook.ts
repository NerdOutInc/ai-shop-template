import { readPrintifyWebhooks } from "./read-printify-webhooks"
import { requestPrintifyOperation } from "./request-printify-operation"

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === "--help") {
    console.log(
      "Inspect the publishing webhook. Default: dry-run. --apply creates one missing subscription and reads it back. Existing subscriptions are not changed; secret equality cannot be verified from readback."
    )
    return
  }
  if (args.some((arg) => arg !== "--apply") || args.length > 1) throw new Error("Invalid arguments")
  const apiToken = process.env.PRINTIFY_WEBHOOK_ADMIN_TOKEN
  const shopId = process.env.PRINTIFY_SHOP_ID
  const secret = process.env.PRINTIFY_WEBHOOK_SECRET
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  if (!apiToken || !shopId || !secret || !siteUrl) throw new Error("Missing webhook configuration")
  const origin = new URL(siteUrl)
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/"
  ) {
    throw new Error("A canonical HTTPS origin is required")
  }
  const topic = "product:publish:started"
  const url = new URL("/api/webhooks/printify", origin.origin).href
  const config = { apiToken, shopId }
  const existing = (await readPrintifyWebhooks(config)).filter((hook) => hook.topic === topic)
  if (existing.length > 0) {
    if (existing.length !== 1 || existing[0]?.url !== url) {
      console.log(
        JSON.stringify({
          state: "needs-review",
          shopId,
          existingWebhookIds: existing.map((hook) => hook.id),
          expectedUrl: url,
          changed: false,
        })
      )
      throw new Error("Conflicting publishing subscription")
    }
    console.log(
      JSON.stringify({
        state: "already-present",
        shopId,
        webhookId: existing[0].id,
        topic,
        url,
        changed: false,
        secretVerified: false,
      })
    )
    return
  }
  if (!args.includes("--apply")) {
    console.log(JSON.stringify({ state: "would-create", shopId, topic, url, changed: false, requiresApply: true }))
    return
  }
  let responseUncertain = false
  // This is the sole registration mutation. Never retry a lost POST response.
  try {
    await requestPrintifyOperation(config, "webhooks.json", { body: { topic, url, secret } })
  } catch {
    responseUncertain = true
  }
  const matching = (await readPrintifyWebhooks(config)).filter((hook) => hook.topic === topic)
  if (matching.length !== 1 || matching[0]?.url !== url) throw new Error("Webhook registration requires reconciliation")
  console.log(
    JSON.stringify({
      state: responseUncertain ? "present-after-uncertain-response" : "registered",
      shopId,
      webhookId: matching[0].id,
      topic,
      url,
      readbackVerified: true,
      secretVerified: false,
    })
  )
}

main().catch(() => {
  console.error(
    "Webhook registration needs review. Check required environment and existing subscriptions. A failed or uncertain create is never automatically retried; list the shop's webhooks before another --apply run."
  )
  process.exitCode = 1
})
