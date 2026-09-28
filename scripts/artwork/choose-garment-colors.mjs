/**
 * Choose the five garment colors a design is offered in.
 *
 * The recorded design background is the garment the artist drew for, so its nearest
 * palette color is always kept. The other four are scored on how much of the artwork's
 * ink would still read against them, with a small preference for colors that share the
 * artwork's own hue, and a spacing rule so the five are visibly different choices rather
 * than four shades of the same navy.
 *
 * Readability is measured on actual ink pixels, not on the average color of the canvas:
 * a design that is mostly empty would otherwise score every garment the same.
 */

const channel = (value) => {
  const normalized = value / 255
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}

const pivot = (value) => (value > 216 / 24389 ? Math.cbrt(value) : (24389 * value + 16 * 116) / (116 * 24389))

/** sRGB to CIE Lab (D65), so lightness distance means what the eye means by it. */
export function toLab([red, green, blue]) {
  const r = channel(red),
    g = channel(green),
    b = channel(blue)
  const x = pivot((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047)
  const y = pivot(0.2126 * r + 0.7152 * g + 0.0722 * b)
  const z = pivot((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

export function hexToRgb(hex) {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))
}

export function deltaE(first, second) {
  return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2])
}

/**
 * Ink samples from raw RGBA pixels: transparent pixels and pixels close to the recorded
 * background are the backdrop, not the drawing.
 */
export function sampleInk({ data, width, height }, backgroundRgb, step = 3) {
  const ink = []
  let total = 0
  for (let y = 0; y < height; y += step)
    for (let x = 0; x < width; x += step) {
      const offset = (y * width + x) * 4
      total++
      if (data[offset + 3] < 128) continue
      const rgb = [data[offset], data[offset + 1], data[offset + 2]]
      if (
        backgroundRgb &&
        Math.max(...rgb.map((value, index) => Math.abs(value - backgroundRgb[index]))) <= 26
      )
        continue
      ink.push(toLab(rgb))
    }
  // A design drawn almost entirely in its own background color leaves nothing to judge;
  // fall back to every opaque pixel rather than inventing a preference.
  if (ink.length < total * 0.01) {
    for (let y = 0; y < height; y += step)
      for (let x = 0; x < width; x += step) {
        const offset = (y * width + x) * 4
        if (data[offset + 3] >= 128) ink.push(toLab([data[offset], data[offset + 1], data[offset + 2]]))
      }
  }
  return ink
}

/**
 * Share of ink that keeps a clear lightness separation from the garment, minus what the
 * garment would swallow. Printed ink needs real separation to read across a room, so the
 * bar is 30 L* to count as visible and anything under 20 L* counts as swallowed. Counting only the readable share rewards a garment that suits
 * most of an illustration while erasing the rest, which is how cream lettering ends up
 * offered on a white shirt.
 */
export function readability(ink, garmentLab) {
  if (!ink.length) return { visible: 0, lost: 0, score: 0 }
  let visible = 0,
    lost = 0
  for (const lab of ink) {
    const separation = Math.abs(lab[0] - garmentLab[0])
    if (separation >= 30) visible++
    else if (separation < 20) lost++
  }
  return { visible: visible / ink.length, lost: lost / ink.length, score: Math.max(0, (visible - 2.5 * lost) / ink.length) }
}

/**
 * Losing even a small share of ink is disqualifying, not a deduction. Title lettering is
 * a thin slice of the pixels and the whole point of the shirt, so a garment that swallows
 * it must not win on the strength of the large areas it happens to suit.
 */
export const MAX_LOST_INK = 0.06

/** Small bonus when the garment shares the artwork's own colour family. */
export function hueAffinity(ink, garmentLab) {
  if (!ink.length) return 0
  const chroma = ink.filter((lab) => Math.hypot(lab[1], lab[2]) > 12)
  if (!chroma.length) return 0
  const meanA = chroma.reduce((sum, lab) => sum + lab[1], 0) / chroma.length
  const meanB = chroma.reduce((sum, lab) => sum + lab[2], 0) / chroma.length
  const distance = Math.hypot(garmentLab[1] - meanA, garmentLab[2] - meanB)
  return Math.max(0, 1 - distance / 60)
}

/**
 * Colors the store already sells. A small preference for them keeps a browsing page
 * coherent instead of scattering every design across the loudest end of the palette.
 */
export const STOCKED_COLORS = new Set([
  "CVC Black",
  "CVC Cream",
  "CVC Espresso",
  "CVC Ice Blue",
  "CVC Indigo",
  "CVC Midnight Navy",
  "CVC Military Green",
  "CVC Mint",
  "CVC Sand",
  "CVC White",
  "Heather Columbia Blue",
  "Heather Cool Blue",
  "Heather Forest Green",
  "Heather Maroon",
])

export function chooseGarmentColors(palette, ink, backgroundHex, { count = 5, seed = [] } = {}) {
  const labs = new Map(palette.map((color) => [color.name, toLab(hexToRgb(color.hex))]))
  const chosen = []
  const take = (color) => {
    if (color && !chosen.some((picked) => picked.name === color.name)) chosen.push(color)
  }
  // Colors the store already sells for this design are decisions, not candidates.
  for (const name of seed) take(palette.find((color) => color.name === name))
  if (backgroundHex && chosen.length < count) {
    const backgroundLab = toLab(hexToRgb(backgroundHex))
    // The garment the artist drew for always stays on the list, even if contrast scoring
    // would rank it lower; removing it would hide the design's intended look.
    take(palette.toSorted((a, b) => deltaE(labs.get(a.name), backgroundLab) - deltaE(labs.get(b.name), backgroundLab))[0])
  }
  const scored = palette.map((color) => {
    const lab = labs.get(color.name)
    const read = readability(ink, lab)
    return {
      color,
      lost: read.lost,
      score: 0.78 * read.score + 0.14 * hueAffinity(ink, lab) + (STOCKED_COLORS.has(color.name) ? 0.08 : 0),
    }
  })
  // Artwork that spans the whole lightness range loses something on every garment, so the
  // bar is relative to the best this design can do rather than an absolute anyone can miss.
  const bar = Math.max(MAX_LOST_INK, Math.min(...scored.map((entry) => entry.lost)) + MAX_LOST_INK)
  while (chosen.length < count) {
    const available = scored.filter((entry) => !chosen.some((picked) => picked.name === entry.color.name))
    if (!available.length) break
    const readable = available.filter((entry) => entry.lost <= bar)
    // Spacing keeps the five from being four shades of one navy, but it yields before
    // readability does: a duller set beats a varied set the artwork disappears into.
    const pick =
      [20, 12, 6, 0]
        .map((spacingStep) =>
          (readable.length ? readable : available)
            .filter((entry) =>
              chosen.every((picked) => deltaE(labs.get(entry.color.name), labs.get(picked.name)) >= spacingStep)
            )
            .toSorted((a, b) => b.score - a.score)[0]
        )
        .find(Boolean) ?? available.toSorted((a, b) => a.lost - b.lost)[0]
    take(pick.color)
  }
  return chosen
}
