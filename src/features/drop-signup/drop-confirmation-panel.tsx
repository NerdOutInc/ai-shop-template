"use client"
import Link from "next/link"
import { storeConfig } from "@/lib/store-config"
import { useEffect, useRef, useState } from "react"

export function DropConfirmationPanel() {
  const token = useRef<string | null>(null)
  const read = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const [state, setState] = useState<"loading" | "ready" | "sending" | "confirmed" | "missing" | "expired" | "failed">(
    "loading"
  )
  useEffect(() => {
    const readFragment = () => {
      const fragment = window.location.hash.slice(1)
      // Fragments never reach the server. Remove it before navigation, referrers or sharing.
      window.history.replaceState(null, "", window.location.pathname)
      token.current = /^[a-f0-9]{64}$/.test(fragment) ? fragment : null
      setState(token.current ? "ready" : "missing")
    }
    if (!read.current) {
      read.current = true
      readFragment()
    }
    // A second email link can change only the fragment in an already open tab, without remounting.
    window.addEventListener("hashchange", readFragment)
    return () => window.removeEventListener("hashchange", readFragment)
  }, [])

  async function confirm(event: React.FormEvent) {
    event.preventDefault()
    if (!token.current || state === "sending") return
    const submittedToken = token.current
    setState("sending")
    try {
      const response = await fetch("/api/drop-confirm", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: submittedToken }),
      })
      if (token.current !== submittedToken) return
      setState(response.ok ? "confirmed" : response.status === 410 ? "expired" : "failed")
      if (response.ok || response.status === 410) token.current = null
    } catch {
      if (token.current !== submittedToken) return
      setState("failed")
    }
    heading.current?.focus()
  }

  return (
    <section className="max-w-lg">
      <h1 ref={heading} tabIndex={-1} className="font-condensed text-4xl font-bold uppercase outline-none">
        {state === "confirmed"
          ? "You're on the list"
          : state === "missing"
            ? "Open your email link again"
            : state === "expired"
              ? "This link has expired"
              : "Confirm your signup"}
      </h1>
      <p className="mt-4 leading-relaxed" role="status">
        {state === "confirmed"
          ? "Inbox confirmed. We'll email you when a new design drops, and you can unsubscribe in every drop email."
          : state === "missing"
            ? "This page no longer has your confirmation link. Open the link from your email again, then choose Confirm signup. You don't need to request another email."
            : state === "expired"
              ? "This link has expired or been replaced. Use the latest link in your email, or request a fresh one on the home page after the 15-minute resend wait."
              : "Choose Confirm signup to receive future design-drop emails. Opening this page hasn't signed you up."}
      </p>
      {!["confirmed", "missing", "expired"].includes(state) && (
        <form method="post" onSubmit={confirm} className="mt-6">
          <button className="button" disabled={state === "loading" || state === "sending"} type="submit">
            {state === "sending" ? "Confirming…" : "Confirm signup"}
          </button>
        </form>
      )}
      {state === "failed" && (
        <p role="alert" className="mt-4 text-destructive">
          That didn&apos;t confirm. Check your connection and try the button again.
        </p>
      )}
      <p className="mt-6">
        <Link className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4" href="/">
          Back to the shop and signup form
        </Link>
      </p>
      <noscript>
        <p className="mt-4">Enable JavaScript to confirm safely, or contact {storeConfig.supportEmail} for help.</p>
      </noscript>
    </section>
  )
}
