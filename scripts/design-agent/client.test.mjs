import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtemp, writeFile, readFile, chmod, rm, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID, createHash } from "node:crypto"
import { put } from "@vercel/blob/client"
import { createDesignAgentClient } from "./client.mjs"
const token = `store_agent_${randomUUID()}_${"a".repeat(43)}`
const environment = { DESIGN_AGENT_URL: "https://store.example", DESIGN_AGENT_TOKEN: token }
const json = (result) => new Response(JSON.stringify({ result }), { headers: { "content-type": "application/json" } })

test("keeps credentials in authorization only and preserves command request IDs", async () => {
  const seen = []
  const client = await createDesignAgentClient({
    environment,
    fetcher: async (url, options) => {
      seen.push({ url: String(url), options })
      return json({ batchId: "saved" })
    },
  })
  const command = { command: "batch.create", requestId: randomUUID(), title: "Fifty", brief: "Sloths", count: 50 }
  assert.deepEqual(await client.command(command), { batchId: "saved" })
  assert.equal(seen[0].url, "https://store.example/api/admin/agent")
  assert.equal(seen[0].options.headers.authorization, `Bearer ${token}`)
  assert.equal(seen[0].options.redirect, "error")
  assert.deepEqual(JSON.parse(seen[0].options.body), command)
  await assert.rejects(client.command({ command: "asset.upload" }), /temporary credentials/)
})
test("requires HTTPS remote origins and rejects URL credentials or redirect-bearing origins", async () => {
  for (const url of [
    "http://store.example",
    "ftp://localhost",
    "https://user:password@store.example",
    "https://store.example/path",
    "https://store.example/?token=bad",
  ])
    await assert.rejects(
      createDesignAgentClient({ environment: { ...environment, DESIGN_AGENT_URL: url } }),
      /HTTPS store origin/
    )
  await createDesignAgentClient({ environment: { ...environment, DESIGN_AGENT_URL: "http://127.0.0.1:3000" } })
})
test("reads a private token file and rejects group/world permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "design-agent-"))
  const file = join(directory, "grant.token")
  try {
    await writeFile(file, token + "\n", { mode: 0o644 })
    await assert.rejects(
      createDesignAgentClient({
        environment: { DESIGN_AGENT_URL: environment.DESIGN_AGENT_URL, DESIGN_AGENT_TOKEN_FILE: file },
      }),
      /chmod 600/
    )
    await chmod(file, 0o600)
    await createDesignAgentClient({
      environment: { DESIGN_AGENT_URL: environment.DESIGN_AGENT_URL, DESIGN_AGENT_TOKEN_FILE: file },
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
test("uploads exact bytes directly as multipart and only prints the verified receipt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "design-agent-"))
  const file = join(directory, "print.png"),
    data = Buffer.from("fixture"),
    assetId = randomUUID(),
    batchId = randomUUID(),
    commands = []
  let uploadOptions
  try {
    await writeFile(file, data)
    const client = await createDesignAgentClient({
      environment,
      fetcher: async (_, options) => {
        const command = JSON.parse(options.body)
        commands.push(command)
        return json(
          command.command === "asset.upload"
            ? {
                token: "temporary-secret",
                pathname: "immutable",
                contentType: "image/png",
                bytes: data.length,
                sha256: createHash("sha256").update(data).digest("hex"),
              }
            : { assetId, status: "ready" }
        )
      },
      upload: async (path, bytes, options) => {
        uploadOptions = options
        assert.equal(path, "immutable")
        assert.deepEqual(bytes, data)
        assert.equal(options.multipart, true)
        assert.equal(options.access, "private")
        assert.equal(options.token, "temporary-secret")
      },
    })
    const result = await client.uploadAsset({ batchId, assetId, file })
    assert.ok(uploadOptions)
    // Run SDK option checks outside the upload mock so recovery cannot swallow a failed assertion.
    await assert.rejects(
      put("immutable", data, {
        ...uploadOptions,
        token: "vercel_blob_client_fixture",
        abortSignal: AbortSignal.abort(),
      }),
      /The request was aborted/
    )
    assert.deepEqual(result, { assetId, status: "ready" })
    assert.equal(JSON.stringify(result).includes("secret"), false)
    assert.deepEqual(
      commands.map((value) => value.command),
      ["asset.upload", "asset.finalize"]
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
test("a lost upload response retries verification, never a replacement upload", async () => {
  const directory = await mkdtemp(join(tmpdir(), "design-agent-"))
  const file = join(directory, "print.png"),
    data = Buffer.from("fixture")
  let uploads = 0
  try {
    await writeFile(file, data)
    const client = await createDesignAgentClient({
      environment,
      fetcher: async (_, options) =>
        json(
          JSON.parse(options.body).command === "asset.upload"
            ? {
                token: "temporary-secret",
                pathname: "immutable",
                contentType: "image/png",
                bytes: data.length,
                sha256: createHash("sha256").update(data).digest("hex"),
              }
            : { status: "ready" }
        ),
      upload: async () => {
        uploads++
        throw Error("response lost")
      },
    })
    assert.deepEqual(await client.uploadAsset({ batchId: randomUUID(), assetId: randomUUID(), file }), {
      status: "ready",
    })
    assert.equal(uploads, 1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
test("refuses changed upload bytes before contacting Blob", async () => {
  const directory = await mkdtemp(join(tmpdir(), "design-agent-"))
  const file = join(directory, "print.png")
  let uploads = 0
  try {
    await writeFile(file, "changed")
    const client = await createDesignAgentClient({
      environment,
      fetcher: async () => json({ bytes: 100, sha256: "expected" }),
      upload: async () => {
        uploads++
      },
    })
    await assert.rejects(client.uploadAsset({ file, assetId: randomUUID(), batchId: randomUUID() }), /exact source/)
    assert.equal(uploads, 0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
test("downloads atomically with private permissions, protects existing output and removes failed partials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "design-agent-")),
    output = join(directory, "art.png"),
    assetId = randomUUID()
  try {
    const client = await createDesignAgentClient({
      environment,
      fetcher: async () =>
        new Response("verifiedbytes", {
          headers: {
            "content-length": "13",
            "x-content-sha256": createHash("sha256").update("verifiedbytes").digest("hex"),
          },
        }),
    })
    const result = await client.downloadAsset({ assetId, output })
    assert.equal(result.bytes, 13)
    assert.equal(await readFile(output, "utf8"), "verifiedbytes")
    await assert.rejects(client.downloadAsset({ assetId, output }), { code: "EEXIST" })
    assert.equal(await readFile(output, "utf8"), "verifiedbytes")
    const failed = await createDesignAgentClient({
      environment,
      fetcher: async () => new Response("denied", { status: 403 }),
    })
    await assert.rejects(failed.downloadAsset({ assetId, output: join(directory, "missing.png") }), /403/)
    assert.deepEqual(await readdir(directory), ["art.png"])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("never exposes a downloaded file with missing metadata, truncated bytes, or a different hash", async () => {
  const directory = await mkdtemp(join(tmpdir(), "design-agent-")),
    output = join(directory, "art.png")
  try {
    for (const headers of [
      {},
      { "content-length": "14", "x-content-sha256": createHash("sha256").update("verifiedbytes").digest("hex") },
      { "content-length": "13", "x-content-sha256": "0".repeat(64) },
    ]) {
      const client = await createDesignAgentClient({
        environment,
        fetcher: async () => new Response("verifiedbytes", { headers }),
      })
      await assert.rejects(
        client.downloadAsset({ assetId: randomUUID(), output }),
        /integrity metadata|registered artwork/
      )
      assert.deepEqual(await readdir(directory), [])
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("rejects successful non-results with an actionable response error", async () => {
  for (const body of ["<html>proxy</html>", "", "null", "[]", "{}", '{"error":"not a command result"}']) {
    const client = await createDesignAgentClient({ environment, fetcher: async () => new Response(body) })
    await assert.rejects(client.command({ command: "batch.status" }), /Agent response was not a command result/)
  }
})
test("reports a sanitized upload cause only when server recovery also fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "design-agent-")),
    file = join(directory, "print.png"),
    data = Buffer.from("fixture")
  try {
    await writeFile(file, data)
    for (const [message, expected] of [
      ["token expired Bearer temporary-secret https://private.example/art?token=secret-value", /authorization expired/],
      ["Blob 413 too large private-path", /file size/],
      ["fetch failed token=temporary-secret", /network request failed/],
      ["other error secret-value", /Blob upload failed/],
    ]) {
      let uploads = 0,
        finalizations = 0
      const client = await createDesignAgentClient({
        environment,
        fetcher: async (_, options) => {
          if (JSON.parse(options.body).command === "asset.upload")
            return json({
              token: "temporary-secret",
              pathname: "immutable",
              contentType: "image/png",
              bytes: data.length,
              sha256: createHash("sha256").update(data).digest("hex"),
            })
          finalizations++
          return new Response(JSON.stringify({ error: "Operation is incomplete" }), { status: 503 })
        },
        upload: async () => {
          uploads++
          throw new Error(message)
        },
      })
      await assert.rejects(client.uploadAsset({ batchId: randomUUID(), assetId: randomUUID(), file }), (error) => {
        assert.match(error.message, expected)
        assert.match(error.message, /not confirmed ready/)
        assert.doesNotMatch(error.message, /temporary-secret|secret-value|private-path|private\.example|Bearer/)
        return true
      })
      assert.equal(uploads, 1)
      assert.equal(finalizations, 1)
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
