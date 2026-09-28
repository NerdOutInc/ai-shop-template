type PreviewPixels = { data: Uint8ClampedArray; width: number; height: number }

/** Removes only the connected outer matte; enclosed ink of the same color stays intact. */
export function prepareConceptPreview({ data, width, height }: PreviewPixels): string | null {
  if (width < 2 || height < 2 || data.length !== width * height * 4) return null
  const corners: number[][] = []
  const inset = Math.max(1, Math.floor(Math.min(width, height) * 0.02))
  for (let y = 0; y < inset; y++) {
    for (let x = 0; x < inset; x++) {
      for (const [cx, cy] of [
        [x, y],
        [width - x - 1, y],
        [x, height - y - 1],
        [width - x - 1, height - y - 1],
      ]) {
        const offset = (cy! * width + cx!) * 4
        // Already-transparent artwork must retain its alpha and edge colors exactly.
        if (data[offset + 3]! < 250) return null
        corners.push([data[offset]!, data[offset + 1]!, data[offset + 2]!])
      }
    }
  }
  const background = [0, 1, 2].map(
    (channel) => corners.map((color) => color[channel]!).sort((a, b) => a - b)[Math.floor(corners.length / 2)]!
  )
  const distance = (offset: number) =>
    Math.max(
      Math.abs(data[offset]! - background[0]!),
      Math.abs(data[offset + 1]! - background[1]!),
      Math.abs(data[offset + 2]! - background[2]!)
    )
  // A photograph or a multicolor border is not a flat matte. Leave it for manual preparation.
  if (corners.some((color) => color.some((value, channel) => Math.abs(value - background[channel]!) > 24))) return null

  const visited = new Uint8Array(width * height)
  const queue = new Uint32Array(width * height)
  let head = 0
  let tail = 0
  const visit = (pixel: number) => {
    if (visited[pixel]) return
    visited[pixel] = 1
    if (distance(pixel * 4) <= 32) queue[tail++] = pixel
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
    const pixel = queue[head++]!
    const x = pixel % width
    if (x > 0) visit(pixel - 1)
    if (x < width - 1) visit(pixel + 1)
    if (pixel >= width) visit(pixel - width)
    if (pixel < width * (height - 1)) visit(pixel + width)
  }
  // Refuse blank images or a matte that cannot be separated from the artwork.
  if (tail === width * height || tail < width + height) return null
  for (let index = 0; index < tail; index++) {
    const offset = queue[index]! * 4
    const alpha = Math.max(0, Math.min(1, (distance(offset) - 12) / 20))
    for (let channel = 0; channel < 3; channel++) {
      data[offset + channel] =
        alpha === 0 ? 0 : Math.round((data[offset + channel]! - background[channel]! * (1 - alpha)) / alpha)
    }
    data[offset + 3] = Math.round(data[offset + 3]! * alpha)
  }
  return `#${background.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`
}
