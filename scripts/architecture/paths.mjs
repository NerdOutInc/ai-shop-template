import path from "node:path"

export const sourceAreas = new Set(["app", "features", "components", "hooks", "lib"])
export const sourceConventions = new Set([
  "proxy.ts",
  "instrumentation.ts",
  "instrumentation-client.ts",
  "mdx-components.tsx",
])
export const primitiveExceptions = new Set([
  "src/components/ui/button.tsx",
  "src/components/ui/tooltip.tsx",
  "src/components/ui/carousel.tsx",
  "src/components/ui/alert.tsx",
  "src/components/ui/badge.tsx",
  "src/components/ui/empty.tsx",
  "src/components/ui/field.tsx",
  "src/components/ui/native-select.tsx",
  "src/components/ui/toggle-group.tsx",
  "src/components/ui/toggle.tsx",
  "src/components/ui/dialog.tsx",
  "src/components/ui/dropdown-menu.tsx",
])
export const toolConfigurations = new Set([
  "next.config.ts",
  "eslint.config.mjs",
  "postcss.config.mjs",
  "prettier.config.mjs",
  "vitest.config.ts",
  "playwright.config.ts",
  ".storybook/main.ts",
  ".storybook/preview.ts",
  ".storybook/preview.tsx",
])

const routeComponents = /^(?:page|layout|loading|error|not-found|template|default|forbidden|unauthorized)\.tsx?$/
const routeMetadata = /^(?:(?:icon|apple-icon|opengraph-image|twitter-image)\d?|sitemap)\.tsx?$/
const rootOnlyConventions = /^(?:global-error|global-not-found|robots|manifest)\.tsx?$/

export function relativePath(root, filename) {
  return path.relative(root, filename).split(path.sep).join("/")
}

export function within(filename, directory) {
  return filename === directory || filename.startsWith(`${directory}/`)
}

export function isFrameworkFile(filename) {
  if (filename.startsWith("src/") && sourceConventions.has(filename.slice(4))) return true
  if (!filename.startsWith("src/app/") || filename.split("/").some((part) => part.startsWith("_"))) return false
  const name = path.posix.basename(filename)
  if (rootOnlyConventions.test(name)) return path.posix.dirname(filename) === "src/app"
  return /^route\.tsx?$/.test(name) || routeComponents.test(name) || routeMetadata.test(name)
}

export function exportException(filename) {
  return (
    isFrameworkFile(filename) ||
    primitiveExceptions.has(filename) ||
    toolConfigurations.has(filename) ||
    /\.stories\.tsx?$/.test(filename)
  )
}

export function area(filename) {
  if (!filename.startsWith("src/")) return null
  const name = filename.split("/")[1]
  return sourceAreas.has(name) ? name : "app"
}

export function routeOwner(filename) {
  const parts = filename.split("/")
  const index = parts.indexOf("_components")
  return parts[0] === "src" && parts[1] === "app" && index !== -1 ? parts.slice(0, index).join("/") : null
}

export function localUnit(filename) {
  const parts = filename.split("/")
  if (parts[0] === "src" && parts[1] === "features") return parts.slice(0, 3).join("/")
  if (parts[0] === "src" && parts[1] === "app") return routeOwner(filename) ?? path.posix.dirname(filename)
  return path.posix.dirname(filename)
}

export function isDevelopmentFile(filename) {
  return /\.(?:test|stories|spec)\.[cm]?[jt]sx?$/.test(filename) || /^(?:test|e2e|\.storybook)\//.test(filename)
}
