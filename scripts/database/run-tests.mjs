import { spawnSync } from "node:child_process"
import { readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { assertTestDatabases } from "../../test/assert-test-databases.ts"

assertTestDatabases("baseline")

const testDirectory = fileURLToPath(new URL(".", import.meta.url))
const tests = readdirSync(testDirectory)
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => `${testDirectory}${name}`)
const result = spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "--test", ...tests], {
  stdio: "inherit",
})

if (result.error) throw result.error
process.exitCode = result.status ?? 1
