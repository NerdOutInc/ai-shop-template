import type { Plugin } from "vite"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Resolve both alias and relative imports at the harness boundary. Production has
// no test-mode switch and still parses the merchant's own configuration.
export function storeConfigPlugin(): Plugin {
  const production = fileURLToPath(new URL("../src/lib/store-config.ts", import.meta.url))
  const fixture = fileURLToPath(new URL("./store-config.ts", import.meta.url))
  return {
    name: "test-store-config",
    enforce: "pre",
    resolveId(source, importer) {
      const candidate = source.startsWith("@/")
        ? path.resolve(path.dirname(production), "..", source.slice(2))
        : source.startsWith(".") && importer
          ? path.resolve(path.dirname(importer.split("?")[0]!), source)
          : source
      if (candidate === production || `${candidate}.ts` === production) return fixture
    },
  }
}
