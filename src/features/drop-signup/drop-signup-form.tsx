"use client"

import { useId, useRef, useState } from "react"

import { dropConsentCopy } from "./drop-consent-copy"

type DropSignupFormProps = { source: "design-of-the-week" | "footer" | "home" }
type State =
  { status: "idle" | "sending" } | { status: "done"; message: string } | { status: "failed"; message: string }

export function DropSignupForm({ source }: DropSignupFormProps) {
  const emailId = useId()
  const honeypotId = useId()
  const [email, setEmail] = useState("")
  const [state, setState] = useState<State>({ status: "idle" })
  const honeypot = useRef<HTMLInputElement>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (state.status === "sending") return
    setState({ status: "sending" })
    try {
      const response = await fetch("/api/drop-signup", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source, company: honeypot.current?.value ?? "" }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setState({ status: "failed", message: body?.error ?? "That didn't send. Try again in a moment." })
        return
      }
      setEmail("")
      setState({ status: "done", message: "You're on the list. See you at the next drop." })
    } catch {
      setState({ status: "failed", message: "That didn't send. Check your connection and try again." })
    }
  }

  // `post` only matters before hydration, when the browser submits the form itself: the default
  // `get` would put the address in the page URL, and from there in history and analytics.
  return (
    <form method="post" onSubmit={submit} className="max-w-md">
      <label htmlFor={emailId} className="font-condensed text-lg font-bold tracking-wider uppercase">
        Know when the next one drops
      </label>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{dropConsentCopy.text}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <input
          id={emailId}
          type="email"
          name="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={state.status === "sending"}
          className="min-h-12 min-w-0 flex-1 rounded-sm border border-foreground/25 bg-background px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2"
        />
        <button type="submit" className="button" disabled={state.status === "sending"}>
          {state.status === "sending" ? "Signing up…" : "Keep me posted"}
        </button>
      </div>

      {/* A visitor never sees this, so anything in it came from a script filling every field it found.
          `hidden` keeps it out of the accessibility tree, so it needs no label and cannot fail an audit. */}
      <div hidden aria-hidden="true">
        <label htmlFor={honeypotId}>Company</label>
        <input ref={honeypot} id={honeypotId} name="company" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <p role="status" aria-live="polite" className="mt-3 min-h-6 text-sm leading-relaxed">
        {state.status === "done" ? state.message : ""}
      </p>
      {state.status === "failed" && (
        <p role="alert" className="mt-3 text-sm leading-relaxed text-destructive">
          {state.message}
        </p>
      )}
    </form>
  )
}
