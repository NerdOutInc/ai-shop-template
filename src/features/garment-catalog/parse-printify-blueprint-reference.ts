export type PrintifyBlueprintReference =
  | { ok: true; blueprintId: number }
  | { ok: false; reason: "empty" | "product-link" | "not-printify" | "not-a-catalog-page" | "invalid-id" }

// Nine digits at most keeps the number inside the integer column on commerce.garment_models.
const blueprintNumber = /^[1-9]\d{0,8}$/

/**
 * Reads the blueprint number out of what the owner pasted: the number itself, or the address of a
 * garment's page in Printify's catalog (`https://printify.com/app/products/1317/next-level/...`).
 *
 * It only ever extracts an integer. Nothing here or downstream fetches the pasted address: the
 * server builds its own api.printify.com URL from the number, so a hostile link can at worst be
 * refused. The host is still pinned, because a number lifted from somebody else's page would name
 * a garment the owner never looked at.
 *
 * The number must be the WHOLE path segment. Printify product ids are 24 hex characters that often
 * start with digits (`6a9f3b12...`), so a `parseInt` here would turn a pasted product link into
 * blueprint 6. Product links get their own reason so the page can say "that is one of your
 * products, not a garment" instead of a shrug.
 *
 * Shared by the add-garment form and the server, so it must stay free of `server-only` imports.
 */
export function parsePrintifyBlueprintReference(input: unknown): PrintifyBlueprintReference {
  const text = typeof input === "string" ? input.trim() : ""
  if (!text) return { ok: false, reason: "empty" }
  if (text.length > 2048) return { ok: false, reason: "not-printify" }
  if (blueprintNumber.test(text)) return { ok: true, blueprintId: Number(text) }
  // No slash, colon or domain ending: it was meant as a number ("01317", "1e3", "-5") and is not one.
  if (!/[/\\:]/.test(text) && !/\.[a-z]{2,}/i.test(text)) return { ok: false, reason: "invalid-id" }

  // The address bar hides the scheme, so a copied link often arrives without one.
  const address = /^(?:www\.)?printify\.com(?:[/?#]|$)/i.test(text) ? `https://${text}` : text
  // Checked in the text as well as in the parsed URL, because the URL parser forgives more than a
  // pasted catalog link ever needs: it drops https's own port, reads "https:printify.com" as a
  // host, and removes tabs and line breaks from the middle of an address.
  if (/\p{Cc}/u.test(address) || !/^https:\/\/[^/?#\\:@]+(?:[/?#\\]|$)/i.test(address))
    return { ok: false, reason: "not-printify" }
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return { ok: false, reason: "not-printify" }
  }
  if (
    url.protocol !== "https:" ||
    (url.hostname !== "printify.com" && url.hostname !== "www.printify.com") ||
    url.username ||
    url.password ||
    url.port
  )
    return { ok: false, reason: "not-printify" }

  if (/^\/app\/(?:product-details|store\/products)(?:\/|$)/.test(url.pathname))
    return { ok: false, reason: "product-link" }
  const segment = /^\/app\/products\/([^/]+)(?:\/.*)?$/.exec(url.pathname)?.[1]
  if (!segment) return { ok: false, reason: "not-a-catalog-page" }
  if (!blueprintNumber.test(segment)) return { ok: false, reason: "invalid-id" }
  return { ok: true, blueprintId: Number(segment) }
}
