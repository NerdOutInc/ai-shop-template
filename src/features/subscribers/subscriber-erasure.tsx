"use client"
import { useRef, useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { SubscriberRecord } from "./subscriber-record"

export function SubscriberErasure({
  subscriber,
  onChange,
  onBusyChange,
}: {
  subscriber: SubscriberRecord
  onBusyChange: (busy: boolean) => void
  onChange: (record: SubscriberRecord | null, message?: string) => void
}) {
  const [preview, setPreview] = useState<SubscriberRecord | null>(null)
  const [address, setAddress] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const confirmationRef = useRef<HTMLInputElement>(null)
  const previewButtonRef = useRef<HTMLButtonElement>(null)
  async function post(body: unknown) {
    const response = await fetch("/api/admin/subscribers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    })
    const data = (await response.json()) as { status?: string; error?: string; subscriber?: SubscriberRecord | null }
    if (!response.ok && !data.status) throw new Error(data.error ?? "The request could not be confirmed.")
    return data
  }
  async function readPreview() {
    setBusy(true)
    onBusyChange(true)
    setError("")
    try {
      // Original immutable identity also handles a lost commit response without targeting a re-signup.
      const data = await post({ action: "preview", id: subscriber.id })
      if (!data.subscriber) {
        onChange(
          null,
          "The original subscriber record is no longer present. Look up the address again to check for a later signup."
        )
        return
      }
      onChange(data.subscriber)
      setPreview(data.subscriber)
      setAddress("")
      setUncertain(false)
      requestAnimationFrame(() => confirmationRef.current?.focus())
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The record could not be checked.")
    } finally {
      setBusy(false)
      onBusyChange(false)
    }
  }
  async function erase() {
    if (!preview) return
    setBusy(true)
    onBusyChange(true)
    setError("")
    try {
      const { id, updatedAt, deliveries, confirmations } = preview
      const data = await post({
        action: "erase",
        email: address,
        preview: { id, updatedAt, deliveries, confirmations },
      })
      if (data.status === "busy") {
        setError("A sender or subscriber change is in progress. Try again shortly.")
        return
      }
      if (data.status === "stale" && data.subscriber) {
        onChange(data.subscriber)
        setPreview(data.subscriber)
        setAddress("")
        setError("This record changed. Review the fresh preview and type the address again.")
        requestAnimationFrame(() => confirmationRef.current?.focus())
        return
      }
      if (data.status !== "erased" && data.status !== "absent") throw new Error("The erasure could not be confirmed.")
      onChange(
        null,
        "The original subscriber and its associated records are removed. Orders and shared drop emails were kept."
      )
    } catch {
      setPreview(null)
      setAddress("")
      setUncertain(true)
      setError("The erasure response was lost or unavailable. Check the original record before taking another action.")
      requestAnimationFrame(() => previewButtonRef.current?.focus())
    } finally {
      setBusy(false)
      onBusyChange(false)
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <Button
        ref={previewButtonRef}
        variant="outline"
        disabled={busy}
        className="self-start"
        onClick={() => void readPreview()}
      >
        {uncertain ? "Check original record" : "Preview erasure"}
      </Button>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {preview && (
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          <h3 className="font-semibold">Remove from the subscriber list</h3>
          <p className="break-all">{preview.email}</p>
          <p className="text-sm">
            Deletes this subscriber’s email, signup IP, consent and stop evidence, {preview.deliveries} drop delivery
            records and {preview.confirmations} confirmation records, including saved tokens, message payloads and
            provider receipts.
          </p>
          <p className="text-sm text-muted-foreground">
            Keeps orders, payments, fulfillment and checkout records, and shared drop email templates. Provider records,
            old hosting logs, support messages and earlier backups may remain. No permanent suppression record is kept;
            a later signup needs fresh confirmation.
          </p>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="subscriber-erase-address">Type the email to confirm erasure</FieldLabel>
              <Input
                ref={confirmationRef}
                id="subscriber-erase-address"
                type="email"
                autoComplete="off"
                maxLength={254}
                value={address}
                disabled={busy}
                onChange={(event) => setAddress(event.target.value)}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="destructive"
                disabled={busy || address.trim().toLowerCase() !== preview.email}
                onClick={() => void erase()}
              >
                Erase subscriber
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setPreview(null)
                  setAddress("")
                  requestAnimationFrame(() => previewButtonRef.current?.focus())
                }}
              >
                Cancel
              </Button>
            </div>
          </FieldGroup>
        </div>
      )}
    </div>
  )
}
