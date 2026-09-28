const cameraLabel = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/

export function readProductImageViewKey(image: {
  src: string
  source_src?: unknown
  view_key?: unknown
}): string | undefined {
  if (typeof image.view_key === "string" && cameraLabel.test(image.view_key)) return image.view_key
  for (const source of [image.source_src, image.src]) {
    if (typeof source !== "string") continue
    try {
      const url = new URL(source)
      if (
        url.protocol !== "https:" ||
        url.hostname !== "images-api.printify.com" ||
        url.username ||
        url.password ||
        url.port ||
        !url.pathname.startsWith("/mockup/")
      ) {
        continue
      }
      const label = url.searchParams.get("camera_label")
      if (label && cameraLabel.test(label)) return label
    } catch {
      // A missing or malformed label leaves the photo usable without a matched view.
    }
  }
  return undefined
}
