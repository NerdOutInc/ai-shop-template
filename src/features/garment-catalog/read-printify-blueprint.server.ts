import "server-only"

import { z } from "zod"

import { env } from "@/lib/env"

import { GarmentSetupError } from "./garment-setup-error"

export type PrintifyBlueprint = { id: number; title: string; brand: string; model: string }

// A projection, not the provider's shape: the description and images are Printify's HTML and URLs,
// which garment setup has no use for. Extra attributes are tolerated so a new provider field cannot
// break the lookup. A missing brand or model falls back to "" because the lookup only pre-fills a
// form the owner can always type into; a blueprint with no title is not one we can vouch for.
const blueprintSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(200).catch(""),
  model: z.string().trim().max(200).catch(""),
})

/**
 * Looks one blueprint up in Printify's catalog so the owner does not have to retype "Next Level"
 * and "6210". Best-effort by design: typing the name by hand always works, and nothing may call
 * this during a render. The public browser suite throws on any api.printify.com request, and a
 * page that needs Printify to draw is a page Printify can take down.
 *
 * A standalone function in the fetchCatalogStock style rather than a method on the design-draft
 * client, whose shared request helper answers in draft-reconciliation copy. It reads with
 * PRINTIFY_DRAFTS_API_TOKEN because that is the only token documented with `catalog.read`
 * (docs/store-setup.md); the fulfillment token is deliberately never widened.
 *
 * The address is built here from an integer, never taken from what the owner pasted. Null means
 * Printify has no such blueprint. Everything else throws a GarmentSetupError.
 */
export async function readPrintifyBlueprint(
  blueprintId: number,
  options: { apiToken?: string; request?: typeof fetch; signal?: AbortSignal } = {}
): Promise<PrintifyBlueprint | null> {
  // The route checks its path segment first. Checked again here because this number becomes part
  // of a URL carrying a credential, and no blueprint has a number outside this range anyway.
  if (!Number.isSafeInteger(blueprintId) || blueprintId < 1 || blueprintId > 999_999_999) return null
  const token = options.apiToken ?? env.PRINTIFY_DRAFTS_API_TOKEN
  if (!token?.trim() || /[\r\n]/.test(token))
    throw new GarmentSetupError("NOT_CONFIGURED", "The Printify drafts token is not configured for catalog lookups")
  try {
    const response = await (options.request ?? fetch)(
      `https://api.printify.com/v1/catalog/blueprints/${blueprintId}.json`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, "User-Agent": "Clothing-Store/0.1", Accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        signal: options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(10_000)])
          : AbortSignal.timeout(10_000),
      }
    )
    if (response.status === 404) return null
    // By status alone. Printify's error bodies can echo the request, so they are never read.
    if (response.status === 401 || response.status === 403)
      throw new GarmentSetupError(
        "PROVIDER_REJECTED",
        "Printify refused the catalog lookup; the drafts token needs the catalog.read scope"
      )
    if (!response.ok) throw new Error("Provider request failed")
    const blueprint = blueprintSchema.safeParse(await response.json())
    // An answer about some other blueprint would pre-fill the wrong garment's name.
    if (!blueprint.success || blueprint.data.id !== blueprintId) throw new Error("Unverifiable blueprint")
    return blueprint.data
  } catch (error) {
    if (error instanceof GarmentSetupError) throw error
    // Transport errors and provider bodies can carry the token or request details; keep only a code.
    throw new GarmentSetupError("PROVIDER_UNAVAILABLE", "Printify's catalog did not return a verifiable answer")
  }
}
