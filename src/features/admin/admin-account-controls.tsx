"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { adminAuthAction } from "./admin-auth-action"
import { createAdminBrowserClient } from "./create-admin-browser-client"

type Passkey = { id: string; friendly_name?: string; created_at: string }

export function AdminAccountControls() {
  const router = useRouter()
  const [passkeys, setPasskeys] = useState<Passkey[]>([])
  const [message, setMessage] = useState("")
  const [pending, startTransition] = useTransition()

  async function load() {
    const { data, error } = await createAdminBrowserClient().auth.passkey.list()
    if (error) {
      setMessage("Passkeys could not be loaded. Email sign-in remains available.")
      return
    }
    setPasskeys(data ?? [])
  }

  useEffect(() => {
    let cancelled = false
    void createAdminBrowserClient()
      .auth.passkey.list()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setMessage("Passkeys could not be loaded. Email sign-in remains available.")
        else setPasskeys(data ?? [])
      })
      .catch(() => {
        if (!cancelled) setMessage("Passkeys are unavailable here. Email sign-in remains available.")
      })
    return () => {
      cancelled = true
    }
  }, [])

  function enroll() {
    startTransition(async () => {
      try {
        const { error } = await createAdminBrowserClient().auth.registerPasskey()
        if (error) {
          setMessage("Passkey enrollment was not completed. You can try again or keep using email.")
          return
        }
        await load()
        setMessage("Passkey added. Keep access to your email for recovery, and consider adding a second device.")
      } catch {
        setMessage("This browser could not add a passkey. Email sign-in remains available.")
      }
    })
  }

  function remove(id: string) {
    startTransition(async () => {
      try {
        const { error } = await createAdminBrowserClient().auth.passkey.delete({ passkeyId: id })
        if (error) {
          setMessage("Could not remove that passkey. Please try again.")
          return
        }
        await load()
        setMessage("Passkey removed. Email sign-in remains available.")
      } catch {
        setMessage("Could not remove that passkey. Please try again.")
      }
    })
  }

  function signOut() {
    startTransition(async () => {
      const result = await adminAuthAction({ operation: "sign-out" })
      setMessage(result.message)
      if (result.ok && result.destination) {
        router.replace(result.destination)
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h2 className="text-xl font-semibold">Your passkeys</h2>
        <p className="text-sm text-muted-foreground">
          Use a device, password manager, or security key. Email verification is always available for recovery.
        </p>
        {passkeys.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {passkeys.map((key) => (
              <li key={key.id} className="flex items-center justify-between gap-4 p-3">
                <span>{key.friendly_name || "Passkey"}</span>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={pending}
                  onClick={() => remove(key.id)}
                  aria-label={`Remove ${key.friendly_name || "passkey"}`}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button type="button" className="min-h-12" disabled={pending} onClick={enroll}>
          Add a passkey
        </Button>
      </div>
      <p role="status" aria-live="polite" className="text-sm">
        {message}
      </p>
      <Button type="button" variant="outline" className="min-h-12" disabled={pending} onClick={signOut}>
        Sign out on this device
      </Button>
    </div>
  )
}
