"use client"

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
  return (
    <fieldset className="product-option" disabled={disabled}>
      <legend>
        Color{" "}
        <span className="ml-1 text-sm font-normal text-muted-foreground">
          {colors.find((color) => color.value === value)?.name}
        </span>
      </legend>
      <div className="product-colors">
        {colors.map((color) => (
          <button
            type="button"
            className="color-option"
            key={color.value}
            title={color.name}
            aria-label={color.name}
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
