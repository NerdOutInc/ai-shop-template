import "server-only"

import { z } from "zod"
import { supportEmail } from "@/lib/support-email"
import type { OwnerEmail } from "./order-alert"

export async function sendOrderAlert(apiKey: string, email: OwnerEmail, idempotencyKey: string): Promise<string> {
  // Even a corrupted outbox cannot turn this worker into a customer mailer.
  if (email.to.length !== 1 || email.to[0] !== supportEmail) throw new Error("Invalid alert recipient")
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(email),
    })
    if (!response.ok) throw new Error("Send failed")
    const receipt = z.object({ id: z.string().min(1) }).parse(await response.json())
    return receipt.id
  } catch {
    // Never log provider bodies, addresses, message text, or credentials.
    throw new Error("Owner alert could not be confirmed")
  }
}
