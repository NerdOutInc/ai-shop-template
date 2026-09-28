import sharp from "sharp"

export function createPublishingImage(pathname: string) {
  const color = pathname.includes("clay") ? "#bc735c" : "#254b41"
  const revision = pathname.includes("revised") ? '<circle cx="300" cy="400" r="18" fill="#ffc7a8"/>' : ""
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="700"><rect width="600" height="700" fill="#edece8"/><path d="M180 130 75 210 130 320 190 295V570H410V295L470 320 525 210 420 130 360 170H240Z" fill="${color}"/>${revision}</svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}
