import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { test } from "node:test"

import { assertCommerceTestScope } from "../../test/assert-commerce-test-scope.ts"

const root = new URL("../../", import.meta.url)
const scope = JSON.parse(readFileSync(new URL("commerce-test-scope.json", import.meta.url), "utf8"))
const databases = Object.fromEntries(
  Object.entries(scope.databases).map(([name, database]) => [
    name,
    `postgresql://postgres:private-password@127.0.0.1:55479/${database}`,
  ])
)

test("commerce scope guards every selected database and rejects shared or ambiguous destinations", () => {
  assert.doesNotThrow(() => assertCommerceTestScope(databases))
  const found = new Set()
  for (const filename of scope.files) {
    for (const match of readFileSync(new URL(filename, root), "utf8").matchAll(
      /process\.env\.([A-Z_]+_TEST_DATABASE_URL)\b/g
    )) {
      found.add(match[1])
    }
  }
  assert.deepEqual([...found].sort(), Object.keys(scope.databases).sort())
  for (const [name, database] of Object.entries(scope.databases)) {
    for (const invalid of [
      undefined,
      "",
      "   ",
      "broken",
      `https://localhost/${database}`,
      `postgresql://remote.invalid/${database}`,
      `postgresql://localhost/store_live`,
      `${databases[name]}?host=remote.invalid`,
      `${databases[name]}#fragment`,
    ]) {
      assert.throws(
        () => assertCommerceTestScope({ ...databases, [name]: invalid }),
        (error) => error.message.includes(name) && !error.message.includes("private-password")
      )
    }
  }
})

test("removing a selected test file cannot silently reduce commerce coverage", () => {
  const fixture = mkdtempSync(join(tmpdir(), "commerce-scope-"))
  try {
    mkdirSync(join(fixture, "test"))
    mkdirSync(join(fixture, "scripts", "ci"), { recursive: true })
    copyFileSync(
      new URL("../../test/assert-commerce-test-scope.ts", import.meta.url),
      join(fixture, "test", "assert-commerce-test-scope.ts")
    )
    copyFileSync(
      new URL("../../test/resolve-commerce-test-scope.ts", import.meta.url),
      join(fixture, "test", "resolve-commerce-test-scope.ts")
    )
    copyFileSync(
      new URL("test-database-names.json", import.meta.url),
      join(fixture, "scripts", "ci", "test-database-names.json")
    )
    copyFileSync(
      new URL("commerce-test-scope.json", import.meta.url),
      join(fixture, "scripts", "ci", "commerce-test-scope.json")
    )
    const moduleUrl = pathToFileURL(join(fixture, "test", "assert-commerce-test-scope.ts")).href
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `const { assertCommerceTestScope } = await import(${JSON.stringify(moduleUrl)}); assertCommerceTestScope();`,
      ],
      { cwd: root, encoding: "utf8", timeout: 30_000 }
    )
    assert.equal(result.error, undefined)
    assert.equal(result.status, 1)
    assert.ok(result.stderr.includes(`Required test file is missing: ${scope.files[0]}`), result.stderr)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test("the commerce Vitest entrypoint stops before any test when a database is missing, even locally", () => {
  const environment = { ...process.env, ...databases, CI: "", CI_TEST_SELECTION: "", FORCE_COLOR: "0" }
  delete environment.SIGNUP_TEST_DATABASE_URL
  const result = spawnSync(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.commerce.config.ts", "--reporter=json"],
    { cwd: root, env: environment, encoding: "utf8", timeout: 30_000 }
  )
  assert.equal(result.error, undefined)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, /SIGNUP_TEST_DATABASE_URL must name disposable local store_signup_test/)
  const report = JSON.parse(result.stdout)
  assert.equal(report.numTotalTests, 0)
  assert.deepEqual(report.testResults, [])
})

function gate(mode, changes = {}) {
  return spawnSync(process.execPath, ["scripts/ci/require-check-results.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      CI_SUITE: mode,
      SELECTION_RESULT: "success",
      INTEGRATION_REQUIRED: "false",
      INTEGRATION_RESULT: "skipped",
      LINT_RESULT: "success",
      FOUNDATION_RESULT: "success",
      COMMERCE_RESULT: "success",
      FULL_RESULT: "success",
      ...changes,
    },
    encoding: "utf8",
  })
}

for (const [mode, names] of [
  ["commerce", ["SELECTION_RESULT", "LINT_RESULT", "FOUNDATION_RESULT", "COMMERCE_RESULT"]],
  ["full", ["FULL_RESULT"]],
]) {
  test(`${mode} aggregate rejects every non-success dependency`, () => {
    assert.equal(gate(mode).status, 0)
    for (const name of names) {
      for (const result of ["failure", "cancelled", "skipped", "", "unexpected"]) {
        const run = gate(mode, { [name]: result })
        assert.equal(run.status, 1, run.stdout + run.stderr)
      }
    }
    const inactive =
      mode === "full"
        ? { LINT_RESULT: "skipped", FOUNDATION_RESULT: "skipped", COMMERCE_RESULT: "skipped" }
        : { FULL_RESULT: "skipped" }
    assert.equal(gate(mode, inactive).status, 0)
  })
}

test("unknown verification scope fails closed", () => {
  for (const mode of ["", "other", "toString", "__proto__"]) {
    assert.notEqual(gate(mode).status, 0)
  }
})

test("changed integration coverage is required only when selected, and the selection fails closed", () => {
  assert.equal(gate("commerce", { INTEGRATION_REQUIRED: "true", INTEGRATION_RESULT: "success" }).status, 0)
  for (const result of ["failure", "cancelled", "skipped", ""]) {
    assert.equal(gate("commerce", { INTEGRATION_REQUIRED: "true", INTEGRATION_RESULT: result }).status, 1)
  }
  for (const flag of ["", "unexpected"]) assert.equal(gate("commerce", { INTEGRATION_REQUIRED: flag }).status, 1)
})

test("default single-file Vitest runs remain mock-only and execute each file once", () => {
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.endsWith("DATABASE_URL")))
  const run = spawnSync(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run", "src/app/api/drop-signup/route.test.ts", "--reporter=json"],
    {
      cwd: root,
      env: { ...environment, CI: "", CI_TEST_SELECTION: "", FORCE_COLOR: "0" },
      encoding: "utf8",
      timeout: 30_000,
    }
  )
  assert.equal(run.error, undefined)
  assert.equal(run.status, 0, run.stdout + run.stderr)
  const report = JSON.parse(run.stdout)
  assert.equal(report.testResults.length, 1)
  assert.ok(report.numTotalTests > 0)
  assert.doesNotMatch(run.stderr, /JSON import|commerce tests/)
})
