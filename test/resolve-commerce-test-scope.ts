import { existsSync, readFileSync } from "node:fs"
import commerceScope from "../scripts/ci/commerce-test-scope.json" with { type: "json" }
import databaseNames from "../scripts/ci/test-database-names.json" with { type: "json" }

export function resolveCommerceTestScope(environment: NodeJS.ProcessEnv = process.env) {
  const selection: unknown = environment.CI_TEST_SELECTION ? JSON.parse(environment.CI_TEST_SELECTION) : { unit: [] }
  if (!selection || typeof selection !== "object" || !("unit" in selection) || !Array.isArray(selection.unit))
    throw new Error("Invalid changed-unit selection")
  const extra = selection.unit as unknown[]
  if (
    !extra.every(
      (file): file is string =>
        typeof file === "string" && /^src\/[^\n]+\.test\.tsx?$/.test(file) && !file.split("/").includes("..")
    )
  )
    throw new Error("Invalid changed-unit test path")
  const files = [...new Set([...commerceScope.files, ...extra])].sort()
  const databases: Record<string, string> = {}
  for (const filename of files) {
    const path = new URL(`../${filename}`, import.meta.url)
    if (!existsSync(path)) throw new Error(`[commerce tests] Required test file is missing: ${filename}`)
    for (const match of readFileSync(path, "utf8").matchAll(/process\.env\.([A-Z_]+_TEST_DATABASE_URL)\b/g)) {
      const name = match[1]!
      if (!(name in databaseNames)) throw new Error(`Unknown commerce test database: ${name}`)
      databases[name] = databaseNames[name as keyof typeof databaseNames]
    }
  }
  return { files, databases }
}
