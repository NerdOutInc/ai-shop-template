import { randomUUID } from "node:crypto"

import { getAdminActor } from "@/features/admin/get-admin-actor.server"
import { dropEmailPreviewToken } from "@/features/drop-emails/drop-email-preview-token"
import { personalizeDropEmail } from "@/features/drop-emails/personalize-drop-email"
import { readDropEmailSetup } from "@/features/drop-emails/read-drop-email-setup.server"
import { renderNextDropEmail } from "@/features/drop-emails/render-next-drop-email.server"
import { sendDropEmail } from "@/features/drop-emails/send-drop-email.server"
import { env } from "@/lib/env"
import { getSiteUrl } from "@/lib/get-site-url"
import { hasSameOrigin } from "@/lib/has-same-origin"
import { privateResponseHeaders } from "@/lib/private-response-headers"
import { supportEmail } from "@/lib/support-email"

export const dynamic = "force-dynamic"

const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: privateResponseHeaders })

/** Sends the next drop's email to the store's own inbox. The recipient is fixed here, not chosen. */
export async function POST(request: Request) {
  const deployment = env.VERCEL_ENV === "preview" && env.VERCEL_URL ? new URL(`https://${env.VERCEL_URL}`) : undefined
  if (!hasSameOrigin(request, getSiteUrl(), deployment))
    return respond({ error: "Use the Drop emails page to send a test." }, 403)
  if (!(await getAdminActor())) return respond({ error: "Sign in as an administrator." }, 401)
  const { from, storeSettings } = readDropEmailSetup()
  // An unconfigured store's support address is still the template's placeholder.
  if (storeSettings.includes("configured"))
    return respond({ error: "Finish the store configuration first: the test goes to its support email." }, 409)
  const apiKey = env.RESEND_API_KEY
  if (!apiKey || !from)
    return respond(
      { error: "Email sending isn't set up yet. Add RESEND_API_KEY and DROP_EMAIL_FROM_EMAIL in Vercel first." },
      503
    )
  try {
    const next = await renderNextDropEmail()
    if (next.status !== "ready")
      return respond(
        { error: "There's no upcoming drop to test yet. Add products to a week on the Shop lineup page first." },
        409
      )
    const message = personalizeDropEmail(
      {
        fromAddress: from,
        replyTo: supportEmail,
        subject: `[Test] ${next.subject}`,
        html: next.html,
        textBody: next.text,
        siteOrigin: getSiteUrl().origin,
      },
      { id: dropEmailPreviewToken, email: supportEmail }
    )
    const outcome = await sendDropEmail(apiKey, message, `drop-email-test/${randomUUID()}`)
    if (outcome.status === "sent") return respond({ sent: true })
    const failures = {
      unconfirmed: "Resend didn't confirm the test. Check the Resend dashboard before sending another.",
      "not-sent":
        "Resend didn't accept the test. Check RESEND_API_KEY and that DROP_EMAIL_FROM_EMAIL is on a verified domain, then try again in a minute.",
      rejected: "Resend refused the test message. Check DROP_EMAIL_FROM_EMAIL, then try again.",
    }
    return respond({ error: failures[outcome.status] }, 502)
  } catch {
    console.warn("Drop email test unavailable", { reason: "storage" })
    return respond({ error: "The test email is unavailable right now. Try again shortly." }, 503)
  }
}
