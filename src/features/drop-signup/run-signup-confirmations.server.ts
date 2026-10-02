import "server-only"
import { getDropEmailPool } from "@/features/drop-emails/get-drop-email-pool.server"
import { sendSingleEmail } from "@/lib/send-single-email.server"
import { processSignupConfirmations } from "./process-signup-confirmations.server"
import { readSignupConfirmationSetup } from "./read-signup-confirmation-setup.server"

export async function runSignupConfirmations(id?: string) {
  const setup = readSignupConfirmationSetup()
  if (!setup.sending || !setup.apiKey) throw new Error("Signup confirmation sending is disabled")
  const pool = getDropEmailPool()
  const result = await processSignupConfirmations({
    pool,
    id,
    send: (message, key) => sendSingleEmail(setup.apiKey!, message, key),
  })
  const budget = await pool.query<{ limited: boolean }>(
    "select blocked_at > now() - interval '1 hour' as limited from commerce.drop_signup_confirmation_budget"
  )
  if (budget.rows[0]?.limited) {
    console.warn("Signup confirmation hourly ceiling reached")
    result.errors++
  }
  return result
}
