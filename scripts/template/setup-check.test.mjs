import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import test from "node:test"

const require = createRequire(import.meta.url)
const script = fileURLToPath(new URL("./setup-check.mjs", import.meta.url))

test("CLI reads isolated local configuration, rejects strict modes, and never echoes secrets", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "store-setup-check-"))
  try {
    writeFileSync(
      path.join(cwd, ".env.local"),
      "PRINTIFY_WEBHOOK_SECRET=secret-sentinel\nDATABASE_URL=redacted-sentinel\n"
    )
    writeFileSync(path.join(cwd, "vercel.json"), JSON.stringify({ crons: { invalid: true } }))
    for (const args of [[], ["--sandbox"], ["--launch"]]) {
      const result = spawnSync(
        process.execPath,
        ["--conditions=react-server", "--import", require.resolve("tsx"), script, ...args],
        {
          cwd,
          env: { PATH: process.env.PATH, NODE_ENV: "development" },
          encoding: "utf8",
        }
      )
      assert.equal(result.status, args.length ? 1 : 0)
      const output = result.stdout + result.stderr
      assert.match(output, /Remote readiness: UNVERIFIED/)
      assert.match(output, /PRINTIFY_WEBHOOK_SECRET/)
      assert.doesNotMatch(output, /secret-sentinel|redacted-sentinel|Invalid environment variables/)
    }
    const productionFile = path.join(cwd, "production.env")
    writeFileSync(productionFile, `PRINTIFY_WEBHOOK_SECRET=${"x".repeat(32)}\n`, { mode: 0o600 })
    const isolated = spawnSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        require.resolve("tsx"),
        script,
        "--launch",
        "--env-file",
        productionFile,
      ],
      {
        cwd,
        env: { PATH: process.env.PATH, PRINTIFY_WEBHOOK_SECRET: "parent-secret-sentinel" },
        encoding: "utf8",
      }
    )
    assert.equal(isolated.status, 1)
    assert.match(isolated.stdout, /CONFIGURED Environment syntax/)
    assert.doesNotMatch(isolated.stdout + isolated.stderr, /parent-secret-sentinel|redacted-sentinel|secret-sentinel/)
    const invalid = spawnSync(
      process.execPath,
      ["--conditions=react-server", "--import", require.resolve("tsx"), script, "--sandbox", "--launch"],
      { cwd, env: { PATH: process.env.PATH }, encoding: "utf8" }
    )
    assert.equal(invalid.status, 1)
    assert.match(invalid.stderr, /Usage:/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
