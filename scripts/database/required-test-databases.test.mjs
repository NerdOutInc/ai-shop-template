import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { assertTestDatabases } from "../../test/assert-test-databases.ts"

const root = fileURLToPath(new URL("../..", import.meta.url))

function findDatabaseVariables(directory, pattern) {
  const variables = new Set()
  for (const filename of readdirSync(join(root, directory), { recursive: true })) {
    if (!pattern.test(filename)) continue
    const source = readFileSync(join(root, directory, filename), "utf8")
    for (const match of source.matchAll(/process\.env\.([A-Z_]+_TEST_DATABASE_URL)\b/g)) {
      variables.add(match[1])
    }
  }
  return [...variables].sort()
}

for (const [suite, variables] of [
  ["unit", findDatabaseVariables("src", /\.test\.tsx?$/)],
  ["baseline", findDatabaseVariables("scripts/database", /\.test\.mjs$/)],
]) {
  test(`${suite} requires every database variable used by its suites in CI`, () => {
    assert.ok(variables.length > 0, "The source scan must discover database suites")
    const environment = Object.fromEntries(variables.map((name) => [name, "postgresql://unused.invalid/test"]))
    environment.CI = "true"
    assert.doesNotThrow(() => assertTestDatabases(suite, environment))

    for (const name of variables) {
      for (const missing of [undefined, "", "   "]) {
        assert.throws(
          () => assertTestDatabases(suite, { ...environment, [name]: missing }),
          (error) => error.message.includes(name) && error.message.includes("CI requires every database suite")
        )
      }
    }
  })

  test(`${suite} announces missing coverage locally without printing database URLs`, (t) => {
    const warn = t.mock.method(console, "warn", () => {})
    const environment = { [variables[0]]: "postgresql://hidden-password@unused.invalid/test" }
    assert.doesNotThrow(() => assertTestDatabases(suite, suite === "unit" ? environment : {}))
    assert.equal(warn.mock.callCount(), 1)
    const notice = warn.mock.calls[0].arguments[0]
    assert.match(notice, /skipped locally/)
    assert.match(notice, /Database coverage is incomplete/)
    assert.ok(notice.includes(variables.at(-1)))
    assert.doesNotMatch(notice, /hidden-password|postgresql:/)
  })
}

test("any nonempty CI marker requires database coverage", () => {
  for (const CI of ["true", "1", "false"]) {
    assert.throws(() => assertTestDatabases("baseline", { CI }), /TEMPLATE_TEST_DATABASE_URL/)
  }
})

function entrypointEnvironment() {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.endsWith("DATABASE_URL") && name !== "NODE_TEST_CONTEXT")
  )
  return { ...environment, CI: "true", FORCE_COLOR: "0", TEST_DATABASE_ENTRYPOINT_PROBE: "true" }
}

// The baseline runner discovers this file too. If its guard regresses, run the other
// tests once and let the parent probe reject that output instead of spawning forever.
const skipNestedProbe = process.env.TEST_DATABASE_ENTRYPOINT_PROBE === "true"

test(
  "the baseline runner stops before tests when CI database configuration is missing",
  { skip: skipNestedProbe },
  () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/database/run-tests.mjs"], {
      cwd: root,
      env: entrypointEnvironment(),
      encoding: "utf8",
      timeout: 30_000,
    })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stderr, /Missing baseline database configuration: TEMPLATE_TEST_DATABASE_URL\./)
    assert.equal(result.stdout, "", "The baseline test runner must not execute or report any tests")
  }
)

test(
  "the Vitest unit entrypoint stops before tests when one CI database URL is missing",
  { skip: skipNestedProbe },
  () => {
    const environment = entrypointEnvironment()
    for (const name of findDatabaseVariables("src", /\.test\.tsx?$/)) {
      environment[name] = "postgresql://unused.invalid/test"
    }
    delete environment.ADMIN_TEST_DATABASE_URL
    const result = spawnSync(
      process.execPath,
      [
        "node_modules/vitest/vitest.mjs",
        "run",
        "--project",
        "unit",
        "src/lib/is-private-app-path.test.ts",
        "--reporter=json",
      ],
      { cwd: root, env: environment, encoding: "utf8", timeout: 30_000 }
    )
    assert.equal(result.error, undefined)
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stderr, /Missing unit database configuration: ADMIN_TEST_DATABASE_URL\./)
    const report = JSON.parse(result.stdout)
    assert.equal(report.numTotalTests, 0)
    assert.deepEqual(report.testResults, [])
  }
)
