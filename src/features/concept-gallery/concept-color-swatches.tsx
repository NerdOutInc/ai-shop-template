"use client"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { GarmentColor } from "@/features/design-library/garment-colors"
import { cn } from "@/lib/cn"

export function ConceptColorSwatches({
  colors,
  value,
  onSelect,
  label,
  disabled = false,
  className,
}: {
  colors: GarmentColor[]
  value: string | null
  onSelect: (name: string) => void
  label: string
  disabled?: boolean
  className?: string
}) {
  if (colors.length === 0) return null
  return (
    <ToggleGroup
      aria-label={label}
      value={value ? [value] : []}
      disabled={disabled}
      onValueChange={(values) => {
        if (values[0]) onSelect(values[0])
      }}
      spacing={1}
      className={cn("max-w-full flex-wrap gap-0 rounded-none", className)}
    >
      {colors.map((color) => (
        <ToggleGroupItem
          key={color.name}
          value={color.name}
          aria-label={color.name}
          title={color.name}
          className="size-11 min-w-11 rounded-full p-2 data-pressed:bg-transparent"
        >
          <span
            aria-hidden="true"
            className="size-6 rounded-full border border-foreground/25 in-data-pressed:ring-2 in-data-pressed:ring-foreground in-data-pressed:ring-offset-2 in-data-pressed:ring-offset-background"
            style={{ backgroundColor: color.hex }}
          />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
