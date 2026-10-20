import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { runImageGeneration } from "./generate.mjs"
import { readPngHeader } from "./png.mjs"
import { makeTestPng } from "./test-png.mjs"

const KEY = "sk-test-secret-never-printed-0123456789"
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")

async function workspace(request = {}) {
  const directory = await mkdtemp(join(tmpdir(), "imagegen-"))
  const input = join(directory, "request.json")
  await writeFile(
    input,
    JSON.stringify({ prompt: "A badger reading", outputDir: join(directory, "out"), baseName: "badger", ...request })
  )
  return { directory, input, cleanup: () => rm(directory, { recursive: true, force: true }) }
}

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })
}

test("openai generations map the neutral request and hash every written file", async () => {
  const { directory, input, cleanup } = await workspace({ size: "1536x1024", quality: "high", count: 2 })
  const calls = []
  const png = makeTestPng({ alpha: false })
  const fetcher = async (url, init) => {
    calls.push({ url, init })
    return jsonResponse(
      {
        data: [
          { b64_json: png.toString("base64") },
          { b64_json: makeTestPng({ alpha: false, seed: 9 }).toString("base64") },
        ],
      },
      { headers: { "x-request-id": "req_123" } }
    )
  }
  try {
    const receipt = await runImageGeneration({
      argv: ["--input", input, "--authorized-by-owner"],
      environment: { IMAGE_PROVIDER: "openai", OPENAI_API_KEY: KEY },
      fetcher,
      cwd: directory,
    })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, "https://api.openai.com/v1/images/generations")
    assert.equal(calls[0].init.headers.authorization, `Bearer ${KEY}`)
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      model: "gpt-image-1",
      prompt: "A badger reading",
      n: 2,
      size: "1536x1024",
      quality: "high",
      background: "opaque",
      output_format: "png",
    })
    assert.equal(receipt.provider, "openai")
    assert.equal(receipt.model, "gpt-image-1")
    assert.equal(receipt.requestId, "req_123")
    assert.equal(receipt.seed, null)
    assert.equal(receipt.authorization, "flag")
    assert.equal(receipt.images.length, 2)
    assert.equal(receipt.images[0].path, join(directory, "out", "badger-1.png"))
    assert.equal(receipt.images[0].sha256, sha256(png))
    assert.equal(receipt.images[0].bytes, png.length)
    assert.deepEqual([receipt.images[0].width, receipt.images[0].height, receipt.images[0].alphaChannel], [2, 1, false])
    assert.equal(sha256(await readFile(receipt.images[0].path)), receipt.images[0].sha256)
    const saved = JSON.parse(await readFile(join(directory, "out", "badger.receipt.json"), "utf8"))
    assert.equal(saved.images[1].sha256, receipt.images[1].sha256)
    assert.ok(!JSON.stringify(receipt).includes(KEY), "the key must never appear in the receipt")
  } finally {
    await cleanup()
  }
})

test("openai transparent output requests a PNG with a transparent background and reports the alpha channel", async () => {
  const { directory, input, cleanup } = await workspace({ background: "transparent" })
  let body
  const fetcher = async (_url, init) => {
    body = JSON.parse(init.body)
    return jsonResponse({ data: [{ b64_json: makeTestPng({ alpha: true }).toString("base64") }] })
  }
  try {
    const receipt = await runImageGeneration({
      argv: ["--input", input, "--authorized-by-owner"],
      environment: { IMAGE_PROVIDER: "openai", OPENAI_API_KEY: KEY, IMAGE_MODEL: "gpt-image-next" },
      fetcher,
      cwd: directory,
    })
    assert.equal(body.background, "transparent")
    assert.equal(body.output_format, "png")
    assert.equal(body.model, "gpt-image-next")
    assert.equal(receipt.images[0].alphaChannel, true)
  } finally {
    await cleanup()
  }
})

test("openai reference images switch to the edits endpoint with multipart files and recorded hashes", async () => {
  const anchor = makeTestPng({ alpha: false, seed: 3 })
  const { directory, input, cleanup } = await workspace({ referenceImages: ["anchor.png"] })
  await writeFile(join(directory, "anchor.png"), anchor)
  let call
  const fetcher = async (url, init) => {
    call = { url, init }
    return jsonResponse({ data: [{ b64_json: makeTestPng().toString("base64") }] })
  }
  try {
    const receipt = await runImageGeneration({
      argv: ["--input", input, "--authorized-by-owner"],
      environment: { IMAGE_PROVIDER: "openai", OPENAI_API_KEY: KEY },
      fetcher,
      cwd: directory,
    })
    assert.equal(call.url, "https://api.openai.com/v1/images/edits")
    assert.ok(call.init.body instanceof FormData)
    assert.equal(call.init.body.get("prompt"), "A badger reading")
    assert.equal(call.init.body.get("n"), "1")
    const files = call.init.body.getAll("image[]")
    assert.equal(files.length, 1)
    assert.equal(files[0].name, "anchor.png")
    assert.equal(files[0].type, "image/png")
    assert.equal(sha256(Buffer.from(await files[0].arrayBuffer())), sha256(anchor))
    assert.deepEqual(receipt.request.referenceImages, [
      { path: join(directory, "anchor.png"), bytes: anchor.length, sha256: sha256(anchor), mimeType: "image/png" },
    ])
  } finally {
    await cleanup()
  }
})

test("gemini maps size to an aspect ratio, inlines references and asks for transparency in the prompt", async () => {
  const anchor = makeTestPng({ alpha: false, seed: 5 })
  const { directory, input, cleanup } = await workspace({
    size: "1024x1536",
    background: "transparent",
    count: 2,
    referenceImages: ["anchor.png"],
  })
  await writeFile(join(directory, "anchor.png"), anchor)
  const calls = []
  const fetcher = async (url, init) => {
    calls.push({ url, init })
    return jsonResponse({
      responseId: "resp_9",
      candidates: [
        {
          content: {
            parts: [
              { text: "here" },
              {
                inlineData: {
                  mimeType: "image/png",
                  data: makeTestPng({ alpha: true, seed: calls.length }).toString("base64"),
                },
              },
            ],
          },
        },
      ],
    })
  }
  try {
    const receipt = await runImageGeneration({
      argv: ["--input", input, "--authorized-by-owner"],
      environment: { IMAGE_PROVIDER: "gemini", GEMINI_API_KEY: KEY },
      fetcher,
      cwd: directory,
    })
    assert.equal(calls.length, 2, "one generateContent call per requested image")
    assert.equal(
      calls[0].url,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent"
    )
    assert.equal(calls[0].init.headers["x-goog-api-key"], KEY)
    const body = JSON.parse(calls[0].init.body)
    assert.deepEqual(body.generationConfig, { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "2:3" } })
    assert.match(
      body.contents[0].parts[0].text,
      /^A badger reading\n\nOutput a PNG with a fully transparent background/
    )
    assert.equal(body.contents[0].parts[1].inlineData.mimeType, "image/png")
    assert.equal(body.contents[0].parts[1].inlineData.data, anchor.toString("base64"))
    assert.equal(receipt.provider, "gemini")
    assert.equal(receipt.requestId, "resp_9")
    assert.equal(receipt.images.length, 2)
    assert.notEqual(receipt.images[0].sha256, receipt.images[1].sha256)
    assert.equal(receipt.images[1].alphaChannel, true)
    assert.match(receipt.notes[0], /does not guarantee an alpha channel/)
  } finally {
    await cleanup()
  }
})

test("provider errors become actionable messages that never include the key", async () => {
  const cases = [
    [401, { error: { message: `Incorrect API key provided: ${KEY}` } }, /rejected the API key.*\[redacted\]/],
    [
      403,
      {
        error: {
          message: "Forbidden for Bearer abcdefghijklmnop at https://proxy.example/v1?key=AIzaSyA1234567890abcdefghijk",
        },
      },
      /rejected the API key/,
    ],
    [429, { error: { message: "Rate limit" } }, /rate limit or quota/],
    [
      400,
      { error: { message: "Your request was rejected by the safety system (moderation_blocked)" } },
      /content grounds/,
    ],
    [400, { error: { message: "Invalid value: '2K'" } }, /check IMAGE_MODEL and the size/],
    [503, null, /unavailable right now/],
  ]
  for (const [status, body, pattern] of cases) {
    const { directory, input, cleanup } = await workspace()
    try {
      await assert.rejects(
        runImageGeneration({
          argv: ["--input", input, "--authorized-by-owner"],
          environment: { IMAGE_PROVIDER: "openai", OPENAI_API_KEY: KEY },
          fetcher: async () => (body ? jsonResponse(body, { status }) : new Response("down", { status })),
          cwd: directory,
        }),
        (error) => {
          assert.match(error.message, pattern)
          assert.ok(!error.message.includes(KEY))
          return true
        }
      )
      await assert.rejects(
        readFile(join(directory, "out", "badger.receipt.json")),
        "no receipt when nothing was generated"
      )
    } finally {
      await cleanup()
    }
  }
})

test("gemini reports a blocked or empty answer instead of writing a partial receipt", async () => {
  const { directory, input, cleanup } = await workspace()
  try {
    await assert.rejects(
      runImageGeneration({
        argv: ["--input", input, "--authorized-by-owner"],
        environment: { IMAGE_PROVIDER: "gemini", GEMINI_API_KEY: KEY },
        fetcher: async () => jsonResponse({ candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] }),
        cwd: directory,
      }),
      /gemini returned no image \(SAFETY\)/
    )
  } finally {
    await cleanup()
  }
})

test("a completed baseName or a stray output file fails before the provider is called again", async () => {
  const { directory, input, cleanup } = await workspace()
  let calls = 0
  const fetcher = async () => {
    calls++
    return jsonResponse({ data: [{ b64_json: makeTestPng().toString("base64") }] })
  }
  const run = () =>
    runImageGeneration({
      argv: ["--input", input, "--authorized-by-owner"],
      environment: { IMAGE_PROVIDER: "openai", OPENAI_API_KEY: KEY },
      fetcher,
      cwd: directory,
    })
  try {
    const first = await run()
    assert.equal(first.status, "complete")
    await assert.rejects(run, /already records a complete generation; choose a new baseName/)
    assert.equal(calls, 1, "the second run must not bill the provider")
    assert.equal(sha256(await readFile(first.images[0].path)), first.images[0].sha256)
    const { mkdir, rm: remove, writeFile: write } = await import("node:fs/promises")
    await remove(join(directory, "out"), { recursive: true, force: true })
    await mkdir(join(directory, "out"), { recursive: true })
    await write(join(directory, "out", "badger-1.png"), makeTestPng({ seed: 99 }))
    await assert.rejects(run, /badger-1\.png already exists; choose a new baseName/)
    assert.equal(calls, 1)
  } finally {
    await cleanup()
  }
})

test("gemini keeps every finished image when a later call fails, and the same command resumes the rest", async () => {
  const { directory, input, cleanup } = await workspace({ count: 3 })
  const calls = []
  let failSecond = true
  const fetcher = async (_url, init) => {
    calls.push(JSON.parse(init.body))
    if (failSecond && calls.length === 2)
      return jsonResponse({ error: { message: "Resource exhausted" } }, { status: 429 })
    return jsonResponse({
      responseId: `resp_${calls.length}`,
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { mimeType: "image/png", data: makeTestPng({ seed: calls.length }).toString("base64") } },
            ],
          },
        },
      ],
    })
  }
  const run = () =>
    runImageGeneration({
      argv: ["--input", input, "--authorized-by-owner"],
      environment: { IMAGE_PROVIDER: "gemini", GEMINI_API_KEY: KEY },
      fetcher,
      cwd: directory,
    })
  try {
    await assert.rejects(
      run,
      /rate limit or quota reached.*1 of 3 images are saved and recorded as incomplete.*remaining 2/s
    )
    const partial = JSON.parse(await readFile(join(directory, "out", "badger.receipt.json"), "utf8"))
    assert.equal(partial.status, "incomplete")
    assert.deepEqual(
      [partial.completed, partial.requested, partial.images.length, partial.requestId],
      [1, 3, 1, "resp_1"]
    )
    assert.match(partial.notes[0], /generation stopped/)
    const firstHash = partial.images[0].sha256
    assert.equal(sha256(await readFile(partial.images[0].path)), firstHash)
    failSecond = false
    const receipt = await run()
    assert.equal(receipt.status, "complete")
    assert.equal(receipt.resumed, true)
    assert.equal(calls.length, 4, "only the two missing images are generated again")
    assert.equal(receipt.images.length, 3)
    assert.equal(receipt.images[0].sha256, firstHash)
    assert.deepEqual(
      receipt.images.map((image) => image.path.endsWith("badger-" + (receipt.images.indexOf(image) + 1) + ".png")),
      [true, true, true]
    )
  } finally {
    await cleanup()
  }
})

test("an incomplete batch resumes only under the same provider and model, and only when no orphaned file is in the way", async () => {
  const { directory, input, cleanup } = await workspace({ count: 3 })
  let calls = 0
  const fetcher = async () => {
    calls++
    if (calls === 2) return jsonResponse({ error: { message: "Resource exhausted" } }, { status: 429 })
    return jsonResponse({
      candidates: [
        {
          content: {
            parts: [{ inlineData: { mimeType: "image/png", data: makeTestPng({ seed: calls }).toString("base64") } }],
          },
        },
      ],
    })
  }
  const run = (environment) =>
    runImageGeneration({ argv: ["--input", input, "--authorized-by-owner"], environment, fetcher, cwd: directory })
  try {
    await assert.rejects(run({ IMAGE_PROVIDER: "gemini", GEMINI_API_KEY: KEY }), /1 of 3 images are saved/)
    assert.equal(calls, 2)
    await assert.rejects(
      run({ IMAGE_PROVIDER: "openai", OPENAI_API_KEY: KEY }),
      /incomplete gemini\/gemini-2\.5-flash-image generation of a different request; choose a new baseName rather than mixing provenance/
    )
    await assert.rejects(
      run({ IMAGE_PROVIDER: "gemini", GEMINI_API_KEY: KEY, IMAGE_MODEL: "gemini-3-pro-image-preview" }),
      /mixing provenance/
    )
    assert.equal(calls, 2, "a provider or model mismatch never reaches the provider")
    const { writeFile: write } = await import("node:fs/promises")
    await write(join(directory, "out", "badger-2.png"), makeTestPng({ seed: 77 }))
    await assert.rejects(
      run({ IMAGE_PROVIDER: "gemini", GEMINI_API_KEY: KEY }),
      /badger-2\.png exists but is not recorded in the incomplete receipt.*before resuming/
    )
    assert.equal(calls, 2, "an orphaned output file is detected before billing")
    const receipt = JSON.parse(await readFile(join(directory, "out", "badger.receipt.json"), "utf8"))
    assert.equal(receipt.status, "incomplete")
    assert.equal(receipt.provider, "gemini")
  } finally {
    await cleanup()
  }
})

test("gemini sends a 2K image size only to a model that accepts it", async () => {
  const { directory, input, cleanup } = await workspace({ quality: "high" })
  const bodies = []
  const fetcher = async (_url, init) => {
    bodies.push(JSON.parse(init.body))
    return jsonResponse({
      candidates: [
        { content: { parts: [{ inlineData: { mimeType: "image/png", data: makeTestPng().toString("base64") } }] } },
      ],
    })
  }
  try {
    await assert.rejects(
      runImageGeneration({
        argv: ["--input", input, "--authorized-by-owner"],
        environment: { IMAGE_PROVIDER: "gemini", GEMINI_API_KEY: KEY },
        fetcher,
        cwd: directory,
      }),
      /gemini-2\.5-flash-image renders at a fixed resolution/
    )
    assert.equal(bodies.length, 0)
    await runImageGeneration({
      argv: ["--input", input, "--authorized-by-owner"],
      environment: { IMAGE_PROVIDER: "gemini", GEMINI_API_KEY: KEY, IMAGE_MODEL: "gemini-3-pro-image-preview" },
      fetcher,
      cwd: directory,
    })
    assert.deepEqual(bodies[0].generationConfig.imageConfig, { imageSize: "2K" })
  } finally {
    await cleanup()
  }
})

test("PNG headers report dimensions and whether an alpha channel exists", () => {
  assert.deepEqual(readPngHeader(makeTestPng({ width: 3, height: 2, alpha: true })), {
    width: 3,
    height: 2,
    alphaChannel: true,
  })
  assert.deepEqual(readPngHeader(makeTestPng({ alpha: false })), { width: 2, height: 1, alphaChannel: false })
  assert.equal(readPngHeader(Buffer.from("not a png")), null)
})
