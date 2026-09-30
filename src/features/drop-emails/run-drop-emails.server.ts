import "server-only"

import { env } from "@/lib/env"
import { getSiteUrl } from "@/lib/get-site-url"
import { supportEmail } from "@/lib/support-email"

import { getDropEmailPool } from "./get-drop-email-pool.server"
import { processDropEmails } from "./process-drop-emails.server"
import { readDropEmailProducts } from "./read-drop-email-products.server"
import { readDropEmailSetup } from "./read-drop-email-setup.server"
import { readDropEmailWeek } from "./read-drop-email-week.server"
import { sendDropEmail } from "./send-drop-email.server"

export async function runDropEmails() {
  const { missing, storeSettings, from, postalAddress } = readDropEmailSetup()
  const apiKey = env.RESEND_API_KEY
  if (missing.length || storeSettings.length || !from || !postalAddress || !apiKey)
    throw new Error("Drop emails are not configured")
  return processDropEmails({
    pool: getDropEmailPool(),
    from,
    // Replies reach a person rather than bouncing off the sending address.
    replyTo: supportEmail,
    siteUrl: getSiteUrl().origin,
    postalAddress,
    readWeek: readDropEmailWeek,
    readProducts: readDropEmailProducts,
    send: (message, key) => sendDropEmail(apiKey, message, key),
  })
}
