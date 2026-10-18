"use client"

import Image from "next/image"
import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { canOptimizeProductImage } from "@/features/catalog/can-optimize-product-image"
import { displayProductTitle } from "@/features/catalog/display-product-title"
import { ProductImageGallery } from "@/features/catalog/product-image-gallery"
import { galleryColorSelection } from "@/features/product-gallery/gallery-color-selection"
import type { GalleryEntry, GalleryManifest } from "@/features/product-gallery/gallery-manifest-schema"
import { galleryMutationSchema } from "@/features/product-gallery/gallery-mutation-schema"
import { galleryPhotoRoleSchema } from "@/features/product-gallery/gallery-photo-role-schema"
import type { GalleryEditorData } from "@/features/product-gallery/read-gallery-editor.server"
import { formatStoreMoment } from "@/lib/format-store-moment"

const roles = galleryPhotoRoleSchema.options
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
const field = `min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 ${focusRing}`
const entryKey = (entry: GalleryEntry) => (entry.source === "store" ? entry.assetId : entry.src)
export function ProductPhotoEditor({ initial }: { initial: GalleryEditorData }) {
  const [data, setData] = useState(initial),
    [draft, setDraft] = useState(initial.draft),
    [selected, setSelected] = useState(initial.colors[0]?.key ?? "none")
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [failed, setFailed] = useState(false)
  const [confirmations, setConfirmations] = useState<Record<string, string>>({}),
    [preview, setPreview] = useState(false),
    [restore, setRestore] = useState("")
  const [pendingReload, setPendingReload] = useState<GalleryEditorData | null>(null)
  const endpoint = `/api/admin/products/${encodeURIComponent(data.productId)}/gallery`
  const color = data.colors.find((c) => c.key === selected),
    curated = draft.colors.find((c) => c.colorKey === selected)
  const readOnly = !color?.available
  const savedColor = data.draft.colors.find((c) => c.colorKey === selected)
  const different = (other: typeof curated | null) =>
    JSON.stringify(galleryColorSelection(curated)) !== JSON.stringify(galleryColorSelection(other))
  function recoverColor(selection: typeof curated | null) {
    change({
      ...draft,
      colors: [...draft.colors.filter((c) => c.colorKey !== selected), ...(selection ? [selection] : [])],
    })
  }
  const photoUrl = (entry: GalleryEntry) =>
    entry.source === "store" ? `${endpoint}/assets/${entry.assetId}` : entry.src
  function change(next: GalleryManifest) {
    setDraft(next)
    setDirty(true)
    setConfirmations({})
    setMessage("")
    setFailed(false)
  }
  function entries(next: GalleryEntry[]) {
    change({
      ...draft,
      colors: [
        ...draft.colors.filter((c) => c.colorKey !== selected),
        { colorKey: selected, entries: next, reviewedBinding: curated?.reviewedBinding ?? null },
      ],
    })
  }
  const moveButtons = useRef(new Map<string, HTMLButtonElement>())
  function move(index: number, offset: -1 | 1) {
    const next = [...curated!.entries]
    ;[next[index], next[index + offset]] = [next[index + offset]!, next[index]!]
    entries(next)
    // Reordering can remount the focused row; keep keyboard focus on the photo that moved.
    const target = `${entryKey(next[index + offset]!)}:${offset}`
    requestAnimationFrame(() => moveButtons.current.get(target)?.focus())
  }
  function moveButton(entry: GalleryEntry, offset: -1 | 1) {
    return (node: HTMLButtonElement | null) => {
      const key = `${entryKey(entry)}:${offset}`
      if (node) moveButtons.current.set(key, node)
      else moveButtons.current.delete(key)
    }
  }
  function edit(index: number, update: Partial<Pick<GalleryEntry, "alt" | "role" | "viewKey">>) {
    entries(curated!.entries.map((e, i) => (i === index ? { ...e, ...update } : e)))
  }
  async function decode<T>(response: Response): Promise<T> {
    if (response.status === 413) throw new Error("Choose a photo under 3 MB and upload it again.")
    const body = await response.json().catch(() => null)
    if (!body)
      throw new Error(
        "The server response could not be confirmed. Reload saved state before retrying; your unsaved edits will be preserved."
      )
    if (!response.ok)
      throw new Error(
        body && typeof body === "object" && "error" in body && typeof body.error === "string"
          ? body.error
          : "The request could not be confirmed."
      )
    return body as T
  }
  function acceptReload(next: GalleryEditorData, keepEdits: boolean) {
    setData(next)
    if (!keepEdits) {
      setDraft(next.draft)
      setDirty(false)
    }
    setPendingReload(null)
    setConfirmations({})
  }
  async function reload(keepEdits = dirty) {
    const next = await decode<GalleryEditorData>(await fetch(endpoint, { cache: "no-store" }))
    if (keepEdits && next.revision !== data.revision) {
      setPendingReload(next)
      setMessage("The saved gallery changed. Your unsaved edits are still here; choose which draft to keep.")
      return
    }
    acceptReload(next, keepEdits)
    setMessage(keepEdits ? "Product refreshed. Your unsaved edits are preserved." : "Loaded saved state.")
  }
  const saveManifest = {
    coverColor: draft.coverColor,
    colors: draft.colors.map((c) => galleryColorSelection(c)!),
  }
  const validation = galleryMutationSchema.options[0].shape.manifest.safeParse(saveManifest)
  async function run(operation: () => Promise<void>) {
    setBusy(true)
    setFailed(false)
    setMessage("")
    try {
      await operation()
    } catch (error) {
      setFailed(true)
      setMessage(error instanceof Error ? error.message : "Reload the saved state before retrying.")
    } finally {
      setBusy(false)
    }
  }
  async function mutate(action: "save" | "activate" | "restore") {
    await run(async () => {
      const common = { action, revision: data.revision, productRevision: data.productRevision }
      const payload =
        action === "save"
          ? { ...common, manifest: saveManifest }
          : action === "activate"
            ? { ...common, confirmations }
            : { ...common, fromRevision: restore }
      const result = await decode<{ status?: string; completed?: number; total?: number; cacheRefreshed?: boolean }>(
        await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        })
      )
      if (result.status === "preparing") {
        setMessage(
          `Prepared ${result.completed} of ${result.total} photos. Nothing activated yet. Select Activate gallery again to resume.`
        )
        return
      }
      await reload(false)
      setMessage(
        action === "activate"
          ? result.cacheRefreshed
            ? "Gallery activated. Your selections now belong to the store."
            : "Gallery activated. Cache refresh was delayed; public pages may take up to five minutes to update."
          : action === "restore"
            ? "Restored to draft. Review before activating."
            : "Draft saved. The shop is unchanged."
      )
    })
  }
  async function upload(file: File) {
    await run(async () => {
      if (!file.size || file.size > 3145728) throw new Error("Choose a photo under 3 MB and upload it again.")
      const asset = await decode<GalleryEditorData["assets"][number]>(
        await fetch(`${endpoint}/assets`, {
          method: "POST",
          headers: { "content-type": file.type, "x-photo-bytes": String(file.size) },
          body: file,
        })
      )
      setData((current) => ({ ...current, assets: [asset, ...current.assets] }))
      setMessage("Photo uploaded privately. Add it to the correct color below.")
    })
  }
  const previewImages = curated
    ? curated.entries.map((e) => ({
        src: photoUrl(e),
        alt: e.alt,
        ...(e.source === "store" ? { origin: "store" as const } : {}),
      }))
    : (color?.providerImages ?? [])
  return (
    <div className="space-y-8">
      <header className="max-w-3xl">
        <h1 className="display-heading">Product photos</h1>
        <p className="mt-3 text-xl">{displayProductTitle(data.title)}</p>
        <p className="mt-3 text-muted-foreground">
          Choose each color’s photos and order. Save privately, review, then activate. Printify republishes will
          preserve your choices.
        </p>
      </header>
      {data.diagnostic && (
        <p role="alert" className="rounded-md border border-destructive p-4">
          {data.diagnostic}
        </p>
      )}
      {!data.active && (
        <p className="rounded-md border p-4">
          This product is no longer published in Printify. You can prepare a draft; republish before activation.
        </p>
      )}
      <div className="grid gap-8 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav aria-label="Photo colors" className="space-y-3">
          {data.colors.map((c) => (
            <button
              type="button"
              key={c.key}
              disabled={busy}
              aria-pressed={selected === c.key}
              onClick={() => {
                setSelected(c.key)
                setPreview(false)
              }}
              className={`min-h-11 w-full rounded-lg border p-4 text-left ${focusRing} ${selected === c.key ? "border-primary bg-primary/5" : "border-border"}`}
            >
              <span className="block font-semibold">{c.title}</span>
              <span className="mt-1 block text-sm text-muted-foreground">
                Live: {c.activeMode}
                {c.activeStale ? " · Needs review" : ""}
                {c.activeInvalid ? " · Unavailable photos" : ""}
                {!c.available ? " · Color unavailable" : ""}
              </span>
            </button>
          ))}
          <label className="block pt-4 text-sm font-medium">
            Shop cover color
            <select
              className={`${field} mt-2`}
              disabled={busy}
              value={draft.coverColor ?? ""}
              onChange={(e) => change({ ...draft, coverColor: e.target.value || null })}
            >
              <option value="">Keep current default</option>
              {draft.coverColor && !data.colors.some((c) => c.key === draft.coverColor && c.available) && (
                <option value={draft.coverColor} disabled>
                  {data.colors.find((c) => c.key === draft.coverColor)?.title ?? "Saved color"} — retained until
                  available
                </option>
              )}
              {data.colors
                .filter((c) => c.available)
                .map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.title}
                  </option>
                ))}
            </select>
          </label>
        </nav>
        <section aria-label={`${color?.title ?? "Selected color"} draft`} className="min-w-0 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold">{color?.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Draft:{" "}
                {curated
                  ? curated.entries.some((e) => e.source === "provider")
                    ? "Mixed selection"
                    : "Store photos only"
                  : "Printify photos"}
              </p>
            </div>
            <Button className="min-h-11" variant="outline" disabled={busy} onClick={() => setPreview(!preview)}>
              {preview ? "Close preview" : "Preview draft"}
            </Button>
          </div>
          {color?.activeInvalid && (
            <p role="alert" className="rounded-md border border-destructive p-4">
              Unavailable photos for {color.title}. Check image storage or replace the affected photos, then review and
              activate this color again.
            </p>
          )}
          {color && !color.available && (
            <div className="space-y-3 rounded-md border p-4">
              <p>
                This color is currently unavailable, so its photos are read-only. Keep its saved selection while
                activating other colors. You can edit it again when it returns.
              </p>
              {different(savedColor) && (
                <Button className="min-h-11" variant="outline" disabled={busy} onClick={() => recoverColor(savedColor)}>
                  Keep saved photos for {color.title}
                </Button>
              )}
              {different(color.recoverySelection) && (
                <>
                  <p>
                    This draft has different photos for this unavailable color. Restore its last active selection to
                    activate other colors; their edits will stay.
                  </p>
                  <Button
                    className="min-h-11"
                    variant="outline"
                    disabled={busy}
                    onClick={() => recoverColor(color.recoverySelection)}
                  >
                    Restore last active selection for {color.title}
                  </Button>
                </>
              )}
            </div>
          )}
          {preview && (
            <div className="mx-auto max-w-lg">
              <p className="mb-3 text-sm">Private draft preview. Photos keep their original framing.</p>
              <ProductImageGallery
                key={`${selected}-${JSON.stringify(previewImages)}`}
                title={data.title}
                images={previewImages}
                artwork={data.artwork && color?.hex ? { ...data.artwork, backgroundColor: color.hex } : null}
                placeholder="No photos selected"
                onSlideSelect={() => undefined}
              />
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            {!curated ? (
              <Button className="min-h-11" disabled={busy || !color?.available} onClick={() => entries([])}>
                {color?.available ? "Choose photos for this color" : "Color currently unavailable"}
              </Button>
            ) : (
              <Button
                className="min-h-11"
                variant="outline"
                disabled={busy || readOnly}
                onClick={() => change({ ...draft, colors: draft.colors.filter((c) => c.colorKey !== selected) })}
              >
                Use Printify photos
              </Button>
            )}
            <label className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-border bg-background px-4 text-sm font-medium focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring hover:bg-muted has-disabled:cursor-not-allowed has-disabled:opacity-50">
              Upload photo
              <input
                className="sr-only"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ""
                  if (file) void upload(file)
                }}
              />
            </label>
          </div>
          <p className="text-sm text-muted-foreground">
            JPEG, PNG or WebP · up to 3 MB · at least 800 × 800 pixels. Uploads stay private until activation.
          </p>
          {curated && (
            <>
              <div>
                <h3 className="font-semibold">Selected photos · {curated.entries.length}/12</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  First photo is this color’s cover. Use the arrows to change order.
                </p>
              </div>
              {!curated.entries.length && (
                <p className="rounded-lg border border-dashed border-border p-6">
                  This color is waiting for its close-up. Add at least one photo below before saving.
                </p>
              )}
              <ol className="space-y-4">
                {curated.entries.map((entry, index) => (
                  <li
                    key={entryKey(entry)}
                    className="grid gap-4 rounded-lg border p-4 sm:grid-cols-[112px_minmax(0,1fr)]"
                  >
                    <Image
                      src={photoUrl(entry)}
                      alt={entry.alt}
                      width={112}
                      height={140}
                      className="aspect-[4/5] w-28 object-contain"
                      unoptimized={!canOptimizeProductImage(photoUrl(entry))}
                    />
                    <div className="min-w-0 space-y-3">
                      <label className="block text-sm">
                        Photo {index + 1} description
                        <input
                          className={`${field} mt-1`}
                          disabled={busy || readOnly}
                          maxLength={300}
                          value={entry.alt}
                          onChange={(e) => edit(index, { alt: e.target.value })}
                        />
                      </label>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block text-sm">
                          Role
                          <select
                            className={`${field} mt-1`}
                            disabled={busy || readOnly}
                            value={entry.role}
                            onChange={(e) => edit(index, { role: e.target.value as GalleryEntry["role"] })}
                          >
                            {roles.map((role) => (
                              <option key={role} value={role}>
                                {role.replaceAll("-", " ")}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block text-sm">
                          {entry.source === "provider" ? "Matching view (from Printify)" : "Matching view (optional)"}
                          <input
                            className={`${field} mt-1`}
                            disabled={busy || readOnly}
                            readOnly={entry.source === "provider"}
                            value={entry.viewKey ?? ""}
                            maxLength={80}
                            placeholder="front"
                            onChange={(e) => edit(index, { viewKey: e.target.value || undefined })}
                          />
                        </label>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          className="min-h-11 aria-disabled:opacity-50"
                          variant="outline"
                          focusableWhenDisabled
                          ref={moveButton(entry, -1)}
                          aria-label={`Move photo ${index + 1} up`}
                          disabled={busy || readOnly || index === 0}
                          onClick={() => move(index, -1)}
                        >
                          ↑ Up
                        </Button>
                        <Button
                          className="min-h-11 aria-disabled:opacity-50"
                          variant="outline"
                          focusableWhenDisabled
                          ref={moveButton(entry, 1)}
                          aria-label={`Move photo ${index + 1} down`}
                          disabled={busy || readOnly || index === curated.entries.length - 1}
                          onClick={() => move(index, 1)}
                        >
                          ↓ Down
                        </Button>
                        <Button
                          className="min-h-11"
                          variant="ghost"
                          aria-label={`Remove photo ${index + 1}`}
                          disabled={busy || readOnly}
                          onClick={() => entries(curated.entries.filter((_, i) => i !== index))}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
              <h3 className="font-semibold">Available photos</h3>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
                {data.assets.map((asset, index) => (
                  <button
                    type="button"
                    key={asset.id}
                    disabled={
                      busy ||
                      readOnly ||
                      curated.entries.length >= 12 ||
                      curated.entries.some((e) => e.source === "store" && e.assetId === asset.id)
                    }
                    onClick={() =>
                      entries([
                        ...curated.entries,
                        {
                          source: "store",
                          assetId: asset.id,
                          alt: `${displayProductTitle(data.title)} in ${color?.title}`.slice(0, 300),
                          role: "other",
                        },
                      ])
                    }
                    className={`rounded-lg border border-border p-3 text-left ${focusRing} disabled:opacity-40`}
                  >
                    <Image
                      src={`${endpoint}/assets/${asset.id}`}
                      alt={`Uploaded photo ${index + 1}`}
                      width={200}
                      height={250}
                      unoptimized
                      className="aspect-[4/5] w-full object-contain"
                    />
                    <span className="mt-2 block text-sm">Add uploaded photo {index + 1}</span>
                  </button>
                ))}
                {color?.providerImages.map((image, index) => (
                  <button
                    type="button"
                    key={image.src}
                    disabled={
                      busy ||
                      readOnly ||
                      !image.selectable ||
                      curated.entries.length >= 12 ||
                      curated.entries.some((e) => e.source === "provider" && e.src === image.src)
                    }
                    onClick={() =>
                      entries([
                        ...curated.entries,
                        {
                          source: "provider",
                          src: image.src,
                          sha256: "",
                          sourceRevision: data.productRevision,
                          alt: image.alt,
                          role: "garment",
                          ...(image.viewKey ? { viewKey: image.viewKey } : {}),
                        },
                      ])
                    }
                    className={`rounded-lg border border-border p-3 text-left ${focusRing} disabled:opacity-40`}
                  >
                    <Image
                      src={image.src}
                      alt={image.alt}
                      width={200}
                      height={250}
                      unoptimized={!canOptimizeProductImage(image.src)}
                      className="aspect-[4/5] w-full object-contain"
                    />
                    <span className="mt-2 block text-sm">
                      {image.selectable
                        ? `Add Printify photo ${index + 1}${image.viewKey ? ` · ${image.viewKey}` : ""}`
                        : "Needs image backfill"}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
      <section aria-label="Save and activate" className="space-y-4 border-t border-border pt-6">
        <p className="text-sm">
          {dirty
            ? "You have unsaved changes. Save before reviewing for activation."
            : "Review the saved draft before activating it for customers."}
        </p>
        {!dirty &&
          draft.colors
            .filter((c) => {
              const current = data.colors.find((v) => v.key === c.colorKey)
              return current?.available && !current.draftCurrent
            })
            .map((c) => {
              const current = data.colors.find((v) => v.key === c.colorKey)
              return (
                <label key={c.colorKey} className="flex max-w-3xl items-start gap-3 rounded-md border p-4">
                  <input
                    type="checkbox"
                    className="mt-1 size-5 accent-primary"
                    disabled={busy || !current?.binding}
                    checked={Boolean(confirmations[c.colorKey])}
                    onChange={(e) =>
                      setConfirmations((old) => {
                        const next = { ...old }
                        if (e.target.checked && current?.binding) next[c.colorKey] = current.binding.digest
                        else delete next[c.colorKey]
                        return next
                      })
                    }
                  />
                  <span>
                    I reviewed {current?.title ?? c.colorKey}: these photos show the current garment, color, artwork and
                    print placement.
                    {!current?.binding && " Production details are unavailable; republish before review."}
                  </span>
                </label>
              )
            })}
        {!validation.success && (
          <div role="alert" className="max-w-3xl rounded-md border border-destructive p-4">
            <p>Before saving, fix these photo choices:</p>
            <ul className="mt-2 list-disc pl-5">
              {validation.error.issues.map((issue, index) => {
                const colorIndex = typeof issue.path[1] === "number" ? issue.path[1] : undefined
                const invalidColor = colorIndex === undefined ? undefined : draft.colors[colorIndex]
                const name = data.colors.find((c) => c.key === invalidColor?.colorKey)?.title
                const photoIndex = typeof issue.path[3] === "number" ? issue.path[3] + 1 : undefined
                return (
                  <li key={index}>
                    {name ? `${name}: ` : ""}
                    {photoIndex ? `Photo ${photoIndex}, ` : ""}
                    {issue.path.at(-1) === "alt"
                      ? "enter a description (1–300 characters)."
                      : issue.path.at(-1) === "viewKey"
                        ? "use letters, numbers, hyphens or underscores for the matching view."
                        : issue.path.at(-1) === "entries"
                          ? "choose between 1 and 12 photos or use Printify photos for this color."
                          : issue.message}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
        {pendingReload && (
          <div role="alert" className="space-y-3 rounded-md border p-4">
            <p>
              Another change was saved to this gallery. Keeping your edits will replace that draft on your next save.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                className="min-h-11"
                disabled={busy}
                variant="outline"
                onClick={() => {
                  acceptReload(pendingReload, true)
                  setMessage("Your edits are preserved. Review them before saving over the latest draft.")
                }}
              >
                Keep my edits over latest draft
              </Button>
              <Button
                className="min-h-11"
                disabled={busy}
                variant="outline"
                onClick={() => {
                  acceptReload(pendingReload, false)
                  setMessage("Discarded local edits and loaded the saved draft.")
                }}
              >
                Discard my edits and load saved draft
              </Button>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            className="min-h-11"
            disabled={busy || !dirty || !validation.success || Boolean(pendingReload)}
            onClick={() => void mutate("save")}
          >
            Save draft
          </Button>
          <Button
            className="min-h-11"
            variant="outline"
            disabled={busy || dirty || !data.revision || !data.active || Boolean(pendingReload)}
            onClick={() => void mutate("activate")}
          >
            Activate gallery
          </Button>
          <Button
            className="min-h-11"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await reload()
              })
            }
          >
            Refresh product
          </Button>
        </div>
        {message && (
          <p
            role={failed ? "alert" : "status"}
            className={`max-w-3xl rounded-md border p-4 ${failed ? "border-destructive" : "border-border"}`}
          >
            {message}
          </p>
        )}
        {busy && (
          <p role="status" className="text-sm">
            Saving photo choices…
          </p>
        )}
      </section>
      {data.history.length > 0 && (
        <details className="border-t border-border pt-6">
          <summary className={`flex min-h-11 cursor-pointer items-center font-medium ${focusRing}`}>
            Saved history
          </summary>
          <p className="my-3 max-w-2xl text-sm text-muted-foreground">
            Restoring replaces the draft only. Previously public photo URLs may remain accessible after removal.
          </p>
          <div className="flex max-w-2xl flex-wrap gap-3">
            <select
              aria-label="Saved revision"
              className={`${field} min-w-0 flex-1`}
              disabled={busy}
              value={restore}
              onChange={(e) => setRestore(e.target.value)}
            >
              <option value="">Choose a saved revision</option>
              {data.history.map((h) => (
                <option key={h.revision} value={h.revision}>
                  {h.action} · {formatStoreMoment(h.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                </option>
              ))}
            </select>
            <Button
              className="min-h-11"
              variant="outline"
              disabled={busy || dirty || !restore}
              onClick={() => void mutate("restore")}
            >
              Restore to draft
            </Button>
          </div>
        </details>
      )}
    </div>
  )
}
