"use client"

import { displayColorName } from "@/lib/display-color-name"

type ColorOption = { value: string; name: string; hex?: string | null; disabled?: boolean }

export function ColorPicker({
  colors,
  value,
  onChange,
  disabled = false,
}: {
  colors: ColorOption[]
  value: string | null
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const selected = colors.find((color) => color.value === value)
  return (
    <fieldset className="product-option" disabled={disabled}>
      <legend>
        Color{" "}
        <span className="ml-1 text-sm font-normal text-muted-foreground">
          {selected ? displayColorName(selected.name) : null}
        </span>
      </legend>
      <div className="product-colors">
        {colors.map((color) => (
          <button
            type="button"
            className="color-option"
            key={color.value}
            title={displayColorName(color.name)}
            aria-label={displayColorName(color.name)}
            aria-pressed={value === color.value}
            disabled={color.disabled}
            onClick={() => onChange(color.value)}
          >
            <span style={{ background: color.hex ?? "#e1ddd3" }} />
          </button>
        ))}
      </div>
    </fieldset>
  )
}
