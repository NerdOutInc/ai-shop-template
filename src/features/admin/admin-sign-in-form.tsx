"use client"

import { useState, useTransition, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { adminSignInDestination } from "./admin-sign-in-destination"
import { adminAuthAction, type AdminAuthResult } from "./admin-auth-action"
import { createAdminBrowserClient } from "./create-admin-browser-client"

export function AdminSignInForm({ setup = false, returnTo }: { setup?: boolean; returnTo?: string }) {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [proof, setProof] = useState("")
  const [token, setToken] = useState("")
  const [codeSent, setCodeSent] = useState(false)
  const [message, setMessage] = useState("")
  const [pending, startTransition] = useTransition()

  function finish(result: AdminAuthResult) {
    setMessage(result.message)
    if (result.ok && result.destination) {
      setProof("")
      router.replace(
        !setup && result.destination === "/admin/concepts" ? adminSignInDestination(returnTo) : result.destination
      )
      router.refresh()
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    startTransition(async () => {
      const result = await adminAuthAction({
        operation: setup ? (codeSent ? "verify-setup" : "request-setup") : codeSent ? "verify-email" : "request-email",
        email: email.trim(),
        proof,
        token,
      })
      if (result.ok && !codeSent) setCodeSent(true)
      finish(result)
    })
  }

  function passkey() {
    startTransition(async () => {
      try {
        const { error } = await createAdminBrowserClient().auth.signInWithPasskey()
        if (error) {
          setMessage("Passkey sign-in was not completed. Try again or use an email code.")
          return
        }
        finish(await adminAuthAction({ operation: "finish-passkey" }))
      } catch {
        setMessage("Passkeys are unavailable in this browser. You can still sign in with an email code.")
      }
    })
  }

  const inputClass =
    "min-h-12 w-full rounded-lg border border-border bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
  return (
    <div className="space-y-6">
      {!setup && (
        <Button type="button" className="min-h-12 w-full" disabled={pending} onClick={passkey}>
          Sign in with a passkey
        </Button>
      )}
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="admin-email" className="block font-medium">
            {setup ? "Owner email" : "Email"}
          </Label>
          <Input
            id="admin-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={pending || codeSent}
            className={inputClass}
          />
        </div>
        {setup && (
          <div className="space-y-2">
            <Label htmlFor="admin-setup-proof" className="block font-medium">
              One-time setup key
            </Label>
            <Input
              id="admin-setup-proof"
              name="proof"
              type="password"
              autoComplete="off"
              required
              minLength={32}
              maxLength={256}
              value={proof}
              onChange={(event) => setProof(event.target.value)}
              disabled={pending}
              className={inputClass}
              aria-describedby="setup-proof-help"
            />
            <p id="setup-proof-help" className="text-sm text-muted-foreground">
              Use the key from your deployment owner. It stays in this form until setup finishes.
            </p>
          </div>
        )}
        {codeSent && (
          <div className="space-y-2">
            <Label htmlFor="admin-code" className="block font-medium">
              Email verification code
            </Label>
            <Input
              id="admin-code"
              name="token"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6,10}"
              required
              minLength={6}
              maxLength={10}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              disabled={pending}
              className={inputClass}
            />
          </div>
        )}
        <Button type="submit" variant={setup ? "default" : "outline"} className="min-h-12 w-full" disabled={pending}>
          {pending
            ? "Working…"
            : codeSent
              ? setup
                ? "Verify and finish setup"
                : "Verify and sign in"
              : "Send an email code"}
        </Button>
        {codeSent && (
          <Button
            type="button"
            variant="ghost"
            className="min-h-11"
            disabled={pending}
            onClick={() => {
              setCodeSent(false)
              setToken("")
              setMessage("")
            }}
          >
            Use another email or request a new code
          </Button>
        )}
      </form>
      <p role="status" aria-live="polite" className="text-sm">
        {message}
      </p>
    </div>
  )
}
