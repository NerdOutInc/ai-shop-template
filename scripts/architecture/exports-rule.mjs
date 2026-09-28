import { exportException, relativePath } from "./paths.mjs"

function bindings(pattern) {
  if (!pattern) return []
  if (pattern.type === "Identifier") return [pattern.name]
  if (pattern.type === "RestElement") return bindings(pattern.argument)
  if (pattern.type === "AssignmentPattern") return bindings(pattern.left)
  if (pattern.type === "ArrayPattern") return pattern.elements.flatMap(bindings)
  if (pattern.type === "ObjectPattern")
    return pattern.properties.flatMap((property) =>
      bindings(property.type === "RestElement" ? property.argument : property.value)
    )
  return []
}

export function createExportsRule(root) {
  return {
    meta: {
      type: "problem",
      schema: [],
      messages: {
        multiple:
          "Export at most one runtime unit per file; associated type exports and private helpers may stay together.",
        barrel: "Import directly from the defining file; re-export barrels are not allowed.",
        default: "Use a named export; default exports are reserved for exact framework and tool conventions.",
      },
    },
    create(context) {
      const filename = relativePath(root, context.physicalFilename)
      const exempt = exportException(filename)
      const exported = new Set()
      const imports = new Set()
      const declarations = []
      function isRuntimeBinding(specifier) {
        for (let scope = context.sourceCode.getScope(specifier); scope; scope = scope.upper) {
          const variable = scope.set.get(specifier.local.name)
          if (variable) return variable.isValueVariable
        }
        return true
      }
      return {
        ImportDeclaration(node) {
          for (const specifier of node.specifiers) imports.add(specifier.local.name)
        },
        ExportAllDeclaration(node) {
          context.report({ node, messageId: "barrel" })
        },
        ExportDefaultDeclaration(node) {
          if (!exempt) context.report({ node, messageId: "default" })
        },
        ExportNamedDeclaration(node) {
          declarations.push(node)
        },
        "Program:exit"(program) {
          for (const node of declarations) {
            if (node.source) {
              context.report({ node, messageId: "barrel" })
              continue
            }
            for (const specifier of node.specifiers) {
              const exportedName = specifier.exported.name ?? specifier.exported.value
              if (!exempt && exportedName === "default") context.report({ node: specifier, messageId: "default" })
            }
            if (node.exportKind === "type") {
              for (const specifier of node.specifiers) {
                if (imports.has(specifier.local.name)) context.report({ node: specifier, messageId: "barrel" })
              }
              continue
            }
            if (node.declaration) {
              const declaration = node.declaration
              if (
                declaration.declare ||
                ["TSInterfaceDeclaration", "TSTypeAliasDeclaration"].includes(declaration.type)
              )
                continue
              if (declaration.type === "VariableDeclaration") {
                for (const entry of declaration.declarations)
                  for (const binding of bindings(entry.id)) exported.add(binding)
              } else if (declaration.id) exported.add(declaration.id.name)
            }
            for (const specifier of node.specifiers) {
              const name = specifier.local.name
              if (imports.has(name)) context.report({ node: specifier, messageId: "barrel" })
              else if (specifier.exportKind !== "type" && isRuntimeBinding(specifier)) exported.add(name)
            }
          }
          if (!exempt && exported.size > 1) context.report({ node: program, messageId: "multiple" })
        },
      }
    },
  }
}
