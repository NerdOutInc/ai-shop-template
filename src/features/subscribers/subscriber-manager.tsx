"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { dropConsentWording } from "@/features/drop-signup/drop-consent-wording"
import { formatStoreMoment } from "@/lib/format-store-moment"

import { SubscriberErasure } from "./subscriber-erasure"
import type { SubscriberRecord } from "./subscriber-record"

const moment = (value: string | null) =>
  value ? formatStoreMoment(value, { dateStyle: "medium", timeStyle: "short" }) : "None recorded"

export function SubscriberManager() {
  const router = useRouter()
  const unsubscribeButton = useRef<HTMLButtonElement>(null)
  const stopHeading = useRef<HTMLHeadingElement>(null)
  const stopFocusTarget = useRef<"heading" | "unsubscribe" | null>(null)
  const [confirmUnsubscribe, setConfirmUnsubscribe] = useState(false)
  const resultRef = useRef<HTMLDivElement>(null)
  const [email, setEmail] = useState("")
  const [subscriber, setSubscriber] = useState<SubscriberRecord | null>(null)
  const [searched, setSearched] = useState(false)
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (busy || !stopFocusTarget.current) return
    const target = stopFocusTarget.current === "heading" ? stopHeading.current : unsubscribeButton.current
    if (target) {
      target.focus()
      stopFocusTarget.current = null
    }
  }, [busy, confirmUnsubscribe])

  async function request(input: { action: "lookup"; email: string } | { action: "unsubscribe"; id: string }) {
    setBusy(true)
    setError("")
    setMessage("")
    try {
      const response = await fetch("/api/admin/subscribers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        cache: "no-store",
      })
      const data = (await response.json()) as { subscriber: SubscriberRecord | null; error?: string }
      if (!response.ok) {
        setError(data.error ?? "Subscriber access is unavailable.")
        return
      }
      setSubscriber(data.subscriber)
      if (input.action === "unsubscribe" && !data.subscriber)
        setMessage(
          "The original subscriber record is no longer present. Look up the address again to check for a later signup."
        )
      setSearched(true)
      if (input.action !== "lookup") router.refresh()
      requestAnimationFrame(() => resultRef.current?.focus())
    } catch {
      setError("The change could not be confirmed. Look up the subscriber again before retrying.")
    } finally {
      setBusy(false)
    }
  }

  function lookup(event: FormEvent) {
    event.preventDefault()
    setConfirmUnsubscribe(false)
    setSubscriber(null)
    setSearched(false)
    void request({ action: "lookup", email })
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Look up one exact address to help with a request. No browsing list—and no breadcrumb trail in the URL.
      </p>
      <form onSubmit={lookup}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="subscriber-email">Subscriber email</FieldLabel>
            <Input
              id="subscriber-email"
              type="email"
              required
              maxLength={254}
              autoComplete="off"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                setConfirmUnsubscribe(false)
                setSubscriber(null)
                setSearched(false)
              }}
              disabled={busy}
            />
          </Field>
          <Button type="submit" disabled={busy} className="self-start">
            {busy ? "Working…" : "Look up subscriber"}
          </Button>
        </FieldGroup>
      </form>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {searched && (
        <div
          ref={resultRef}
          tabIndex={-1}
          className="flex flex-col gap-3 rounded-lg border p-4 outline-offset-4"
          aria-live="polite"
        >
          {subscriber ? (
            <>
              <p className="font-semibold break-all">{subscriber.email}</p>
              <div>
                <Badge variant="secondary">
                  {subscriber.unsubscribedAt
                    ? "Unsubscribed"
                    : subscriber.eligible
                      ? subscriber.state === "legacy"
                        ? "Legacy consent"
                        : "Confirmed"
                      : "Awaiting confirmation"}
                </Badge>
              </div>
              <details>
                <summary className="cursor-pointer rounded-sm outline-offset-4">Consent evidence</summary>
                <dl className="mt-3 flex flex-col gap-2 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Signup source</dt>
                    <dd>{subscriber.source}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Consent wording ({subscriber.consentVersion})</dt>
                    <dd>
                      {(Object.hasOwn(dropConsentWording, subscriber.consentVersion)
                        ? dropConsentWording[subscriber.consentVersion]
                        : undefined) ??
                        "This version's wording is unavailable. Check the saved consent record before acting."}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Created</dt>
                    <dd>{moment(subscriber.createdAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Consent recorded</dt>
                    <dd>{moment(subscriber.consentedAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Confirmed</dt>
                    <dd>{moment(subscriber.confirmedAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Unsubscribed</dt>
                    <dd>{moment(subscriber.unsubscribedAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Earlier unsubscribe</dt>
                    <dd>{moment(subscriber.lastUnsubscribedAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Signup IP</dt>
                    <dd className="break-all">{subscriber.signupIp ?? "None recorded"}</dd>
                  </div>
                </dl>
              </details>
              <p className="text-sm text-muted-foreground">
                Unsubscribe stops future drop emails and revokes open confirmation links. It keeps the consent and stop
                record. A send already on its way cannot be recalled. Only a fresh signup and inbox confirmation can
                resume emails; admins cannot undo this stop.
              </p>
              <Button
                variant="outline"
                disabled={busy || confirmUnsubscribe}
                ref={unsubscribeButton}
                onClick={() => {
                  setConfirmUnsubscribe(true)
                  stopFocusTarget.current = "heading"
                }}
                className="self-start"
              >
                {subscriber.unsubscribedAt ? "Keep unsubscribed / revoke new links" : "Unsubscribe"}
              </Button>
              {confirmUnsubscribe && (
                <div
                  role="group"
                  aria-labelledby="subscriber-stop-heading"
                  className="flex flex-col gap-3 rounded-lg border p-4"
                >
                  <h3
                    ref={stopHeading}
                    id="subscriber-stop-heading"
                    tabIndex={-1}
                    aria-describedby="subscriber-stop-warning"
                    className="font-semibold"
                  >
                    Unsubscribe this subscriber?
                  </h3>
                  <p id="subscriber-stop-warning" className="text-sm break-words">
                    This stops future drop emails and revokes open confirmation links for {subscriber.email}. Only a
                    fresh confirmation by the subscriber can resume emails; an admin cannot undo this stop. A send
                    already on its way cannot be recalled.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      aria-describedby="subscriber-stop-warning"
                      disabled={busy}
                      onClick={() => {
                        setConfirmUnsubscribe(false)
                        void request({ action: "unsubscribe", id: subscriber.id })
                      }}
                    >
                      Confirm unsubscribe
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setConfirmUnsubscribe(false)
                        stopFocusTarget.current = "unsubscribe"
                      }}
                    >
                      Cancel unsubscribe
                    </Button>
                  </div>
                </div>
              )}
              {/* Keep one destructive confirmation on screen at a time. */}
              {!confirmUnsubscribe && (
                <SubscriberErasure
                  key={subscriber.id}
                  subscriber={subscriber}
                  onBusyChange={setBusy}
                  onChange={(record, notice) => {
                    setSubscriber(record)
                    setMessage(notice ?? "")
                    router.refresh()
                    if (!record) requestAnimationFrame(() => resultRef.current?.focus())
                  }}
                />
              )}
            </>
          ) : (
            <p>{message || "No subscriber matches that address."}</p>
          )}
        </div>
      )}
    </div>
  )
}
