"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"

import { storeConfig } from "@/lib/store-config"
import { supportEmail } from "@/lib/support-email"

type State = { status: "idle" | "sending" | "done" } | { status: "failed"; message: string }

type DropUnsubscribePanelProps = {
  token: string
  /** Set when the list already shows them as gone, including after a no-JavaScript post comes back. */
  done?: boolean
}

export function DropUnsubscribePanel({ token, done = false }: DropUnsubscribePanelProps) {
  const [state, setState] = useState<State>({ status: done ? "done" : "idle" })
  const [confirmed, setConfirmed] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const action = `/api/drop-unsubscribe/${encodeURIComponent(token)}`
  // The same test the signup form uses to show itself: a closed list must not point people at it.
  const signupOpen = storeConfig.configured && storeConfig.policies.published && storeConfig.features.dropSignup

  // The button that had focus is gone once this succeeds, so carry focus to what replaced it.
  useEffect(() => {
    if (confirmed) heading.current?.focus()
  }, [confirmed])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (state.status === "sending") return
    setState({ status: "sending" })
    try {
      const response = await fetch(action, { method: "POST", credentials: "omit" })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setState({ status: "failed", message: body?.error ?? "That didn't go through. Try again in a moment." })
        return
      }
      setState({ status: "done" })
      setConfirmed(true)
    } catch {
      setState({ status: "failed", message: "That didn't go through. Check your connection and try again." })
    }
  }

  if (state.status === "done")
    return (
      <section aria-labelledby="unsubscribe-heading" className="max-w-2xl">
        <h1 id="unsubscribe-heading" ref={heading} tabIndex={-1} className="display-heading outline-none">
          You&rsquo;re off the list.
        </h1>
        <p className="mt-4 leading-relaxed text-muted-foreground">
          No more drop emails. No hard feelings, either.
          {signupOpen ? " If you ever miss us, the signup is on the home page." : ""}
        </p>
        <Link href="/shop" className="button mt-7">
          {storeConfig.home.shopLabel}
        </Link>
      </section>
    )

  return (
    <section aria-labelledby="unsubscribe-heading" className="max-w-2xl">
      <h1 id="unsubscribe-heading" className="display-heading">
        Stop the drop emails?
      </h1>
      <p className="mt-4 leading-relaxed text-muted-foreground">
        We&rsquo;ll stop emailing you when a new design drops. That&rsquo;s all this list ever sends
        {signupOpen ? ", and you can sign up again on the home page any time" : ""}.
      </p>
      {/* `post` to the same endpoint keeps the button working before hydration or without JavaScript. */}
      <form method="post" action={action} onSubmit={submit} className="mt-7">
        <button type="submit" className="button" disabled={state.status === "sending"}>
          {state.status === "sending" ? "Unsubscribing…" : "Unsubscribe"}
        </button>
      </form>
      {state.status === "failed" && (
        <p role="alert" className="mt-4 text-sm leading-relaxed text-destructive">
          {state.message} Or email{" "}
          <a href={`mailto:${supportEmail}`} className="underline underline-offset-4">
            {supportEmail}
          </a>{" "}
          and we&rsquo;ll take you off by hand.
        </p>
      )}
    </section>
  )
}
