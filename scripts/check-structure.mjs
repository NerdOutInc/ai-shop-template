import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { isFrameworkFile, sourceAreas, sourceConventions, toolConfigurations } from "./architecture/paths.mjs"

const kebab = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const ignored = new Set([
  ".git",
  ".playwright-cli",
  ".agents",
  ".next",
  ".tmp",
  ".turbo",
  ".vercel",
  "node_modules",
  "assets",
  "coverage",
  "playwright-report",
  "test-results",
  "storybook-static",
  "out",
  "output",
  "dist",
])
const sourceExtension = /\.[cm]?[jt]sx?$/
const sourceSuffixes = new Set(["test", "stories", "server", "client", "d"])

function routeDirectory(name) {
  if (kebab.test(name) || name === "_components") return true
  const match = name.match(
    /^(?:\[\[\.\.\.([^\]]+)\]\]|\[\.\.\.([^\]]+)\]|\[([^\]]+)\]|\(([^)]+)\)|@(.+)|(?:\(\.\)|\(\.\.\)|\(\.\.\)\(\.\.\)|\(\.\.\.\))(.+))$/
  )
  return !!match && kebab.test(match.slice(1).find(Boolean))
}

function validFilename(name, e2e = false) {
  const parts = name.split(".")
  if (!kebab.test(parts.shift())) return false
  parts.pop()
  return parts.every(
    (part) =>
      sourceSuffixes.has(part) ||
      (e2e && part === "spec") ||
      (part === "module" && name.endsWith(".css")) ||
      (part === "alt" && name.endsWith(".txt"))
  )
}

export function checkStructure(root) {
  const errors = []
  const files = new Set()
  const directories = []
  function walk(relative = "") {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      if ((relative === "" && ignored.has(entry.name)) || (relative === "scripts" && entry.name === "artwork")) continue
      const filename = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) {
        if (/^(?:src|test|e2e)(?:\/|$)/.test(filename))
          errors.push(`${filename}: source symlinks are not allowed; they bypass ownership checks`)
        continue
      }
      if (entry.isDirectory()) {
        directories.push(filename)
        walk(filename)
      } else if (entry.isFile()) files.add(filename)
    }
  }
  walk()
  for (const directory of directories) {
    if (!/^(?:src|e2e|test)\//.test(directory)) continue
    const parts = directory.split("/")
    if (parts[0] === "src" && !sourceAreas.has(parts[1]))
      errors.push(`${directory}: use src/app, features, components, hooks, or lib`)
    const name = parts.at(-1)
    const route = directory.startsWith("src/app/") && !parts.includes("_components")
    if (
      !(route ? routeDirectory(name) : kebab.test(name)) &&
      !(name === "_components" && directory.startsWith("src/app/"))
    )
      errors.push(`${directory}: use kebab-case directories (Next route syntax and _components are allowed under app)`)
  }
  for (const filename of files) {
    const name = path.posix.basename(filename)
    const source = filename.startsWith("src/")
    const support = /^(?:e2e|test)\//.test(filename)
    if (
      sourceExtension.test(filename) &&
      !source &&
      !support &&
      !filename.startsWith("scripts/") &&
      !toolConfigurations.has(filename) &&
      filename !== "next-env.d.ts" &&
      filename !== ".storybook/vitest.setup.ts"
    ) {
      errors.push(`${filename}: application source belongs in src/; test support belongs in test/ or e2e/`)
    }
    if (!source && !support) continue
    const parts = filename.split("/")
    if (source && parts.length === 2 && !sourceConventions.has(name))
      errors.push(`${filename}: only Next convention files belong directly in src/`)
    if (source && parts.length > 2 && !sourceAreas.has(parts[1])) errors.push(`${filename}: unknown source area`)
    if (source && parts[1] === "features" && parts.length < 4)
      errors.push(`${filename}: place feature code in src/features/<feature>/`)
    if (!validFilename(name, parts[0] === "e2e"))
      errors.push(`${filename}: use kebab-case filenames and approved suffixes`)
    if (sourceExtension.test(filename) && !/\.tsx?$/.test(filename))
      errors.push(`${filename}: application and test source must use TypeScript`)
    if (/^index\.[cm]?[jt]sx?$/.test(name))
      errors.push(`${filename}: use a descriptive filename; index barrels are not allowed`)
    if (
      source &&
      filename.startsWith("src/app/") &&
      sourceExtension.test(filename) &&
      !parts.includes("_components") &&
      !isFrameworkFile(filename) &&
      !/\.(?:test|stories)\.tsx?$/.test(filename)
    )
      errors.push(`${filename}: app contains Next convention files; route-local implementation belongs in _components`)
    if (source && /\.(?:test|stories)\.tsx?$/.test(name)) {
      const stem = filename.replace(/\.(?:test|stories)\.tsx?$/, "")
      if (![`${stem}.ts`, `${stem}.tsx`].some((candidate) => files.has(candidate)))
        errors.push(`${filename}: colocate with a matching implementation file`)
    }
    if (support && parts[0] === "test" && /\.(?:test|stories|spec)\.tsx?$/.test(name))
      errors.push(
        `${filename}: test/ is shared setup/support; colocate unit tests and stories with source, and put browser specs in e2e/`
      )
    if (source && /\.spec\.tsx?$/.test(name))
      errors.push(`${filename}: browser specs belong in e2e/; unit tests use .test`)
  }
  return [...new Set(errors)].sort()
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkStructure(process.cwd())
  if (errors.length) {
    process.stderr.write(`${errors.join("\n")}\n`)
    process.exitCode = 1
  } else process.stdout.write("File organization and naming checks passed.\n")
}
