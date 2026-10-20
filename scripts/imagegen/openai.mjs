import { translateProviderError } from "./errors.mjs"

const supportedSizes = ["auto", "1024x1024", "1536x1024", "1024x1536"]

/** OpenAI Images: generations without references, edits when reference images guide the output. */
export function createOpenAiProvider({ key, environment = process.env, fetcher = fetch }) {
  const model = environment.IMAGE_MODEL || "gpt-image-1"
  const baseUrl = (environment.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "")
  return {
    name: "openai",
    model,
    describe(request) {
      return { endpoint: request.referenceImages.length ? "images/edits" : "images/generations", model }
    },
    /** Reject what the provider would reject, before a dry run reports it or a request is billed. */
    validate(request) {
      if (!supportedSizes.includes(request.size))
        throw new Error(`openai supports sizes ${supportedSizes.join(", ")}; choose one of those`)
    },
    async generate(request, references, writer) {
      this.validate(request)
      const remaining = request.count - writer.completed
      const fields = {
        model,
        prompt: request.prompt,
        n: String(remaining),
        size: request.size,
        quality: request.quality,
        background: request.background,
        output_format: "png",
      }
      let response
      if (references.length) {
        const form = new FormData()
        for (const [name, value] of Object.entries(fields)) form.append(name, value)
        for (const reference of references)
          form.append(
            "image[]",
            new Blob([new Uint8Array(reference.data)], { type: reference.mimeType }),
            reference.fileName
          )
        response = await fetcher(`${baseUrl}/images/edits`, {
          method: "POST",
          headers: { authorization: `Bearer ${key}` },
          body: form,
        })
      } else {
        response = await fetcher(`${baseUrl}/images/generations`, {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({ ...fields, n: remaining }),
        })
      }
      const body = await response.json().catch(() => null)
      if (!response.ok) throw translateProviderError("openai", response.status, body, { key })
      const data = Array.isArray(body?.data) ? body.data : []
      if (!data.length || data.some((item) => typeof item.b64_json !== "string"))
        throw new Error("openai returned no base64 image data; nothing was written")
      const requestId = response.headers.get("x-request-id")
      for (const item of data.slice(0, remaining))
        await writer.add({ bytes: Buffer.from(item.b64_json, "base64"), mimeType: "image/png" }, { requestId })
      return { notes: [] }
    },
  }
}
