import { z } from "zod"

import { getDropSignupStore } from "@/features/drop-signup/get-drop-signup-store.server"
import { privateResponseHeaders } from "@/lib/private-response-headers"

export const dynamic = "force-dynamic"

const subscriberToken = z.uuid()

/**
 * Both ways out of the drop list: a mail app's one-click unsubscribe (RFC 8058) and the button on
 * /unsubscribe/<token>.
 *
 * No same-origin check, on purpose. A one-click POST comes from the mail provider's servers with no
 * Origin at all, and it has to work. The subscriber id in the path is the whole credential, so a forged
 * request can only do what that link's owner could already do. Only POST acts: a mail scanner that
 * opens every link in a message sends GETs, and a GET here is a 405.
 */
export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const token = subscriberToken.safeParse((await context.params).token)
  if (!token.success)
    return Response.json(
      { error: "That unsubscribe link isn't one of ours." },
      { status: 404, headers: privateResponseHeaders }
    )
  try {
    await getDropSignupStore().unsubscribe(token.data)
  } catch {
    console.warn("Drop unsubscribe unavailable", { reason: "storage" })
    return Response.json(
      { error: "That didn't go through. Try again in a moment." },
      { status: 503, headers: privateResponseHeaders }
    )
  }
  // A browser without JavaScript submitted the page's form. Back on the page, the list says it's done.
  if (request.headers.get("sec-fetch-mode") === "navigate")
    return new Response(null, {
      status: 303,
      headers: { ...privateResponseHeaders, Location: `/unsubscribe/${token.data}` },
    })
  // The same answer whether or not the id matched anyone, so the endpoint cannot be used to test ids.
  return Response.json({ unsubscribed: true }, { headers: privateResponseHeaders })
}
