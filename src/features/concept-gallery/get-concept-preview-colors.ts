type PreviewColor = { name: string; hex: string }

export function getConceptPreviewColors(original: PreviewColor): PreviewColor[] {
  const palette = [
    { name: "Sage", hex: "#e4e9e6" },
    { name: "Navy", hex: "#17262d" },
    { name: "Natural", hex: "#fff8ec" },
    { name: "Black", hex: "#202020" },
    { name: "Heather gray", hex: "#c5c5c5" },
  ]
  const channels = (hex: string) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))
  const source = channels(original.hex)
  const distance = (color: PreviewColor) =>
    channels(color.hex).reduce((sum, value, index) => sum + (value - source[index]!) ** 2, 0)
  const closest = palette.reduce((best, color) => (distance(color) < distance(best) ? color : best))
  return [{ name: "Original background", hex: original.hex }, ...palette.filter((color) => color !== closest)]
}
