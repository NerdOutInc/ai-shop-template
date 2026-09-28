import "server-only"

import { CheckoutError } from "./checkout-error"

export async function readCheckoutBody(request: Request, maxBytes = 32_768) {
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") {
    throw new CheckoutError("INVALID_REQUEST", "Please submit your bag as JSON.", 415)
  }
  if (!request.body || Number(request.headers.get("content-length")) > maxBytes)
    throw new CheckoutError("INVALID_REQUEST", "This request is too large.", 413)
  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let body = ""
  let size = 0
  while (true) {
    const part = await reader.read()
    if (part.done) break
    size += part.value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      throw new CheckoutError("INVALID_REQUEST", "This request is too large.", 413)
    }
    body += decoder.decode(part.value, { stream: true })
  }
  body += decoder.decode()
  return body
}
