import path from "node:path"
import tsParser from "@typescript-eslint/parser"
import { importX } from "eslint-plugin-import-x"
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript"
import { createExportsRule } from "./exports-rule.mjs"
import { createImportsRule } from "./imports-rule.mjs"

export function createArchitectureConfig(root) {
  const resolver = createTypeScriptImportResolver({ project: path.join(root, "tsconfig.json"), alwaysTryTypes: true })
  return {
    name: "your-store/architecture",
    files: ["src/**/*.{ts,tsx}", "e2e/**/*.{ts,tsx}", "test/**/*.{ts,tsx}", ".storybook/**/*.{ts,tsx}"],
    languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: "latest", sourceType: "module" } },
    plugins: {
      "import-x": importX,
      architecture: { rules: { imports: createImportsRule(root, resolver), exports: createExportsRule(root) } },
    },
    settings: {
      "import-x/resolver-next": [resolver],
      "import-x/parsers": { "@typescript-eslint/parser": [".ts", ".tsx"] },
      "import-x/extensions": [".ts", ".tsx", ".js", ".jsx"],
      "import-x/internal-regex": "^@/",
    },
    rules: {
      "architecture/imports": "error",
      "architecture/exports": "error",
      "import-x/no-unresolved": "error",
      "import-x/no-self-import": "error",
      "import-x/no-cycle": ["error", { ignoreExternal: true, allowUnsafeDynamicCyclicDependency: false }],
      "import-x/no-commonjs": "error",
    },
  }
}
