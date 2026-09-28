"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { agentGrantAction } from "./agent-grant-action"
import type { DesignAgentGrant, DesignAgentScope } from "./design-agent-types"

export function AgentGrantControls({ grants }: { grants: DesignAgentGrant[] }) {
  const router = useRouter(),
    [pending, startTransition] = useTransition(),
    [label, setLabel] = useState("Design agent"),
    [hours, setHours] = useState("24"),
    [scopes, setScopes] = useState<DesignAgentScope[]>(["library:read", "library:write", "drafts:create"]),
    [credential, setCredential] = useState<{ id: string; token: string; expiresAt: string } | null>(null),
    [message, setMessage] = useState("")
  function issue(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    startTransition(async () => {
      const result = await agentGrantAction({ operation: "issue", label, hours: Number(hours), scopes })
      setMessage(result.message)
      if (result.ok && result.credential) setCredential(result.credential)
      router.refresh()
    })
  }
  function download() {
    if (!credential) return
    const url = URL.createObjectURL(new Blob([credential.token + "\n"], { type: "text/plain" }))
    const link = document.createElement("a")
    link.href = url
    link.download = `design-agent-${credential.id}.token`
    link.click()
    URL.revokeObjectURL(url)
  }
  function revoke(id: string) {
    startTransition(async () => {
      const result = await agentGrantAction({ operation: "revoke", id })
      setMessage(result.message)
      if (result.ok && credential?.id === id) setCredential(null)
      router.refresh()
    })
  }
  return (
    <div className="space-y-8">
      <form onSubmit={issue} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="grant-label">Agent name</Label>
          <Input
            id="grant-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            required
            maxLength={100}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="grant-expiry">Expires in hours</Label>
          <Input
            id="grant-expiry"
            type="number"
            min="1"
            max="168"
            value={hours}
            onChange={(event) => setHours(event.target.value)}
            required
          />
        </div>
        <fieldset className="space-y-2">
          <legend className="mb-2 font-medium">Allowed work</legend>
          {(["library:read", "library:write", "drafts:create"] as const).map((scope) => (
            <label key={scope} className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                className="size-5 accent-primary"
                checked={scopes.includes(scope)}
                onChange={(event) =>
                  setScopes((current) =>
                    event.target.checked ? [...current, scope] : current.filter((value) => value !== scope)
                  )
                }
              />
              {scope === "library:read"
                ? "Read artwork and my favorites"
                : scope === "library:write"
                  ? "Add and review design batches"
                  : "Create product drafts"}
            </label>
          ))}
        </fieldset>
        <p className="text-sm text-muted-foreground">
          Agents act on your behalf and stop working if your admin access is removed. Grants cannot publish products:
          drafts they create stay unpublished in Printify until you publish them. Choose individual published products
          for Design of the Week from Products.
        </p>
        <Button type="submit" className="min-h-12" disabled={pending || !!credential}>
          Create agent access
        </Button>
      </form>
      {credential && (
        <section className="space-y-3 rounded-xl border border-border p-4" aria-label="Save agent credential">
          <h2 className="text-lg font-semibold">Save this credential once</h2>
          <p>
            Download it to a private location outside this repository. Give the agent the file path, not the credential
            in chat. Restrict file permissions to your account with <code>chmod 600</code>. It expires{" "}
            {new Date(credential.expiresAt).toLocaleString()}.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button className="min-h-11" type="button" onClick={download}>
              Download credential file
            </Button>
            <Button className="min-h-11" variant="outline" type="button" onClick={() => setCredential(null)}>
              I saved it
            </Button>
          </div>
        </section>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Your agent access</h2>
        {grants.length ? (
          <ul className="divide-y divide-border">
            {grants.map((grant) => (
              <li key={grant.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div>
                  <p className="font-medium">{grant.label}</p>
                  <p className="text-sm">
                    {grant.revokedAt ? "Revoked" : `Expires ${new Date(grant.expiresAt).toLocaleString()}`}
                  </p>
                  <p className="text-sm text-muted-foreground">{grant.scopes.join(", ")}</p>
                </div>
                {!grant.revokedAt && (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={pending}
                    onClick={() => revoke(grant.id)}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p>No agent grants yet.</p>
        )}
      </section>
    </div>
  )
}
