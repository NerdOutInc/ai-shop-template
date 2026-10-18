import "server-only"
import { galleryMutationSchema } from "./gallery-mutation-schema"
import { GalleryError } from "./gallery-error"
export async function readGalleryRequest(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json" || !request.body)
    throw new GalleryError("Send a JSON gallery request.", 400)
  const reader = request.body.getReader()
  let value: unknown
  try {
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const part = await reader.read()
      if (part.done) break
      total += part.value.length
      if (total > 131072) {
        await reader.cancel()
        throw new Error("limit")
      }
      chunks.push(part.value)
    }
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)))
  } catch {
    throw new GalleryError("Send a valid gallery request smaller than 128 KB.", 400)
  } finally {
    reader.releaseLock()
  }
  const parsed = galleryMutationSchema.safeParse(value)
  if (!parsed.success)
    throw new GalleryError(
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      400
    )
  return parsed.data
}
