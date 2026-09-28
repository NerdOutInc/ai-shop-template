import { requestPrintifyOperation } from "./request-printify-operation"

type Subscription = { id: string; topic: string; url: string }

export async function readPrintifyWebhooks(config: { apiToken: string; shopId: string }): Promise<Subscription[]> {
  const subscriptions: Subscription[] = []
  const seen = new Set<string>()
  for (let page = 1; page <= 5; page++) {
    const raw = await requestPrintifyOperation(config, `webhooks.json?limit=100&page=${page}`)
    if (!Array.isArray(raw) || raw.length > 100) throw new Error("Webhook list is not complete")
    for (const value of raw) {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Unexpected webhook list")
      const entry = value as Record<string, unknown>
      if (
        typeof entry.id !== "string" ||
        typeof entry.topic !== "string" ||
        typeof entry.url !== "string" ||
        seen.has(entry.id)
      ) {
        throw new Error("Unexpected webhook list")
      }
      seen.add(entry.id)
      subscriptions.push({ id: entry.id, topic: entry.topic, url: entry.url })
    }
    if (raw.length < 100) return subscriptions
  }
  throw new Error("Webhook list exceeded the bounded scan")
}
