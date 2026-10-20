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
    async generate(request, references) {
      if (!supportedSizes.includes(request.size))
        throw new Error(`openai supports sizes ${supportedSizes.join(", ")}; choose one of those`)
      const fields = {
        model,
        prompt: request.prompt,
        n: String(request.count),
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
          body: JSON.stringify({ ...fields, n: request.count }),
        })
      }
      const body = await response.json().catch(() => null)
      if (!response.ok) throw translateProviderError("openai", response.status, body)
      const data = Array.isArray(body?.data) ? body.data : []
      if (!data.length || data.some((item) => typeof item.b64_json !== "string"))
        throw new Error("openai returned no base64 image data; nothing was written")
      return {
        requestId: response.headers.get("x-request-id"),
        seed: null,
        images: data.map((item) => ({ bytes: Buffer.from(item.b64_json, "base64"), mimeType: "image/png" })),
        notes: [],
      }
    },
  }
}
