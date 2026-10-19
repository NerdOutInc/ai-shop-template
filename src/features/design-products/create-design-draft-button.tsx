"use client"

import { Shirt } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import { displayColorName } from "@/lib/display-color-name"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

import type { DesignRecipeProposal } from "./build-design-recipe"
import type { DesignDraftResult } from "./design-draft-types"

type Proposal = Pick<
  DesignRecipeProposal,
  "colors" | "sizes" | "skipped" | "blockers" | "placementDonor" | "unverified"
> & {
  title: string
  modelLabel: string
}
type Outcome = { requestId: string; pending: number; result: DesignDraftResult | null }

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
// Each step is one provider operation, and a single design needs at most a couple. A request that is
// still busy after this many is held by another worker's lease, not waiting on us.
const maxSteps = 5

const outcomes: Partial<Record<DesignDraftResult["status"], string>> = {
  draft: "Draft created. Review its mockups in Printify, then publish it there when you are ready.",
  published: "This design is already in the store on this tee. Nothing was changed.",
  busy: "Printify is still working on this draft. Give it a minute, then continue.",
}

/**
 * Create an unpublished Printify draft of this design, in its assigned garment colours.
 *
 * Two steps on purpose. The first only reads, and shows exactly which colours, sizes and prices
 * would be created and which garments Printify cannot make right now; nothing is reserved until the
 * owner confirms. The draft pipeline decides what is printable, so its refusals are shown verbatim.
 */
export function CreateDesignDraftButton({
  designId,
  displayNumber,
  revisionId,
  resuming = false,
}: {
  designId: string
  displayNumber: number
  revisionId: string
  /** An earlier draft of this tee is unfinished, so the same button carries it on. */
  resuming?: boolean
}) {
  const router = useRouter()
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endpoint = `/api/admin/concepts/${encodeURIComponent(designId)}/draft`
  const heading = useRef<HTMLHeadingElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const reviewing = useRef(false)

  // The trigger and the review replace one another, and an unmounted control drops focus to the top
  // of the page. Keyboard and screen-reader users are carried to whichever one just appeared.
  useEffect(() => {
    if (proposal) heading.current?.focus()
    else if (reviewing.current) trigger.current?.focus()
    reviewing.current = proposal !== null
  }, [proposal])

  async function review() {
    if (pending) return
    setPending(true)
    setError(null)
    setOutcome(null)
    try {
      const response = await fetch(`${endpoint}?number=${displayNumber}&revision=${encodeURIComponent(revisionId)}`, {
        credentials: "same-origin",
      })
      const body = (await response.json().catch(() => null)) as (Proposal & { error?: string }) | null
      if (!response.ok || !body) setError(body?.error ?? "The draft could not be prepared. Try again in a moment.")
      else setProposal(body)
    } catch {
      setError("The draft could not be prepared. Try again in a moment.")
    } finally {
      setPending(false)
    }
  }

  async function run(action: "create" | "reconcile", requestId: string) {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      let latest: Outcome | null = null
      for (let step = 0; step < maxSteps; step++) {
        const response = await fetch(endpoint, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, requestId, displayNumber, revisionId }),
        })
        const body = (await response.json().catch(() => null)) as (Outcome & { error?: string }) | null
        if (!response.ok || !body) {
          setError(body?.error ?? "That draft could not be confirmed. Refresh before trying again.")
          break
        }
        latest = body
        // A carried-on earlier request answers under its own id; keep following that one.
        requestId = body.requestId
        if (action === "reconcile" || body.pending === 0) break
      }
      if (latest) {
        setOutcome(latest)
        setProposal(null)
        router.refresh()
      }
    } catch {
      // The request may have reached Printify. Say so, rather than inviting a blind second create.
      setError("That draft could not be confirmed. Refresh this page before trying again.")
    } finally {
      setPending(false)
    }
  }

  const result = outcome?.result ?? null
  // A finished tee owns this model. The refreshed page drops this control; until then, so does it.
  const finished = result?.status === "draft" || result?.status === "published"
  return (
    <div className="flex flex-col gap-3">
      {!proposal && !finished && (
        <Button ref={trigger} variant="outline" className="min-h-11 w-fit" disabled={pending} onClick={review}>
          <Shirt data-icon="inline-start" aria-hidden="true" />
          {resuming ? "Continue Printify draft" : "Create Printify draft"}
        </Button>
      )}
      {proposal && (
        <section aria-labelledby="draft-review-heading" className="flex flex-col gap-3 rounded-md border p-4">
          <h3 id="draft-review-heading" ref={heading} tabIndex={-1} className="font-semibold outline-none">
            {proposal.title} on {proposal.modelLabel}
          </h3>
          {proposal.blockers.length > 0 ? (
            <Alert variant="destructive">
              <AlertDescription>
                <ul className="flex list-disc flex-col gap-1 pl-4">
                  {proposal.blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : (
            <dl className="flex flex-col gap-2 text-sm">
              <div>
                <dt className="font-medium">Colors</dt>
                <dd className="text-muted-foreground">{proposal.colors.map(displayColorName).join(", ")}</dd>
              </div>
              <div>
                <dt className="font-medium">Sizes and prices</dt>
                <dd className="text-muted-foreground">
                  {proposal.sizes.map(({ size, price }) => `${size} ${usd.format(price / 100)}`).join(", ")}
                </dd>
              </div>
              {proposal.placementDonor && (
                <div>
                  <dt className="font-medium">Placement reference</dt>
                  <dd className="text-muted-foreground">
                    {proposal.placementDonor.title && <p className="break-words">{proposal.placementDonor.title}</p>}
                    <p className="break-all">Printify product {proposal.placementDonor.productId}</p>
                    <p>This draft copies this product&apos;s front artwork placement.</p>
                  </dd>
                </div>
              )}
              {proposal.unverified.includes("placement") && (
                <div>
                  <dt className="font-medium">Review the placement</dt>
                  <dd className="text-muted-foreground">
                    Published tees of this model use different placements. This draft copies the reference above; review
                    its mockups in Printify before publishing.
                  </dd>
                </div>
              )}
              {proposal.skipped.length > 0 && (
                <div>
                  <dt className="font-medium">Left out</dt>
                  <dd className="text-muted-foreground">
                    <ul className="flex flex-col gap-1">
                      {proposal.skipped.map(({ color, size, reason }) => (
                        <li key={`${color}:${size}`}>
                          {size ? `${displayColorName(color)}, ${size}` : displayColorName(color)}: {reason}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
            </dl>
          )}
          <p className="text-sm text-muted-foreground">
            Uses this exact revision&apos;s full-resolution transparent print file. It creates a draft only; nothing is
            published.
          </p>
          <div className="flex flex-wrap gap-3">
            {proposal.blockers.length === 0 && (
              <Button className="min-h-11" disabled={pending} onClick={() => run("create", crypto.randomUUID())}>
                {pending ? "Creating the draft…" : "Create draft"}
              </Button>
            )}
            <Button variant="outline" className="min-h-11" disabled={pending} onClick={() => setProposal(null)}>
              {proposal.blockers.length > 0 ? "Close" : "Cancel"}
            </Button>
          </div>
        </section>
      )}
      {result?.status === "needs-reconciliation" && outcome && (
        <Button
          variant="outline"
          className="min-h-11 w-fit"
          disabled={pending}
          onClick={() => run("reconcile", result.owningRequestId ?? outcome.requestId)}
        >
          Check Printify again
        </Button>
      )}
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {pending
          ? proposal
            ? "Creating the draft in Printify. This can take a minute."
            : "Checking with Printify…"
          : result
            ? (outcomes[result.status] ?? result.message)
            : ""}
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
