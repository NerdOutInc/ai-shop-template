import "server-only"

import { z } from "zod"

import type { SingleRecipientEmailMessage } from "./single-recipient-email-message"

/**
 * - sent: Resend accepted it.
 * - rejected: Resend refused this one message, and sending it again cannot help.
 * - not-sent: nothing was accepted (rate limit, bad key, unverified sender), so it is safe to try
 *   again later, and the problem is probably not this message.
 * - unconfirmed: it may have been accepted. Only a retry with the same key is safe.
 */
export type SingleEmailSendOutcome =
  | { status: "sent"; providerEmailId: string }
  | { status: "rejected" }
  | { status: "not-sent" }
  | { status: "unconfirmed" }

export async function sendSingleEmail(
  apiKey: string,
  message: SingleRecipientEmailMessage,
  idempotencyKey: string
): Promise<SingleEmailSendOutcome> {
  // Even a corrupted outbox row cannot turn one send into a group email.
  if (message.to.length !== 1) throw new Error("An email has exactly one recipient")
  let response: Response
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(message),
    })
  } catch {
    // A timeout can land after Resend accepted it. Never log the body: it holds the address.
    return { status: "unconfirmed" }
  }
  if (response.ok) {
    const receipt = z.object({ id: z.string().min(1).max(128) }).safeParse(await response.json().catch(() => null))
    return receipt.success ? { status: "sent", providerEmailId: receipt.data.id } : { status: "unconfirmed" }
  }
  if ([401, 403, 429].includes(response.status)) return { status: "not-sent" }
  // 409 is Resend's idempotency answer (a concurrent or mismatched retry of this key), and 408 a
  // timeout: neither says the first attempt failed.
  if (response.status >= 400 && response.status < 500 && ![408, 409].includes(response.status))
    return { status: "rejected" }
  return { status: "unconfirmed" }
}
