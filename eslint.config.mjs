import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTypescript from "eslint-config-next/typescript"
import { fileURLToPath } from "node:url"
import reactPackage from "react/package.json" with { type: "json" }
import { createArchitectureConfig } from "./scripts/architecture/eslint-config.mjs"

const root = fileURLToPath(new URL(".", import.meta.url))

export default defineConfig([
  globalIgnores([
    ".agents/**",
    "assets/**",
    "scripts/artwork/**",
    ".next/**",
    ".vercel/**",
    "node_modules/**",
    "storybook-static/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "out/**",
    "dist/**",
    "output/**",
    ".tmp/**",
    ".turbo/**",
    ".playwright-cli/**",
    "next-env.d.ts",
  ]),
  ...nextVitals,
  ...nextTypescript,
  // eslint-plugin-react detects the React version with context.getFilename(), which ESLint 10 removed.
  { settings: { react: { version: reactPackage.version } } },
  createArchitectureConfig(root),
])
