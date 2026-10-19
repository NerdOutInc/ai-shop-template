import { existsSync } from "node:fs"

import { assertIsolatedDatabase } from "./assert-isolated-database"

import { resolveCommerceTestScope } from "./resolve-commerce-test-scope"

export function assertCommerceTestScope(environment: NodeJS.ProcessEnv = process.env) {
  const commerceScope = resolveCommerceTestScope(environment)
  for (const filename of commerceScope.files) {
    if (!existsSync(new URL(`../${filename}`, import.meta.url))) {
      throw new Error(`[commerce tests] Required test file is missing: ${filename}`)
    }
  }

  for (const [name, database] of Object.entries(commerceScope.databases)) {
    try {
      assertIsolatedDatabase(environment[name]?.trim(), database)
    } catch {
      throw new Error(`[commerce tests] ${name} must name disposable local ${database}; no tests were started.`)
    }
  }
}
