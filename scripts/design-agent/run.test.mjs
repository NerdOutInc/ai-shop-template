import assert from "node:assert/strict"
import { test } from "node:test"
import { spawn } from "node:child_process"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

test("local inspection drains a large piped JSON result before exit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "design-agent-output-")),
    input = join(directory, "input.json"),
    hook = join(directory, "hook.mjs")
  try {
    await writeFile(input, "{}")
    // Replace only the read-only inspection producer; run the real entrypoint and pipe backpressure path.
    await writeFile(
      hook,
      `import { registerHooks } from 'node:module'; registerHooks({ load(url, context, nextLoad) { if (url.endsWith('/scripts/design-agent/inspect.mjs')) return { format: 'module', shortCircuit: true, source: 'export async function inspectDesignAgentAsset() { return { output: "x".repeat(8 * 1024 * 1024) } }' }; return nextLoad(url, context) } });`
    )
    const child = spawn(
      process.execPath,
      ["--import", pathToFileURL(hook).href, "scripts/design-agent/run.mjs", "inspect", "--input", input],
      { stdio: ["ignore", "pipe", "pipe"] }
    )
    const chunks = [],
      errors = []
    child.stderr.on("data", (chunk) => errors.push(chunk))
    const exit = new Promise((resolve, reject) => {
      child.once("error", reject)
      child.once("close", (code) => resolve(code))
    })
    for await (const chunk of child.stdout) chunks.push(chunk)
    assert.equal(await exit, 0, Buffer.concat(errors).toString())
    assert.equal(JSON.parse(Buffer.concat(chunks).toString()).output.length, 8 * 1024 * 1024)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
