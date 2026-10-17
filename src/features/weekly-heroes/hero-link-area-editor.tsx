"use client"
import { useRef, useState } from "react"
import Image from "next/image"
import { Input } from "@/components/ui/input"
import type { HeroAsset, HeroRect, WeeklyHeroManifest } from "./weekly-hero-schema"

export function HeroLinkAreaEditor({
  kind,
  asset,
  links,
  onChange,
}: {
  kind: "desktop" | "mobile"
  asset: HeroAsset
  links: WeeklyHeroManifest["links"]
  onChange: (index: number, rect: HeroRect) => void
}) {
  const [selected, setSelected] = useState(0)
  const start = useRef<{ x: number; y: number } | null>(null)
  const active = Math.min(selected, links.length - 1)
  const rect = links[active]![kind]
  return (
    <fieldset className="min-w-0 rounded-lg border p-4">
      <legend className="px-2 font-semibold">{kind === "desktop" ? "Desktop" : "Mobile"} link areas</legend>
      <div className="mb-3 flex flex-wrap gap-3">
        {links.map((link, index) => (
          <label key={index} className="inline-flex min-h-11 items-center gap-2">
            <input type="radio" name={`${kind}-area`} checked={active === index} onChange={() => setSelected(index)} />
            {link.label || `Product ${index + 1}`}
          </label>
        ))}
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        Drag a rectangle around the selected shirt and its shop label, or enter percentages below.
        {kind === "desktop" && " Keep links inside the central half; the sides are extra scenery."}
      </p>
      <div
        className={`relative mx-auto touch-none overflow-hidden rounded select-none ${kind === "mobile" ? "max-w-80" : ""}`}
        onPointerDown={(event) => {
          const r = event.currentTarget.getBoundingClientRect()
          start.current = {
            x: ((event.clientX - r.left) / r.width) * 100,
            y: ((event.clientY - r.top) / r.height) * 100,
          }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerUp={(event) => {
          if (!start.current) return
          const r = event.currentTarget.getBoundingClientRect()
          const end = {
            x: Math.max(0, Math.min(100, ((event.clientX - r.left) / r.width) * 100)),
            y: Math.max(0, Math.min(100, ((event.clientY - r.top) / r.height) * 100)),
          }
          const begin = start.current
          start.current = null
          const x = Math.min(begin.x, end.x),
            y = Math.min(begin.y, end.y),
            width = Math.abs(begin.x - end.x),
            height = Math.abs(begin.y - end.y)
          if (width >= 2 && height >= 2)
            onChange(active, {
              x: +x.toFixed(2),
              y: +y.toFixed(2),
              width: +width.toFixed(2),
              height: +height.toFixed(2),
            })
        }}
        onPointerCancel={() => {
          start.current = null
        }}
      >
        <Image
          src={`/api/admin/weekly-heroes/assets/${asset.id}`}
          alt={`${kind} composition with editable link boundaries`}
          width={asset.width}
          height={asset.height}
          unoptimized
          draggable={false}
          className="h-auto w-full"
        />
        {kind === "desktop" && (
          <div className="pointer-events-none absolute inset-y-0 left-1/4 w-1/2 border-x-2 border-dashed border-white/70" />
        )}
        {links.map((link, index) => (
          <div
            key={index}
            className={`pointer-events-none absolute rounded border-2 ${index === active ? "border-white bg-white/20" : "border-yellow-300 bg-yellow-300/10"}`}
            style={{
              left: `${link[kind].x}%`,
              top: `${link[kind].y}%`,
              width: `${link[kind].width}%`,
              height: `${link[kind].height}%`,
            }}
          >
            <span className="bg-black px-1 text-xs text-white">{index + 1}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(["x", "y", "width", "height"] as const).map((key) => (
          <label key={key} className="text-sm">
            {key === "x" ? "Left %" : key === "y" ? "Top %" : `${key} %`}
            <Input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={rect[key]}
              onChange={(e) => onChange(active, { ...rect, [key]: Number(e.target.value) })}
            />
          </label>
        ))}
      </div>
    </fieldset>
  )
}
