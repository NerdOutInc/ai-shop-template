import { readFile, stat, open, mkdir, link, unlink } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { put } from "@vercel/blob/client"

export async function createDesignAgentClient({ environment = process.env, fetcher = fetch, upload = put } = {}) {
  const url = new URL(environment.DESIGN_AGENT_URL ?? "")
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  )
    throw new Error("DESIGN_AGENT_URL must be the HTTPS store origin (HTTP is allowed only on loopback)")
  let token = environment.DESIGN_AGENT_TOKEN
  if (environment.DESIGN_AGENT_TOKEN_FILE) {
    const path = resolve(environment.DESIGN_AGENT_TOKEN_FILE),
      info = await stat(path)
    if (!info.isFile() || (process.platform !== "win32" && (info.mode & 0o077) !== 0))
      throw new Error("Credential file must be private to your account. Run chmod 600 on it.")
    token = (await readFile(path, "utf8")).trim()
  }
  if (!/^store_agent_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}$/.test(token ?? ""))
    throw new Error(
      "Set DESIGN_AGENT_TOKEN_FILE to a private credential file, or set DESIGN_AGENT_TOKEN in the process environment"
    )
  const headers = { authorization: `Bearer ${token}` }
  async function request(command) {
    const response = await fetcher(new URL("/api/admin/agent", url), {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(command),
      redirect: "error",
    })
    const body = await response.json().catch(() => null)
    if (!response.ok)
      throw new Error(
        `Agent command failed (${response.status}): ${typeof body?.error === "string" ? body.error : "Check the saved operation and retry the same request"}`
      )
    if (!body || typeof body !== "object" || Array.isArray(body) || !("result" in body))
      throw new Error("Agent response was not a command result; check the saved operation before retrying")
    return body.result
  }
  return {
    async command(command) {
      if (["asset.upload"].includes(command.command))
        throw new Error("Use the upload command so temporary credentials are never printed")
      return request(command)
    },
    async uploadAsset(input) {
      const data = await readFile(input.file)
      const intent = await request({ command: "asset.upload", batchId: input.batchId, assetId: input.assetId })
      if (intent.status === "ready") return { assetId: input.assetId, status: "ready" }
      if (data.length !== intent.bytes || createHash("sha256").update(data).digest("hex") !== intent.sha256)
        throw new Error("Local file does not match the registered asset; preserve and use the exact source")
      try {
        await upload(intent.pathname, data, {
          token: intent.token,
          access: "private",
          contentType: intent.contentType,
          multipart: true,
        })
      } catch (uploadError) {
        // Lost responses still recover through byte verification. Raw SDK errors can contain private URLs or tokens.
        try {
          return await request({ command: "asset.finalize", batchId: input.batchId, assetId: input.assetId })
        } catch {
          const message = uploadError instanceof Error ? uploadError.message.toLowerCase() : ""
          const status = Number(uploadError?.status ?? uploadError?.statusCode)
          const reason =
            /expired|token.*invalid|unauthorized|forbidden/.test(message) || [401, 403].includes(status)
              ? "Upload authorization expired or was rejected; resume the same upload to obtain a fresh short-lived token"
              : /too large|size limit|413/.test(message) || status === 413
                ? "Blob rejected the file size; compare the registered byte count and store upload limits"
                : /network|fetch failed|timeout|timed out|connection|response lost/.test(message)
                  ? "The upload network request failed or timed out; check connectivity and resume the same asset"
                  : "Blob upload failed; check Blob availability and resume the same registered asset"
          throw new Error(`${reason}. Server byte verification also failed; the asset is not confirmed ready.`)
        }
      }
      return request({ command: "asset.finalize", batchId: input.batchId, assetId: input.assetId })
    },
    /** The same handshake for an asset that belongs to a prepared revision, not a batch. */
    async uploadRevisionAsset(input) {
      const data = await readFile(input.file)
      const scope = { revisionId: input.revisionId, assetId: input.assetId }
      const intent = await request({ command: "revision.upload", ...scope })
      if (intent.status === "ready") return { assetId: input.assetId, status: "ready" }
      if (data.length !== intent.bytes || createHash("sha256").update(data).digest("hex") !== intent.sha256)
        throw new Error("Local file does not match the registered asset; preserve and use the exact source")
      try {
        await upload(intent.pathname, data, {
          token: intent.token,
          access: "private",
          contentType: intent.contentType,
          multipart: true,
        })
      } catch {
        // A lost response still recovers through the server's byte verification.
        return request({ command: "revision.finalize", ...scope })
      }
      return request({ command: "revision.finalize", ...scope })
    },
    async downloadAsset(input) {
      if (!/^[0-9a-f-]{36}$/.test(input.assetId)) throw new Error("An asset UUID is required")
      const output = resolve(input.output)
      await mkdir(dirname(output), { recursive: true })
      const temporary = `${output}.partial-${randomUUID()}`
      const file = await open(temporary, "wx", 0o600)
      try {
        const response = await fetcher(new URL(`/api/admin/assets/${input.assetId}`, url), {
          headers,
          redirect: "error",
        })
        if (!response.ok || !response.body) throw new Error(`Artwork download failed (${response.status})`)
        const expectedHash = response.headers.get("x-content-sha256")
        const expectedBytes = Number(response.headers.get("content-length"))
        if (
          !/^[a-f0-9]{64}$/.test(expectedHash ?? "") ||
          !Number.isSafeInteger(expectedBytes) ||
          expectedBytes < 1 ||
          expectedBytes > 64 * 1024 * 1024
        ) {
          await response.body.cancel()
          throw new Error("Artwork response is missing valid registered integrity metadata")
        }
        const reader = response.body.getReader()
        let bytes = 0
        const hash = createHash("sha256")
        try {
          for (;;) {
            const result = await reader.read()
            if (result.done) break
            bytes += result.value.length
            if (bytes > expectedBytes) {
              await reader.cancel()
              throw new Error("Artwork exceeds its registered byte count")
            }
            hash.update(result.value)
            await file.writeFile(result.value)
          }
        } finally {
          reader.releaseLock()
        }
        const sha256 = hash.digest("hex")
        if (bytes !== expectedBytes || sha256 !== expectedHash)
          throw new Error("Downloaded bytes do not match the registered artwork")
        await file.close()
        await link(temporary, output)
        return { assetId: input.assetId, output, bytes, sha256 }
      } finally {
        await file.close()
        await unlink(temporary)
      }
    },
  }
}
