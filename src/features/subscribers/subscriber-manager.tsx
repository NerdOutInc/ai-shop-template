"use client"

import { useRef, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { dropConsentWording } from "@/features/drop-signup/drop-consent-wording"
import { formatStoreMoment } from "@/lib/format-store-moment"

import type { SubscriberRecord } from "./subscriber-record"

const moment = (value: string | null) =>
  value ? formatStoreMoment(value, { dateStyle: "medium", timeStyle: "short" }) : "None recorded"

export function SubscriberManager() {
  const router = useRouter()
  const unsubscribeButton = useRef<HTMLButtonElement>(null)
  const confirmationButton = useRef<HTMLButtonElement>(null)
  const [confirmUnsubscribe, setConfirmUnsubscribe] = useState(false)
  const resultRef = useRef<HTMLDivElement>(null)
  const [email, setEmail] = useState("")
  const [subscriber, setSubscriber] = useState<SubscriberRecord | null>(null)
  const [searched, setSearched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function request(input: { action: "lookup"; email: string } | { action: "unsubscribe"; id: string }) {
    setBusy(true)
    setError("")
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
                disabled={busy}
                ref={unsubscribeButton}
                onClick={() => {
                  setConfirmUnsubscribe(true)
                  requestAnimationFrame(() => confirmationButton.current?.focus())
                }}
                className="self-start"
              >
                {subscriber.unsubscribedAt ? "Keep unsubscribed / revoke new links" : "Unsubscribe"}
              </Button>
              {confirmUnsubscribe && (
                <div
                  role="group"
                  aria-label="Confirm unsubscribe"
                  className="flex flex-col gap-3 rounded-lg border p-4"
                >
                  <p className="text-sm break-words">
                    Stop future emails to {subscriber.email} and revoke open confirmation links? Only this subscriber
                    can resume by signing up and confirming again.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      ref={confirmationButton}
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
                        unsubscribeButton.current?.focus()
                      }}
                    >
                      Cancel unsubscribe
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p>No subscriber matches that address.</p>
          )}
        </div>
      )}
    </div>
  )
}
