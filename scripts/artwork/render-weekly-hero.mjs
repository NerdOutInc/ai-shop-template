import sharp from "sharp"

/** Uniform transforms stay fractional until both edges reach the final canvas. */
export async function renderWeeklyHero(plan, composition, input) {
  const width = composition.outputWidth
  const scale = width / composition.background.width
  const edge = (value) => Math.floor(value + 0.5)
  const height = edge(composition.background.height * scale)
  if (width * height > 40_000_000) throw new Error("Hero exceeds the upload pixel budget")
  const layers = []
  for (const placement of composition.garments) {
    const garment = plan.garments[placement.garment]
    if (!garment) throw new Error(`Unknown garment: ${placement.garment}`)
    const artwork = await input(garment.artwork),
      blank = await input(garment.blank)
    await input(garment.photo)
    const ratio = (placement.width * scale) / garment.blank.width
    const x = placement.left * scale,
      y = placement.top * scale
    const left = edge(x),
      top = edge(y)
    const bounds = garment.photoInkMeasurement.bounds,
      origin = garment.photoCutoutOrigin
    if (Math.abs(bounds.height - (bounds.width * garment.artwork.height) / garment.artwork.width) > 1)
      throw new Error("Measured ink must preserve the original artwork aspect ratio")
    const inkLeft = edge(x + (bounds.left - origin.left) * ratio)
    const inkTop = edge(y + (bounds.top - origin.top) * ratio)
    const inkWidth = edge(x + (bounds.left - origin.left + bounds.width) * ratio) - inkLeft
    const inkHeight = edge(y + (bounds.top - origin.top + bounds.height) * ratio) - inkTop
    // Sample the original ink at final size; never enlarge an earlier printed garment.
    const ink = await sharp(artwork).resize(inkWidth, inkHeight, { fit: "fill", kernel: "lanczos3" }).png().toBuffer()
    let layer = await sharp(blank)
      .resize(edge(x + garment.blank.width * ratio) - left, edge(y + garment.blank.height * ratio) - top, {
        fit: "fill",
        kernel: "lanczos3",
      })
      .composite([{ input: ink, left: inkLeft - left, top: inkTop - top }])
      .png()
      .toBuffer()
    if (placement.angle)
      layer = await sharp(layer).rotate(placement.angle, { background: "#00000000" }).png().toBuffer()
    layers.push({ input: layer, left, top })
  }
  for (const overlay of composition.overlays) {
    let layer = await sharp(await input(overlay.source))
      .resize({ width: edge(overlay.width * scale), kernel: "lanczos3" })
      .png()
      .toBuffer()
    if (overlay.angle) layer = await sharp(layer).rotate(overlay.angle, { background: "#00000000" }).png().toBuffer()
    if (overlay.shadow) {
      const shadow = await sharp(layer)
        .linear([0, 0, 0, 1], [...overlay.shadow.rgb, 0])
        .blur(overlay.shadow.blur * scale)
        .png()
        .toBuffer()
      layers.push({
        input: shadow,
        left: edge((overlay.left + overlay.shadow.x) * scale),
        top: edge((overlay.top + overlay.shadow.y) * scale),
      })
    }
    layers.push({ input: layer, left: edge(overlay.left * scale), top: edge(overlay.top * scale) })
  }
  const png = await sharp(await input(composition.background))
    .resize(width, height, { fit: "fill", kernel: "lanczos3" })
    .composite(layers)
    .png()
    .toBuffer()
  const webp = await sharp(png).webp(composition.webpOptions).toBuffer()
  return { png, webp, width, height }
}
