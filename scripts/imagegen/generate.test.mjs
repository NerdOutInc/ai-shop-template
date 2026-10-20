import assert from "node:assert/strict"
import { test } from "node:test"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { runImageGeneration, parseImageGenerationArguments } from "./generate.mjs"
import { normalizeImageRequest } from "./request.mjs"
import { makeTestPng } from "./test-png.mjs"

const KEY = "sk-live-secret-0123456789abcdef"
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")
const neverFetch = async () => {
  throw new Error("fetch must not be called")
}

async function workspace(request = {}) {
  const directory = await mkdtemp(join(tmpdir(), "imagegen-cli-"))
  const input = join(directory, "request.json")
  await writeFile(
    input,
    JSON.stringify({ prompt: "Folded blank tee", outputDir: "out", baseName: "tee", count: 2, ...request })
  )
  return { directory, input, cleanup: () => rm(directory, { recursive: true, force: true }) }
}

test("the request shape is validated before anything else happens", () => {
  assert.throws(() => normalizeImageRequest({ prompt: "", outputDir: "x", baseName: "a" }), /prompt must be/)
  assert.throws(
    () => normalizeImageRequest({ prompt: "p", outputDir: "x", baseName: "a", size: "9x9" }),
    /size must be/
  )
  assert.throws(() => normalizeImageRequest({ prompt: "p", outputDir: "x", baseName: "a", count: 0 }), /count must be/)
  assert.throws(() => normalizeImageRequest({ prompt: "p", outputDir: "x", baseName: "../a" }), /baseName must use/)
  assert.throws(
    () => normalizeImageRequest({ prompt: "p", outputDir: "x", baseName: "a", background: "none" }),
    /background/
  )
  const request = normalizeImageRequest({ prompt: " p ", outputDir: "out", baseName: "a" }, { cwd: "/work" })
  assert.deepEqual(request, {
    prompt: "p",
    size: "auto",
    quality: "auto",
    background: "opaque",
    count: 1,
    outputDir: "/work/out",
    baseName: "a",
    referenceImages: [],
  })
  assert.deepEqual(parseImageGenerationArguments(["--input", "r.json", "--dry-run"]), {
    input: "r.json",
    flags: ["--dry-run"],
  })
  assert.throws(() => parseImageGenerationArguments(["--input"]), /Usage/)
  assert.throws(() => parseImageGenerationArguments(["--input", "r.json", "--yolo"]), /Usage/)
})

test("a paid provider refuses to run without owner authorization and never contacts the provider", async () => {
  const { directory, input, cleanup } = await workspace()
  try {
    await assert.rejects(
      runImageGeneration({
        argv: ["--input", input],
        environment: { IMAGE_PROVIDER: "openai", OPENAI_API_KEY: KEY },
        fetcher: neverFetch,
        cwd: directory,
      }),
      /needs the owner's authorization from the active conversation.*--authorized-by-owner.*saved delegation.*evidence only/s
    )
  } finally {
    await cleanup()
  }
})

test("a saved delegation in .store-setup.local.json is evidence only and never spends by itself", async () => {
  const { directory, input, cleanup } = await workspace({ count: 1 })
  await writeFile(
    join(directory, ".store-setup.local.json"),
    JSON.stringify({ delegation: { imageGeneration: { paidApi: true } } })
  )
  const environment = { IMAGE_PROVIDER: "openai", OPENAI_API_KEY: KEY }
  try {
    await assert.rejects(
      runImageGeneration({ argv: ["--input", input], environment, fetcher: neverFetch, cwd: directory }),
      /saved delegation\.imageGeneration\.paidApi in \.store-setup\.local\.json is evidence to cite, not permission/
    )
    const plan = await runImageGeneration({
      argv: ["--input", input, "--dry-run"],
      environment,
      fetcher: neverFetch,
      cwd: directory,
    })
    assert.deepEqual(plan.authorization, { authorized: false, source: "none", savedDelegation: true })
    const receipt = await runImageGeneration({
      argv: ["--input", input, "--authorized-by-owner"],
      environment,
      fetcher: async () => Response.json({ data: [{ b64_json: makeTestPng().toString("base64") }] }),
      cwd: directory,
    })
    assert.equal(receipt.authorization, "flag")
    assert.equal(receipt.status, "complete")
    assert.equal(receipt.images[0].path, join(directory, "out", "tee-1.png"))
  } finally {
    await cleanup()
  }
})

test("a false or missing delegation does not authorize", async () => {
  const { directory, input, cleanup } = await workspace()
  await writeFile(
    join(directory, ".store-setup.local.json"),
    JSON.stringify({ delegation: { imageGeneration: { paidApi: "yes" } } })
  )
  try {
    await assert.rejects(
      runImageGeneration({
        argv: ["--input", input],
        environment: { IMAGE_PROVIDER: "openai", OPENAI_API_KEY: KEY },
        fetcher: neverFetch,
        cwd: directory,
      }),
      /needs the owner's authorization/
    )
  } finally {
    await cleanup()
  }
})

test("dry run prints the cost-relevant parameters and authorization source without a key or a request", async () => {
  const { directory, input, cleanup } = await workspace({
    size: "1024x1024",
    quality: "high",
    referenceImages: ["ref.png"],
  })
  await writeFile(join(directory, "ref.png"), makeTestPng())
  try {
    const plan = await runImageGeneration({
      argv: ["--input", input, "--dry-run"],
      environment: { IMAGE_PROVIDER: "openai" },
      fetcher: neverFetch,
      cwd: directory,
    })
    assert.deepEqual(plan, {
      dryRun: true,
      provider: "openai",
      endpoint: "images/edits",
      model: "gpt-image-1",
      count: 2,
      size: "1024x1024",
      quality: "high",
      background: "opaque",
      referenceImages: 1,
      authorization: { authorized: false, source: "none", savedDelegation: null },
      wouldWrite: ["tee-1.png", "tee-2.png"],
      outputDir: join(directory, "out"),
    })
    const gemini = await runImageGeneration({
      argv: ["--input", input, "--dry-run", "--authorized-by-owner"],
      environment: { IMAGE_PROVIDER: "gemini", IMAGE_MODEL: "gemini-3-pro-image-preview" },
      fetcher: neverFetch,
      cwd: directory,
    })
    assert.equal(gemini.endpoint, "models/gemini-3-pro-image-preview:generateContent")
    assert.deepEqual(gemini.authorization, { authorized: true, source: "flag", savedDelegation: null })
    await assert.rejects(
      runImageGeneration({
        argv: ["--input", input, "--dry-run", "--authorized-by-owner"],
        environment: { IMAGE_PROVIDER: "gemini" },
        fetcher: neverFetch,
        cwd: directory,
      }),
      /gemini-2\.5-flash-image renders at a fixed resolution and does not accept quality "high"/
    )
  } finally {
    await cleanup()
  }
})

test("the host provider prints the exact prompt and expected paths, then --complete hashes the host's files", async () => {
  const anchor = makeTestPng({ seed: 11 })
  const { directory, input, cleanup } = await workspace({ background: "transparent", referenceImages: ["anchor.png"] })
  await writeFile(join(directory, "anchor.png"), anchor)
  try {
    const instructions = await runImageGeneration({
      argv: ["--input", input],
      environment: {},
      fetcher: neverFetch,
      cwd: directory,
    })
    assert.equal(instructions.status, "pending-host")
    assert.equal(instructions.prompt, "Folded blank tee")
    assert.equal(instructions.background, "transparent")
    assert.deepEqual(instructions.expectedFiles, [
      join(directory, "out", "tee-1.png"),
      join(directory, "out", "tee-2.png"),
    ])
    assert.deepEqual(instructions.referenceImages, [
      { path: join(directory, "anchor.png"), sha256: sha256(anchor), mimeType: "image/png" },
    ])
    assert.match(instructions.nextStep, /--complete/)
    await assert.rejects(
      runImageGeneration({
        argv: ["--input", input, "--complete"],
        environment: {},
        fetcher: neverFetch,
        cwd: directory,
      }),
      /Expected host output is missing/
    )
    const { mkdir } = await import("node:fs/promises")
    await mkdir(join(directory, "out"), { recursive: true })
    const first = makeTestPng({ seed: 21 }),
      second = makeTestPng({ seed: 22, alpha: false })
    await writeFile(join(directory, "out", "tee-1.png"), first)
    await writeFile(join(directory, "out", "tee-2.png"), second)
    const receipt = await runImageGeneration({
      argv: ["--input", input, "--complete"],
      environment: { IMAGE_PROVIDER: "openai" },
      fetcher: neverFetch,
      cwd: directory,
    })
    assert.equal(receipt.provider, "host")
    assert.equal(receipt.model, null)
    assert.deepEqual(
      receipt.images.map((image) => [image.sha256, image.alphaChannel]),
      [
        [sha256(first), true],
        [sha256(second), false],
      ]
    )
    assert.equal(receipt.request.referenceImages[0].sha256, sha256(anchor))
    assert.ok(JSON.parse(await readFile(join(directory, "out", "tee.receipt.json"), "utf8")).images.length === 2)
  } finally {
    await cleanup()
  }
})

test("keys come from the environment or a private *_FILE and are never echoed", async () => {
  const { directory, input, cleanup } = await workspace({ count: 1 })
  const keyFile = join(directory, "openai.key")
  await writeFile(keyFile, `${KEY}\n`, { mode: 0o644 })
  const environment = { IMAGE_PROVIDER: "openai", OPENAI_API_KEY_FILE: keyFile }
  try {
    await assert.rejects(
      runImageGeneration({
        argv: ["--input", input, "--authorized-by-owner"],
        environment,
        fetcher: neverFetch,
        cwd: directory,
      }),
      (error) => /chmod 600/.test(error.message) && !error.message.includes(KEY)
    )
    await chmod(keyFile, 0o600)
    let authorization
    const receipt = await runImageGeneration({
      argv: ["--input", input, "--authorized-by-owner"],
      environment,
      fetcher: async (_url, init) => {
        authorization = init.headers.authorization
        return Response.json({ data: [{ b64_json: makeTestPng().toString("base64") }] })
      },
      cwd: directory,
    })
    assert.equal(authorization, `Bearer ${KEY}`)
    assert.ok(!JSON.stringify(receipt).includes(KEY))
    await assert.rejects(
      runImageGeneration({
        argv: ["--input", input, "--authorized-by-owner"],
        environment: { IMAGE_PROVIDER: "gemini" },
        fetcher: neverFetch,
        cwd: directory,
      }),
      /Set GEMINI_API_KEY in the process environment or GEMINI_API_KEY_FILE/
    )
  } finally {
    await cleanup()
  }
})

test("the CLI entrypoint prints JSON and fails cleanly on a usage error", async () => {
  const { input, cleanup } = await workspace()
  const run = (args, env = {}) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, ["scripts/imagegen/generate.mjs", ...args], {
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      })
      const out = [],
        err = []
      child.stdout.on("data", (chunk) => out.push(chunk))
      child.stderr.on("data", (chunk) => err.push(chunk))
      child.once("close", (code) =>
        resolve({ code, stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString() })
      )
    })
  try {
    const host = await run(["--input", input], { IMAGE_PROVIDER: "host" })
    assert.equal(host.code, 0, host.stderr)
    assert.equal(JSON.parse(host.stdout).status, "pending-host")
    const usage = await run([])
    assert.equal(usage.code, 1)
    assert.match(usage.stderr, /^Usage: pnpm imagegen/)
    const refused = await run(["--input", input], { IMAGE_PROVIDER: "openai", OPENAI_API_KEY: KEY })
    assert.equal(refused.code, 1)
    assert.match(refused.stderr, /needs the owner's authorization/)
    assert.ok(!refused.stderr.includes(KEY))
  } finally {
    await cleanup()
  }
})
