"use client"

import { useId, useState } from "react"

import { Button } from "@/components/ui/button"
import { supportEmail } from "@/lib/support-email"

type State = { status: "idle" | "sending" | "sent" } | { status: "failed"; message: string }

/** Sends the next drop's email to the store's own inbox, and never to a subscriber. */
export function DropEmailTestSend({ unavailableReason }: { unavailableReason?: string }) {
  const [state, setState] = useState<State>({ status: "idle" })
  const reasonId = useId()

  async function send() {
    if (state.status === "sending") return
    setState({ status: "sending" })
    try {
      const response = await fetch("/api/admin/drop-emails/test", { method: "POST", credentials: "same-origin" })
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) {
        setState({ status: "failed", message: body?.error ?? "The test didn't send. Try again shortly." })
        return
      }
      setState({ status: "sent" })
    } catch {
      setState({ status: "failed", message: "The test didn't send. Check your connection and try again." })
    }
  }

  return (
    <div>
      <Button
        type="button"
        className="min-h-11"
        onClick={send}
        disabled={state.status === "sending" || unavailableReason !== undefined}
        aria-describedby={unavailableReason ? reasonId : undefined}
      >
        {state.status === "sending" ? "Sending the test…" : `Send a test to ${supportEmail}`}
      </Button>
      {unavailableReason && (
        <p id={reasonId} className="mt-2 text-sm text-muted-foreground">
          {unavailableReason}
        </p>
      )}
      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm">
        {state.status === "sent" ? `Sent. Look for it in ${supportEmail} in a minute or two.` : ""}
      </p>
      {state.status === "failed" && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
    </div>
  )
}
