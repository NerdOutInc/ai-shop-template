import "server-only"

export type SignupBody = { status: "read"; value: unknown } | { status: "wrong-type" } | { status: "too-large" }

/**
 * Read a very small JSON body, refusing anything larger before parsing it.
 *
 * A signup is one address, so the cap is tight. Streaming rather than trusting content-length keeps a
 * lying header from getting a large body parsed anyway.
 */
export async function readSignupBody(request: Request, maxBytes = 1_024): Promise<SignupBody> {
  if (!(request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase().startsWith("application/json"))
    return { status: "wrong-type" }
  const declared = Number(request.headers.get("content-length") ?? "")
  if (Number.isFinite(declared) && declared > maxBytes) return { status: "too-large" }

  const reader = request.body?.getReader()
  if (!reader) return { status: "read", value: null }
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      return { status: "too-large" }
    }
    chunks.push(value)
  }
  try {
    return { status: "read", value: JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))) }
  } catch {
    return { status: "read", value: null }
  }
}
