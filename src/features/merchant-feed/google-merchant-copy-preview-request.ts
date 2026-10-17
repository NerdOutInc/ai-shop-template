import "server-only"

import { z } from "zod"

const schema = z
  .object({
    expectedRevision: z
      .string()
      .regex(/^[1-9]\d*$/)
      .max(40),
    content: z.string().max(10000),
    origin: z.enum(["generated", "human"]),
    variantIds: z
      .array(z.number().int().safe().nonnegative())
      .min(1)
      .max(10000)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .strict()

export type GoogleCopyPreviewInput = z.infer<typeof schema>

export async function readGoogleMerchantCopyPreviewRequest(request: Request): Promise<GoogleCopyPreviewInput | null> {
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
