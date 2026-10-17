"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import type {
  GoogleCopyEditorState,
  GoogleCopyPreview,
} from "@/features/merchant-feed/google-merchant-copy-editor-state"

export function GoogleMerchantCopyEditor({ productId }: { productId: string }) {
  const [saved, setSaved] = useState<GoogleCopyEditorState | null>(null)
  const [content, setContent] = useState("")
  const [origin, setOrigin] = useState<"generated" | "human" | null>(null)
  const [variantIds, setVariantIds] = useState<number[]>([])
  const [preview, setPreview] = useState<GoogleCopyPreview | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState<"read" | "preview" | "apply" | null>("read")
  const [notice, setNotice] = useState("")
  const generation = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const applying = useRef(false)
  const endpoint = `/api/admin/products/${encodeURIComponent(productId)}/google-copy`

  const begin = useCallback(() => {
    controller.current?.abort()
    controller.current = new AbortController()
    return { token: ++generation.current, signal: controller.current.signal }
  }, [])
  const cancelRequests = useCallback(() => {
    ++generation.current
    controller.current?.abort()
  }, [])
  const reload = useCallback(
    (retainDraft = false) => {
      const { token, signal } = begin()
      return fetch(endpoint, { signal, cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error("read")
          const state = (await response.json()) as GoogleCopyEditorState
          if (token !== generation.current) return
          setPreview(null)
          setConfirmed(false)
          setSaved(state)
          if (retainDraft) {
            setOrigin(state.originLocked ? "generated" : null)
            setVariantIds((ids) => ids.filter((id) => state.variants.some((v) => v.id === id && v.selectable)))
          } else {
            setContent(state.content)
            setOrigin(state.origin)
            setVariantIds(state.variants.filter((v) => v.selected).map((v) => v.id))
          }
        })
        .catch(() => {
          if (token === generation.current) {
            setPreview(null)
            setConfirmed(false)
            setSaved(null)
            setNotice(
              (current) =>
                `${current ? `${current} ` : ""}Saved state is unavailable. Read it again before making another decision.`
            )
          }
        })
        .finally(() => {
          if (token === generation.current) setBusy(null)
        })
    },
    [begin, endpoint]
  )
  useEffect(() => {
    void reload()
    return cancelRequests
  }, [reload, cancelRequests])

  function invalidate() {
    ++generation.current
    controller.current?.abort()
    setPreview(null)
    setConfirmed(false)
    setBusy(null)
    setNotice("")
  }
  async function review() {
    if (!saved || applying.current) return
    const { token, signal } = begin()
    setBusy("preview")
    setPreview(null)
    setConfirmed(false)
    setNotice("")
    try {
      const response = await fetch(`${endpoint}/preview`, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: saved.expectedRevision, content, origin, variantIds }),
      })
      const result = (await response.json()) as { code?: string; newRevision?: string }
      if (token !== generation.current) return
      if (!response.ok) {
        setNotice(
          `Preview refused (${result.code ?? response.status}). Read saved state or revise the selection and wording. Metadata conflicts need separately authorized maintenance.`
        )
        return
      }
      setPreview(result as GoogleCopyPreview)
    } catch {
      if (token === generation.current) setNotice("Preview is unavailable. Nothing was applied.")
    } finally {
      if (token === generation.current) setBusy(null)
    }
  }
  async function apply() {
    if (!preview || !confirmed || applying.current) return
    applying.current = true
    const { token, signal } = begin()
    setBusy("apply")
    setNotice("")
    try {
      const response = await fetch(endpoint, {
        method: "PUT",
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: preview.expectedRevision,
          copy: preview.copy,
          digest: preview.digest,
          confirmation: "APPLY_GOOGLE_COPY",
        }),
      })
      const result = (await response.json()) as { code?: string; newRevision?: string }
      if (token !== generation.current) return
      const refused = response.status >= 400 && response.status < 500
      if (response.ok && typeof result.newRevision === "string" && /^[1-9]\d*$/.test(result.newRevision)) {
        setNotice(`Applied. Committed revision ${result.newRevision}.`)
      } else if (refused) {
        setNotice(
          `Apply refused (${result.code ?? response.status}). Draft wording is retained. Review current saved state and make a fresh preview.`
        )
      } else {
        setNotice(
          "Apply outcome unknown. Reading current saved state; a matching record does not prove which request saved it. No automatic retry."
        )
      }
      setBusy("read")
      setPreview(null)
      setConfirmed(false)
      await reload(refused)
    } catch {
      if (token === generation.current) {
        setNotice(
          "Apply outcome unknown. Reading current saved state; a matching record does not prove which request saved it. No automatic retry."
        )
        setBusy("read")
        setPreview(null)
        setConfirmed(false)
        await reload()
      }
    } finally {
      applying.current = false
      if (token === generation.current) setBusy(null)
    }
  }
  const locked = busy === "apply" || busy === "read" || !saved || Boolean(saved.blocked)
  const incomplete = saved?.issues.some((issue) => issue.code === "GOOGLE_COPY_PROVENANCE_INCOMPLETE")
  const reasonLabels: Record<string, string> = {
    UNCOVERED_VARIANT: "Not in the saved coverage; review before selecting.",
    MISSING: "No saved Google copy.",
    SHARED_FACTS_CHANGED: "Saved product facts changed; review again.",
    VARIANT_CHANGED: "Color, size or production identity changed; review again.",
    INVALID_FIELDS: "Saved copy fields need fresh review.",
    DISABLED_VARIANT: "Disabled variant; cannot be selected.",
    REMOVED_VARIANT: "Removed variant; cannot be selected.",
    MISSING_COLOR_OR_SIZE: "No usable color or size; cannot be selected.",
  }
  const removed =
    saved?.savedCopy?.reviewed_variants.filter(
      (v) => preview && !preview.copy.reviewed_variants.some((p) => p.id === v.id)
    ) ?? []

  return (
    <section
      id="google-copy"
      aria-labelledby="google-copy-title"
      className="my-10 space-y-5 rounded-lg border border-border p-5 sm:p-8"
    >
      <h2 id="google-copy-title" className="font-condensed text-2xl font-semibold">
        Google Merchant copy
      </h2>
      <p className="max-w-prose text-sm text-muted-foreground">
        Edit shared Google wording, then review every exact color and size ending. Applying production copy requires
        separate owner authorization.
      </p>
      <p role="status" className="max-w-prose break-words">
        {notice || (busy === "read" ? "Reading saved copy…" : "")}
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={busy !== null}
        onClick={() => {
          setBusy("read")
          setPreview(null)
          setConfirmed(false)
          void reload()
        }}
      >
        Read saved state
      </Button>
      {saved?.blocked && (
        <p role="alert">
          Editing blocked ({saved.blocked}). Malformed records and unrecoverable metadata need the existing separately
          authorized Google copy maintenance path.
        </p>
      )}
      {saved && (
        <p className="text-sm">
          Saved revision {saved.expectedRevision}.{" "}
          {saved.savedCopy
            ? "Saved wording retained; unchecked variants need fresh review."
            : "No saved copy. Enter wording and choose variants explicitly."}
        </p>
      )}
      <fieldset disabled={locked} className="space-y-5">
        <div className="space-y-2">
          <label htmlFor="google-copy-content" className="block font-semibold">
            Shared base wording
          </label>
          <textarea
            id="google-copy-content"
            value={content}
            rows={6}
            className="w-full rounded-md border border-input bg-background p-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            onChange={(event) => {
              invalidate()
              setContent(event.target.value)
              if (!saved?.originLocked) setOrigin(null)
            }}
          />
        </div>
        <fieldset className="space-y-2">
          <legend className="font-semibold">Wording origin</legend>
          {saved?.originLocked && (
            <p className="text-sm">Known generated origin stays generated, including after a human edit.</p>
          )}
          {incomplete && <p className="text-sm">Incomplete history cannot authorize a human-origin label.</p>}
          {(["generated", "human"] as const).map((choice) => (
            <label key={choice} className="flex min-h-11 items-center gap-3">
              <input
                type="radio"
                name="google-copy-origin"
                checked={origin === choice}
                disabled={saved?.originLocked || (choice === "human" && incomplete)}
                onChange={() => {
                  invalidate()
                  setOrigin(choice)
                }}
              />
              {choice === "generated"
                ? "Generated, including AI-assisted wording"
                : "Human — I attest this wording is human-origin"}
            </label>
          ))}
        </fieldset>
        <div className="space-y-2 text-sm break-words">
          <p className="font-semibold">Saved metadata (read only)</p>
          <p>Pattern: {saved && Object.hasOwn(saved.metadata, "pattern") ? saved.metadata.pattern : "not set"}</p>
          <p>
            Materials:{" "}
            {saved && Object.hasOwn(saved.metadata, "materials") ? JSON.stringify(saved.metadata.materials) : "not set"}
          </p>
          <p>Metadata values and field presence are preserved. Every material color must stay selected.</p>
        </div>
        <fieldset>
          <legend className="font-semibold">Exact variants to cover</legend>
          <div className="mt-2 grid gap-x-6 sm:grid-cols-2">
            {saved?.variants.map((variant) => (
              <label key={variant.id} className="flex min-h-11 items-start gap-3 py-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  disabled={!variant.selectable}
                  checked={variantIds.includes(variant.id)}
                  onChange={(event) => {
                    invalidate()
                    setVariantIds((ids) =>
                      event.target.checked ? [...ids, variant.id] : ids.filter((id) => id !== variant.id)
                    )
                  }}
                />
                <span className="min-w-0 break-words">
                  {variant.label} ({variant.id})
                  {variant.reason && (
                    <span className="block text-muted-foreground">
                      {reasonLabels[variant.reason] ?? "Fresh review required."}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Button
          type="button"
          disabled={!content.trim() || !origin || !variantIds.length || busy !== null}
          onClick={() => void review()}
        >
          {busy === "preview" ? "Previewing…" : "Preview Google copy"}
        </Button>
      </fieldset>
      {(preview || busy === "preview") && (
        <Button type="button" variant="outline" disabled={busy === "apply"} onClick={invalidate}>
          Cancel preview
        </Button>
      )}
      {preview && (
        <div className="space-y-5">
          <h3 className="font-condensed text-xl font-semibold">Final Google descriptions</h3>
          <p className="text-sm">This preview does not reserve eligibility. Apply rechecks saved facts.</p>
          {removed.length > 0 && (
            <p className="text-sm">
              Coverage removed: {removed.map((v) => `${v.label} (${v.id})`).join(", ")}. Enabled variants use their
              published-description fallback; disabled or removed variants emit no item.
            </p>
          )}
          <ul className="space-y-4">
            {preview.descriptions.map((description) => (
              <li key={description.id} className="space-y-2 border-t border-border pt-4">
                <p className="font-semibold break-words">
                  {description.label} ({description.id})
                </p>
                <p className="text-sm">
                  Coverage: {description.effect}. Origin: {description.origin}.
                </p>
                <p className="max-w-prose break-words whitespace-pre-wrap">{description.content}</p>
                {description.effect === "removed" && (
                  <p className="max-w-prose text-sm break-words">Previous Google text: {description.previousContent}</p>
                )}
                <p className="text-sm break-words">
                  Pattern: {description.pattern ?? "not set"}. Material: {description.material ?? "not set"}.
                </p>
              </li>
            ))}
          </ul>
          <label className="flex min-h-11 items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              disabled={busy !== null}
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>I have owner authorization to Apply this exact preview to Google copy.</span>
          </label>
          <Button type="button" disabled={!confirmed || busy !== null} onClick={() => void apply()}>
            {busy === "apply" ? "Applying…" : "Apply Google copy"}
          </Button>
        </div>
      )}
    </section>
  )
}
