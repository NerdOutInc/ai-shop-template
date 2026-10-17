"use client"
import { formatWeeklyCadence } from "@/features/publishing/format-weekly-cadence"
import Link from "next/link"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { findHeroLinkSpace } from "./find-hero-link-space"
import { HeroLinkAreaEditor } from "./hero-link-area-editor"
import { weeklyHeroSchema, type HeroAsset, type WeeklyHeroDraft, type WeeklyHeroManifest } from "./weekly-hero-schema"

export function WeeklyHeroEditor({
  liveAt,
  initial,
  products,
  now,
}: {
  now: number
  liveAt: string
  initial: WeeklyHeroDraft | null
  products: { productId: string; title: string; colors: string[] }[]
}) {
  const [saved, setSaved] = useState(initial)
  const [manifest, setManifest] = useState<WeeklyHeroManifest>(
    initial?.hero?.manifest ?? {
      title: "",
      alt: "",
      offer: "",
      desktopAssetId: "",
      mobileAssetId: "",
      links: products.slice(0, 2).map((product, index) => ({
        productId: product.productId,
        color: "",
        label: `Shop ${product.title}`.slice(0, 120),
        desktop: { x: 26 + index * 25, y: 22, width: 23, height: 60 },
        mobile: { x: 2, y: 8 + index * 45, width: 96, height: 40 },
      })),
    }
  )
  const [assets, setAssets] = useState<{ desktop: HeroAsset | null; mobile: HeroAsset | null }>({
    desktop: initial?.hero?.desktop ?? null,
    mobile: initial?.hero?.mobile ?? null,
  })
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("")
  const dirty = JSON.stringify(manifest) !== JSON.stringify(saved?.hero?.manifest)
  const updateLink = (index: number, patch: Partial<WeeklyHeroManifest["links"][number]>) =>
    setManifest((m) => ({ ...m, links: m.links.map((link, i) => (i === index ? { ...link, ...patch } : link)) }))
  async function upload(kind: "desktop" | "mobile", file: File) {
    setBusy(true)
    setError("")
    setMessage("")
    try {
      const response = await fetch(`/api/admin/weekly-heroes/assets?kind=${kind}`, {
        method: "POST",
        body: file,
        headers: { "x-hero-bytes": String(file.size) },
      })
      const result = (await response.json()) as { error?: string; asset: HeroAsset }
      if (!response.ok) throw new Error(result.error ?? "The upload failed.")
      setAssets((a) => ({ ...a, [kind]: result.asset }))
      setManifest((m) => ({ ...m, [`${kind}AssetId`]: result.asset.id }))
      setMessage("Image uploaded privately. Save the hero when the composition and links are ready.")
    } catch (error) {
      setError(error instanceof Error ? error.message : "The upload failed.")
    } finally {
      setBusy(false)
    }
  }
  async function save(scheduled: boolean) {
    setError("")
    setMessage("")
    const parsed = weeklyHeroSchema.safeParse(manifest)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the hero details.")
      return
    }
    setBusy(true)
    try {
      const response = await fetch("/api/admin/weekly-heroes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ liveAt, version: saved?.version ?? null, scheduled, manifest: parsed.data }),
      })
      const result = (await response.json()) as { error?: string; draft: WeeklyHeroDraft }
      if (!response.ok) throw new Error(result.error ?? "The hero could not be saved.")
      setSaved(result.draft)
      if (!result.draft?.hero)
        throw new Error("The saved hero could not be read. Reload to recover its current revision.")
      setManifest(result.draft.hero.manifest)
      setMessage(
        scheduled
          ? "Hero approved for this week. It appears only during its week, with all linked products in the lineup and visible in the shop."
          : "Draft saved privately. The homepage uses the configured store homepage until this week has an approved hero."
      )
    } catch (error) {
      setError(error instanceof Error ? error.message : "The hero could not be saved.")
    } finally {
      setBusy(false)
    }
  }
  async function withdraw() {
    if (!saved) return
    setBusy(true)
    setError("")
    setMessage("")
    try {
      const response = await fetch("/api/admin/weekly-heroes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ liveAt, version: saved.version }),
      })
      const result = (await response.json()) as { draft: WeeklyHeroDraft; error?: string }
      if (!response.ok) throw new Error(result.error ?? "Could not withdraw the hero.")
      setSaved(result.draft)
      setMessage("Hero withdrawn. New public image requests are blocked; unsaved editor changes are preserved.")
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not withdraw the hero.")
    } finally {
      setBusy(false)
    }
  }
  const missing = manifest.links.some((link) => !products.some((p) => p.productId === link.productId))
  return (
    <div className="flex flex-col gap-6">
      <p className="rounded-lg border bg-muted p-4 text-sm">
        {saved?.scheduled ? "Approved for this week" : saved ? "Private draft" : "No hero yet"}.{" "}
        {dirty && "Unsaved changes. "}Products and hero share {formatWeeklyCadence()}. An absent or mismatched hero
        shows the configured store homepage with a Shop link.
      </p>
      {saved && !saved.hero && (
        <p role="alert" className="rounded border border-destructive p-4">
          This saved hero cannot be previewed. Upload valid images and save a replacement draft, or withdraw the
          approved hero. Its saved revision is retained so another tab’s changes stay protected.
        </p>
      )}
      {products.length < 1 || missing ? (
        <p role="alert" className="rounded border border-destructive p-4">
          Schedule all featured products in this week first. If you moved a product, update these links before
          scheduling the hero.
        </p>
      ) : null}
      <fieldset disabled={busy} className="grid gap-5 rounded-lg border p-4 sm:p-6">
        <legend className="px-2 font-semibold">Hero details</legend>
        <label>
          Design name
          <Input
            value={manifest.title}
            onChange={(e) => setManifest({ ...manifest, title: e.target.value })}
            maxLength={120}
          />
        </label>
        <label>
          Image description
          <Input
            value={manifest.alt}
            onChange={(e) => setManifest({ ...manifest, alt: e.target.value })}
            maxLength={600}
          />
          <span className="text-sm text-muted-foreground">
            Describe the products and the scene for someone who cannot see the image.
          </span>
        </label>
        <label>
          Offer shown in the artwork (optional)
          <Input
            value={manifest.offer}
            onChange={(e) => setManifest({ ...manifest, offer: e.target.value })}
            maxLength={120}
          />
        </label>
        <div className="grid gap-5 sm:grid-cols-2">
          {(["desktop", "mobile"] as const).map((kind) => (
            <label key={kind} className="flex flex-col gap-2">
              {kind === "desktop" ? "Desktop panorama · 3:1" : "Mobile composition · 4:7"}
              <Input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void upload(kind, file)
                  e.target.value = ""
                }}
              />
              <span className="text-sm text-muted-foreground">
                {kind === "desktop"
                  ? "At least 1800px wide. Keep essential text and linked products in the central half."
                  : "At least 800px wide. Design for phones; do not crop the desktop poster."}{" "}
                Include all lettering and shop labels. Maximum 3 MB per image.
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset disabled={busy} className="grid gap-5 rounded-lg border p-4 sm:grid-cols-2 sm:p-6">
        <legend className="px-2 font-semibold">Product destinations</legend>
        {manifest.links.map((link, index) => {
          const product = products.find((p) => p.productId === link.productId)
          return (
            <div key={index} className="flex min-w-0 flex-col gap-3">
              <label>
                Product {index + 1}
                <NativeSelect
                  className="w-full"
                  value={link.productId}
                  onChange={(e) => updateLink(index, { productId: e.target.value, color: "" })}
                >
                  <NativeSelectOption value="">Choose a scheduled product</NativeSelectOption>
                  {products.map((p) => (
                    <NativeSelectOption value={p.productId} key={p.productId}>
                      {p.title}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              <label>
                Garment color
                <NativeSelect
                  className="w-full"
                  value={link.color}
                  onChange={(e) => updateLink(index, { color: e.target.value })}
                >
                  <NativeSelectOption value="">Product’s default color</NativeSelectOption>
                  {product?.colors.map((color) => (
                    <NativeSelectOption key={color}>{color}</NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              <label>
                Accessible shop label
                <Input value={link.label} onChange={(e) => updateLink(index, { label: e.target.value })} />
              </label>
              <Button
                type="button"
                variant="outline"
                disabled={manifest.links.length <= 1}
                onClick={() => setManifest((m) => ({ ...m, links: m.links.filter((_, i) => i !== index) }))}
              >
                Remove destination {index + 1}
              </Button>
            </div>
          )
        })}
        <Button
          type="button"
          variant="outline"
          disabled={manifest.links.length >= Math.min(6, products.length)}
          onClick={() => {
            const product = products.find((p) => !manifest.links.some((link) => link.productId === p.productId))
            if (!product) return
            const desktop = findHeroLinkSpace(
              manifest.links.map((link) => link.desktop),
              "desktop"
            )
            const mobile = findHeroLinkSpace(
              manifest.links.map((link) => link.mobile),
              "mobile"
            )
            if (!desktop || !mobile) {
              setError("Make room for another destination in both images before adding it.")
              return
            }
            setError("")
            setMessage("Destination added in free space. Draw its actual product area before approving the hero.")
            setManifest((m) => ({
              ...m,
              links: [
                ...m.links,
                {
                  productId: product.productId,
                  color: "",
                  label: `Shop ${product.title}`.slice(0, 120),
                  desktop,
                  mobile,
                },
              ],
            }))
          }}
        >
          Add product destination
        </Button>
      </fieldset>
      <fieldset disabled={busy} className={`grid min-w-0 gap-6 ${busy ? "pointer-events-none" : ""}`}>
        {(["desktop", "mobile"] as const).map(
          (kind) =>
            assets[kind] &&
            manifest.links.length > 0 && (
              <HeroLinkAreaEditor
                key={kind}
                kind={kind}
                asset={assets[kind]!}
                links={manifest.links}
                onChange={(index, rect) => updateLink(index, { [kind]: rect })}
              />
            )
        )}
      </fieldset>
      {error && (
        <p role="alert" className="rounded border border-destructive p-4 text-destructive">
          {error}
        </p>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" disabled={busy || missing} onClick={() => void save(false)}>
          {saved?.scheduled ? "Save as private draft" : "Save private draft"}
        </Button>
        <Button disabled={busy || missing} onClick={() => void save(true)}>
          {Date.parse(liveAt) <= now ? "Publish this week’s hero" : "Approve and schedule hero"}
        </Button>
        {saved?.scheduled && (
          <Button variant="outline" disabled={busy} onClick={() => void withdraw()}>
            Withdraw approved hero
          </Button>
        )}
        {saved?.hero && !dirty && (
          <Link
            className="inline-flex min-h-11 items-center underline underline-offset-4"
            href={`/admin/products/heroes/${encodeURIComponent(liveAt)}/preview`}
          >
            Preview saved hero
          </Link>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Review both screen sizes and product links before scheduling. Use the original high-resolution artwork, measured
        provider placement, and the actual garment construction. Check any prices or offers against your current store
        settings.
      </p>
    </div>
  )
}
