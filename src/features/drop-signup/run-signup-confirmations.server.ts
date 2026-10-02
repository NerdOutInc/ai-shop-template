import "server-only"
import { getDropEmailPool } from "@/features/drop-emails/get-drop-email-pool.server"
import { sendSingleEmail } from "@/lib/send-single-email.server"
import { processSignupConfirmations } from "./process-signup-confirmations.server"
import { readSignupConfirmationSetup } from "./read-signup-confirmation-setup.server"

export async function runSignupConfirmations(id?: string) {
  const setup = readSignupConfirmationSetup()
  if (!setup.sending || !setup.apiKey) throw new Error("Signup confirmation sending is disabled")
  const pool = getDropEmailPool()
  return processSignupConfirmations({
    pool,
    id,
    send: (message, key) => sendSingleEmail(setup.apiKey!, message, key),
  })
}
