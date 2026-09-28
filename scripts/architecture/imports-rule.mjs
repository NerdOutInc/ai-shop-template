import path from "node:path"
import { area, isDevelopmentFile, localUnit, relativePath, routeOwner, within } from "./paths.mjs"

const allowed = {
  app: new Set(["app", "features", "components", "hooks", "lib"]),
  features: new Set(["features", "components", "hooks", "lib"]),
  components: new Set(["components", "hooks", "lib"]),
  hooks: new Set(["hooks", "lib"]),
  lib: new Set(["lib"]),
}

export function createImportsRule(root, resolver) {
  return {
    meta: {
      type: "problem",
      schema: [],
      messages: {
        layer: "{{from}} cannot import {{to}}; move shared responsibilities to the appropriate shared area.",
        private: "Route-local components belong to {{owner}} and its descendants.",
        development: "Production source cannot import tests, stories, or test support.",
        relative: "Use a relative import within this feature or local unit.",
        alias: "Use @/ when importing across source areas or local units.",
        literal: "Use a quoted string literal in import() so dependency checks can analyze it.",
        commonjs: "Use ES module imports; require() and TypeScript import-equals bypass the source import contract.",
        outside:
          "Source code may not import project tooling or files outside src/; tests and stories may use test/ support.",
        source: "Use @/ or a relative path for application source imports.",
      },
    },
    create(context) {
      const filename = relativePath(root, context.physicalFilename)
      function check(node, source) {
        if (typeof source !== "string") return
        // Resolution is supplied by the maintained TypeScript resolver, shared with import-x.
        const result = resolver.resolve(source, context.physicalFilename)
        if (!result.found || !result.path) return // import-x/no-unresolved reports unresolved modules.
        const target = relativePath(root, result.path)
        if (target.includes("/node_modules/") || target.startsWith("node_modules/")) return
        const fromArea = area(filename)
        const toArea = area(target)
        if (!isDevelopmentFile(filename) && isDevelopmentFile(target))
          context.report({ node, messageId: "development" })
        const sharedTestSupport = isDevelopmentFile(filename) && target.startsWith("test/")
        if (fromArea && !toArea && !sharedTestSupport && /\.[cm]?[jt]sx?$/.test(target))
          context.report({ node, messageId: "outside" })
        if (fromArea && toArea && !allowed[fromArea].has(toArea))
          context.report({ node, messageId: "layer", data: { from: fromArea, to: toArea } })
        const owner = routeOwner(target)
        if (owner && !within(filename, owner)) context.report({ node, messageId: "private", data: { owner } })
        if (!toArea) return
        const sameUnit = localUnit(filename) === localUnit(target)
        const isRelative = source.startsWith("./") || source.startsWith("../")
        if (sameUnit && !isRelative) context.report({ node, messageId: "relative" })
        else if (!sameUnit && !source.startsWith("@/")) context.report({ node, messageId: "alias" })
        else if (!isRelative && !source.startsWith("@/")) context.report({ node, messageId: "source" })
        if (path.isAbsolute(source)) context.report({ node, messageId: "source" })
      }
      return {
        ImportDeclaration(node) {
          check(node.source, node.source.value)
        },
        ExportNamedDeclaration(node) {
          if (node.source) check(node.source, node.source.value)
        },
        ExportAllDeclaration(node) {
          check(node.source, node.source.value)
        },
        ImportExpression(node) {
          if (node.source.type !== "Literal" || typeof node.source.value !== "string")
            context.report({ node: node.source, messageId: "literal" })
          else check(node.source, node.source.value)
        },
        TSImportType(node) {
          const argument = node.argument ?? node.parameter
          const literal = argument?.literal ?? argument
          if (literal?.type === "Literal") check(literal, literal.value)
        },
        TSImportEqualsDeclaration(node) {
          context.report({ node, messageId: "commonjs" })
        },
        CallExpression(node) {
          if (node.callee.type === "Identifier" && node.callee.name === "require")
            context.report({ node, messageId: "commonjs" })
        },
      }
    },
  }
}
