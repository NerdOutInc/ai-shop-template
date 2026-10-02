import { existsSync } from "node:fs"

import commerceScope from "../scripts/ci/commerce-test-scope.json"

export function assertCommerceTestScope(environment: NodeJS.ProcessEnv = process.env) {
  for (const filename of commerceScope.files) {
    if (!existsSync(new URL(`../${filename}`, import.meta.url))) {
      throw new Error(`[commerce tests] Required test file is missing: ${filename}`)
    }
  }

  for (const [name, database] of Object.entries(commerceScope.databases)) {
    const value = environment[name]?.trim()
    let url: URL | undefined
    try {
      url = value ? new URL(value) : undefined
    } catch {
      // Report the variable only: database URLs can contain credentials.
    }
    if (
      !url ||
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.pathname !== `/${database}` ||
      url.search ||
      url.hash
    ) {
      throw new Error(`[commerce tests] ${name} must name disposable local ${database}; no tests were started.`)
    }
  }
}
