import { displayColorName } from "@/lib/display-color-name"

type ColorFamily = { name: string; hex: string | null }

// Names win over swatch math: heather textures and pale shades are still their named color.
const families = [
  { name: "Yellow", hex: "#e6c34a", shades: /\b(yellow|banana cream|gold|mustard)\b/i },
  { name: "White", hex: "#f6fbfe", shades: /\b(white|ivory)\b/i },
  { name: "Beige", hex: "#d8c9ad", shades: /\b(beige|cream|sand|natural|oatmeal)\b/i },
  { name: "Black", hex: "#242529", shades: /\bblack\b/i },
  { name: "Gray", hex: "#919291", shades: /\b(gray|grey|charcoal|heavy metal|silver|silk)\b/i },
  { name: "Brown", hex: "#785a43", shades: /\b(brown|espresso|chocolate|tan)\b/i },
  { name: "Red", hex: "#c43d45", shades: /\b(red|cardinal|maroon|burgundy)\b/i },
  { name: "Pink", hex: "#cc8293", shades: /\b(pink|mauve|rose)\b/i },
  { name: "Orange", hex: "#e99d36", shades: /\borange\b/i },
  { name: "Green", hex: "#528360", shades: /\b(green|mint|olive)\b/i },
  { name: "Blue", hex: "#32548a", shades: /\b(blue|navy|indigo|royal|storm|denim|chambray|turquoise)\b/i },
  { name: "Teal", hex: "#35a1a5", shades: /\bteal\b/i },
  { name: "Purple", hex: "#77518f", shades: /\b(purple|violet|lavender)\b/i },
]

export function getColorFamily(officialName: string): ColorFamily {
  const name = displayColorName(officialName)
  const family = families.find((family) => family.shades.test(name))
  // New provider shades stay discoverable until a family is assigned.
  return family ? { name: family.name, hex: family.hex } : { name, hex: null }
}
