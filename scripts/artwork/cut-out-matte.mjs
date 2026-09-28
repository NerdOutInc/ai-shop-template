/**
 * Remove a flat background matte from raw RGBA pixels, in place.
 *
 * Only the matte connected to the canvas edge is cleared, so ink enclosed by the artwork
 * survives. Edge pixels are unmixed rather than thresholded, which keeps antialiased
 * outlines from gaining a halo of the old background on a new garment.
 *
 * This cannot tell matte-coloured ink from matte. A dark illustration on a dark backdrop
 * loses its shading and no colour test detects it, so every result needs contact-sheet
 * review before it is uploaded. See scripts/artwork/prepare-transparent-prints.mjs.
 */
export function cutOutMatte({ data, width, height }, { tolerance = 32, feather = 20, floor = 12 } = {}) {
  if (width < 2 || height < 2 || data.length !== width * height * 4) return null
  const inset = Math.max(1, Math.floor(Math.min(width, height) * 0.02))
  const ring = []
  for (let y = 0; y < inset; y++)
    for (let x = 0; x < width; x++)
      for (const cy of [y, height - y - 1]) {
        const offset = (cy * width + x) * 4
        // Artwork that already carries alpha keeps it exactly; there is nothing to unmix.
        if (data[offset + 3] < 250) return null
        ring.push([data[offset], data[offset + 1], data[offset + 2]])
      }
  for (let x = 0; x < inset; x++)
    for (let y = inset; y < height - inset; y++)
      for (const cx of [x, width - x - 1]) {
        const offset = (y * width + cx) * 4
        if (data[offset + 3] < 250) return null
        ring.push([data[offset], data[offset + 1], data[offset + 2]])
      }
  const matte = [0, 1, 2].map(
    (channel) => ring.map((color) => color[channel]).sort((first, second) => first - second)[Math.floor(ring.length / 2)]
  )
  // A photograph or a patterned border is not a matte that can be subtracted.
  const noisy = ring.filter((color) => color.some((value, channel) => Math.abs(value - matte[channel]) > 24)).length
  if (noisy / ring.length > 0.02) return null

  const distance = (offset) =>
    Math.max(
      Math.abs(data[offset] - matte[0]),
      Math.abs(data[offset + 1] - matte[1]),
      Math.abs(data[offset + 2] - matte[2])
    )
  const visited = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  let head = 0,
    tail = 0
  const visit = (pixel) => {
    if (visited[pixel]) return
    visited[pixel] = 1
    if (distance(pixel * 4) <= tolerance) queue[tail++] = pixel
  }
  for (let x = 0; x < width; x++) {
    visit(x)
    visit((height - 1) * width + x)
  }
  for (let y = 0; y < height; y++) {
    visit(y * width)
    visit(y * width + width - 1)
  }
  while (head < tail) {
    const pixel = queue[head++]
    const x = pixel % width
    if (x > 0) visit(pixel - 1)
    if (x < width - 1) visit(pixel + 1)
    if (pixel >= width) visit(pixel - width)
    if (pixel < width * (height - 1)) visit(pixel + width)
  }
  // Nothing removed, or everything: neither is a usable cutout.
  if (tail < width + height || tail === width * height) return null

  for (let index = 0; index < tail; index++) {
    const offset = queue[index] * 4
    const alpha = Math.max(0, Math.min(1, (distance(offset) - floor) / feather))
    for (let channel = 0; channel < 3; channel++)
      // Clamped, not just rounded: unmixing a fringe pixel brighter than the matte can
      // exceed 255, and a raw Buffer wraps mod 256, turning a near-white edge near-black.
      data[offset + channel] =
        alpha === 0
          ? 0
          : Math.max(0, Math.min(255, Math.round((data[offset + channel] - matte[channel] * (1 - alpha)) / alpha)))
    data[offset + 3] = Math.round(data[offset + 3] * alpha)
  }
  return {
    matteHex: `#${matte.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`,
    removed: tail / (width * height),
  }
}
