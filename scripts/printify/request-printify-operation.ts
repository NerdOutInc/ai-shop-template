export async function requestPrintifyOperation(
  config: { apiToken: string; shopId: string },
  resource: string,
  options: { body?: { topic: string; url: string; secret: string }; timeoutMs?: number } = {}
): Promise<unknown> {
  if (
    !config.apiToken.trim() ||
    /[\r\n]/.test(config.apiToken) ||
    !/^[1-9]\d*$/.test(config.shopId) ||
    !/^(webhooks|products)\.json(?:\?limit=\d+&page=\d+)?$/.test(resource) ||
    (options.body && resource !== "webhooks.json")
  ) {
    throw new Error("Invalid Printify operation configuration")
  }
  const response = await fetch(`https://api.printify.com/v1/shops/${config.shopId}/${resource}`, {
    method: options.body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      "User-Agent": "Your-Store-Publishing-Operations/1.0",
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, options.timeoutMs ?? 10_000))),
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error("Printify operation was not accepted")
  }
  return (await response.json()) as unknown
}
