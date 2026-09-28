import ts from "typescript"

import { storeConfigSchema } from "@/lib/store-config-schema"

export function createStoreConfigSource(source: string, fixture: unknown): string {
  const config = storeConfigSchema.parse(fixture)
  const file = ts.createSourceFile("store-config.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declarations = file.statements.flatMap((statement) =>
    ts.isVariableStatement(statement) &&
    statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) &&
    (statement.declarationList.flags & ts.NodeFlags.Const) !== 0
      ? statement.declarationList.declarations.filter(
          (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === "storeConfig"
        )
      : []
  )
  const initializer = declarations[0]?.initializer
  if (declarations.length !== 1 || !initializer)
    throw new Error("Expected exactly one exported const storeConfig with an initializer")

  const identifiers = new Set<string>()
  const collectIdentifiers = (node: ts.Node) => {
    if (ts.isIdentifier(node)) identifiers.add(node.text)
    ts.forEachChild(node, collectIdentifiers)
  }
  collectIdentifiers(file)
  let schemaName = "fixtureStoreConfigSchema"
  for (let suffix = 2; identifiers.has(schemaName); suffix++) schemaName = `fixtureStoreConfigSchema${suffix}`

  const replacement = `${schemaName}.parse(${JSON.stringify(config, null, 2)})`
  const replaced = `${source.slice(0, initializer.getStart(file))}${replacement}${source.slice(initializer.end)}`
  let importPosition = ts.getShebang(source)?.length ?? 0
  for (const statement of file.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break
    importPosition = statement.end
  }
  // Keep directives first and preserve existing leading comments on their own
  // declarations. The new import must precede use even when compiled to CommonJS.
  const schemaImport = `\nimport { storeConfigSchema as ${schemaName} } from "./store-config-schema"\n`
  return `${replaced.slice(0, importPosition)}${schemaImport}${replaced.slice(importPosition)}`
}
