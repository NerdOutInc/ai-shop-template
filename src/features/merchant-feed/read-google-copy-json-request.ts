import "server-only"

import type { z } from "zod"

export async function readGoogleCopyJsonRequest<T>(request: Request, schema: z.ZodType<T>): Promise<T | null> {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json" ||
    !request.body ||
    Number(request.headers.get("content-length")) > 65536
  )
    return null
  const reader = request.body.getReader()
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true })
    let text = ""
    let size = 0
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > 65536) {
        await reader.cancel()
        return null
      }
      text += decoder.decode(part.value, { stream: true })
    }
    text += decoder.decode()
    const parsed = schema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }
}
