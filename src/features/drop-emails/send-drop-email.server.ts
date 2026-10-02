import "server-only"
import { sendSingleEmail, type SingleEmailSendOutcome } from "@/lib/send-single-email.server"
import type { DropEmailMessage } from "./drop-email-message"

export type DropEmailSendOutcome = SingleEmailSendOutcome

export function sendDropEmail(
  apiKey: string,
  message: DropEmailMessage,
  idempotencyKey: string
): Promise<DropEmailSendOutcome> {
  return sendSingleEmail(apiKey, message, idempotencyKey)
}
