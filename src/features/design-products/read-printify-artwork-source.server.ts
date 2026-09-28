import "server-only"

import { DesignDraftError } from "./design-draft-error"
import { readDesignAssetBytes } from "./read-design-asset-bytes.server"

/** Unknown source hosts stay unverified; never turn a provider response into an arbitrary URL proxy. */
export async function readPrintifyArtworkSource(
  src: string,
  request: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<Buffer> {
  let url: URL
  try {
    url = new URL(src)
  } catch {
    throw new DesignDraftError("CONFLICT", "Printify artwork source requires manual verification")
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !(
      url.hostname === "printify.com" ||
      url.hostname.endsWith(".printify.com") ||
      url.hostname === "pfy-prod-image-storage.s3.us-east-2.amazonaws.com"
    )
  )
    throw new DesignDraftError("CONFLICT", "Printify artwork source host requires manual verification")
  const deadline = signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000)
  const response = await request(url, { cache: "no-store", redirect: "error", signal: deadline })
  if (!response.ok || !response.body)
    throw new DesignDraftError("PROVIDER_UNAVAILABLE", "Printify artwork source could not be retrieved")
  return readDesignAssetBytes(response.body, deadline)
}
