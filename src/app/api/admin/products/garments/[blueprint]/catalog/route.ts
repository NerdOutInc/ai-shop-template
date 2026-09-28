import { getAdminActor } from "@/features/admin/get-admin-actor.server"
import { GarmentSetupError } from "@/features/garment-catalog/garment-setup-error"
import { readPrintifyBlueprint } from "@/features/garment-catalog/read-printify-blueprint.server"
import { privateResponseHeaders } from "@/lib/private-response-headers"

// The handler talks to Printify.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * What Printify calls this blueprint, so the owner does not have to retype "Next Level" and "6210".
 * Reads only, and writes nothing here or at Printify, so there is nothing to revalidate.
 *
 * No Origin check, deliberately: browsers omit the Origin header on a same-origin GET and
 * hasSameOrigin compares that header literally, so the guard would refuse the real admin page. The
 * administrator session is the boundary, as it is for the draft review GET.
 *
 * Fetch Metadata is honoured instead, because unlike that GET this one needs nothing an outsider
 * cannot guess. The session cookie is SameSite=Lax, so a foreign page that opens this address in a
 * popup sends it, and every integer it tries is a Printify call on the drafts token's rate limit.
 * Browsers send Sec-Fetch-Site on every request and a page cannot forge it: the form's fetch says
 * "same-origin" and a typed address says "none". An absent header is an agent or an old browser,
 * neither of which a foreign page can steer, and the session still stands in front of them.
 *
 * The path is a blueprint NUMBER and the address is built from it server-side. This route must never
 * grow a `url` parameter: fetching what the owner pasted is how a lookup becomes a request forger.
 */
export async function GET(request: Request, context: { params: Promise<{ blueprint: string }> }) {
  const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: privateResponseHeaders })
  const site = request.headers.get("sec-fetch-site")
  if (site !== null && site !== "same-origin" && site !== "none")
    return respond({ error: "Use the Garment models page to look a garment up." }, 403)
  const actor = await getAdminActor()
  if (!actor) return respond({ error: "Sign in as an administrator." }, 401)
  const { blueprint } = await context.params
  if (!/^[1-9]\d{0,8}$/.test(blueprint)) return respond({ error: "Garment not found." }, 404)
  try {
    const found = await readPrintifyBlueprint(Number(blueprint), { signal: request.signal })
    if (!found) return respond({ error: "Printify has no garment with that number." }, 404)
    return respond({ blueprintId: found.id, title: found.title, manufacturer: found.brand, model: found.model })
  } catch (error) {
    const code = error instanceof GarmentSetupError ? error.code : "UNEXPECTED"
    // A closed tab aborts request.signal, and the reader reports that abort as PROVIDER_UNAVAILABLE
    // like any other transport failure. That is the owner leaving, not Printify failing, so it is
    // kept out of the log an outage is read from. The reader's own ten-second limit never touches
    // this signal, and a missing or refused token is worth hearing about whoever is still listening.
    // A code and never the error itself: a transport failure can carry the request, token included.
    if (!(request.signal.aborted && code === "PROVIDER_UNAVAILABLE"))
      console.warn("Printify blueprint lookup failed", { code })
    // One answer for a missing token, a refused token and an outage. The owner's next step is the
    // same for all three, and typing the name by hand always works.
    return respond(
      { error: "Printify's catalog is not answering. Type the garment's name yourself, or try again shortly." },
      503
    )
  }
}
