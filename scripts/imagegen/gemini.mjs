import { translateProviderError } from "./errors.mjs"
import { parseImageSize } from "./request.mjs"

const aspectRatios = {
  "1024x1024": "1:1",
  "1536x1024": "3:2",
  "1024x1536": "2:3",
  "1792x1024": "16:9",
  "1024x1792": "9:16",
}
// Only the Gemini 3 image models take a configurable imageSize; gemini-2.5-flash-image renders at
// a fixed resolution and rejects the field, so "high" must not reach it.
const configurableSize = /^gemini-3/

/** Gemini image generation through generateContent, one call per requested image. */
export function createGeminiProvider({ key, environment = process.env, fetcher = fetch }) {
  const model = environment.IMAGE_MODEL || "gemini-2.5-flash-image"
  const baseUrl = (environment.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/$/, "")
  const twoK = (request) => request.quality === "high"
  return {
    name: "gemini",
    model,
    describe() {
      return { endpoint: `models/${model}:generateContent`, model }
    },
    validate(request) {
      if (twoK(request) && !configurableSize.test(model))
        throw new Error(
          `${model} renders at a fixed resolution and does not accept quality "high" (2K); use quality auto, low or medium, or set IMAGE_MODEL to a Gemini 3 image model`
        )
    },
    async generate(request, references, writer) {
      this.validate(request)
      const prompt =
        request.background === "transparent"
          ? `${request.prompt}\n\nOutput a PNG with a fully transparent background (alpha channel), no backdrop, no checkerboard.`
          : request.prompt
      const parts = [
        { text: prompt },
        ...references.map((reference) => ({
          inlineData: { mimeType: reference.mimeType, data: reference.data.toString("base64") },
        })),
      ]
      const imageConfig = {
        ...(parseImageSize(request.size) ? { aspectRatio: aspectRatios[request.size] } : {}),
        ...(twoK(request) ? { imageSize: "2K" } : {}),
      }
      while (writer.completed < request.count) {
        const response = await fetcher(`${baseUrl}/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "x-goog-api-key": key, "content-type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: { responseModalities: ["IMAGE"], imageConfig },
          }),
        })
        const body = await response.json().catch(() => null)
        if (!response.ok) throw translateProviderError("gemini", response.status, body, { key })
        const image = body?.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData
        if (!image) {
          const reason = body?.candidates?.[0]?.finishReason ?? body?.promptFeedback?.blockReason
          throw new Error(`gemini returned no image${reason ? ` (${reason})` : ""}`)
        }
        await writer.add(
          { bytes: Buffer.from(image.data, "base64"), mimeType: image.mimeType || "image/png" },
          { requestId: body.responseId ?? null }
        )
      }
      return {
        notes:
          request.background === "transparent"
            ? ["gemini does not guarantee an alpha channel; check alphaChannel and the decoded pixels before use"]
            : [],
      }
    },
  }
}
