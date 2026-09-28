import { readFileSync } from "node:fs"
import path from "node:path"

import { MockAgent, setGlobalDispatcher } from "undici"

if (
  process.env.ADMIN_E2E !== "true" ||
  process.env.PRIVATE_BLOB_READ_WRITE_TOKEN !== "vercel_blob_rw_adminfixtures_synthetic-test-only-token"
)
  throw new Error("The private Blob fixture requires explicit synthetic credentials")

// The Blob SDK uses undici directly, so intercept its transport rather than only global fetch.
const dispatcher = new MockAgent()
dispatcher.disableNetConnect()
dispatcher.enableNetConnect(/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/)
// Derivatives the app writes during a journey, so a browsing size behaves like stored
// artwork instead of being re-derived on every request.
const written = new Map<string, { bytes: Buffer; contentType: string }>()

// `put` writes through the Blob API host with the target pathname in the query string.
dispatcher
  .get("https://vercel.com")
  .intercept({
    path: /^\/api\/blob\/\?/,
    method: "PUT",
    headers: { authorization: `Bearer ${process.env.PRIVATE_BLOB_READ_WRITE_TOKEN}` },
  })
  .reply(async ({ path: requestPath, headers, body }) => {
    const header = (name: string) => {
      const value = (headers as Record<string, string | string[] | undefined>)[name]
      return (Array.isArray(value) ? value[0] : value) ?? ""
    }
    const pathname = new URL(requestPath, "https://vercel.com").searchParams.get("pathname") ?? ""
    const contentType = header("x-content-type") || "application/octet-stream"
    // The Blob SDK's older undici reaches this mock through undici 8's compatibility wrapper,
    // which hands over the upload as a stream of chunks instead of the original buffer.
    if (pathname)
      written.set(pathname, { bytes: Buffer.from(await new Response(body as BodyInit).arrayBuffer()), contentType })
    return {
      statusCode: pathname ? 200 : 400,
      data: {
        url: `https://adminfixtures.private.blob.vercel-storage.com/${pathname}`,
        downloadUrl: `https://adminfixtures.private.blob.vercel-storage.com/${pathname}`,
        pathname,
        contentType,
        contentDisposition: `inline; filename="${pathname.split("/").pop() ?? ""}"`,
      },
      responseOptions: { headers: { "content-type": "application/json" } },
    }
  })
  .persist()

dispatcher
  .get("https://adminfixtures.private.blob.vercel-storage.com")
  .intercept({
    path: /.*/,
    method: "GET",
    headers: { authorization: `Bearer ${process.env.PRIVATE_BLOB_READ_WRITE_TOKEN}` },
  })
  .reply(({ path: pathname }) => {
    const key = decodeURIComponent(pathname.split("?")[0]!.slice(1))
    const derivative = written.get(key)
    if (derivative)
      return {
        statusCode: 200,
        data: derivative.bytes,
        responseOptions: {
          headers: { "content-type": derivative.contentType, "content-length": String(derivative.bytes.length) },
        },
      }
    const files = JSON.parse(readFileSync(".tmp/admin-e2e/blob-files.json", "utf8")) as Record<
      string,
      { sourcePath: string; mimeType: string; sha256: string }
    >
    const file = files[key]
    if (!file) return { statusCode: 404, data: "Not found" }
    const localPath = path.resolve(file.sourcePath)
    if (!localPath.startsWith(`${process.cwd()}${path.sep}`)) throw new Error("Fixture asset escaped the repository")
    const bytes = readFileSync(localPath)
    return {
      statusCode: 200,
      data: bytes,
      responseOptions: {
        headers: {
          "content-type": file.mimeType,
          "content-length": String(bytes.length),
          etag: `"${file.sha256}"`,
          "last-modified": new Date(0).toUTCString(),
        },
      },
    }
  })
  .persist()
setGlobalDispatcher(dispatcher)
