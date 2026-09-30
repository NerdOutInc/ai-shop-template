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
          (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === "storeConfigValues"
        )
      : []
  )
  let initializer = declarations[0]?.initializer
  if (declarations.length !== 1 || !initializer)
    throw new Error("Expected exactly one exported const storeConfigValues with an initializer")

  while (
    ts.isSatisfiesExpression(initializer) ||
    ts.isAsExpression(initializer) ||
    ts.isParenthesizedExpression(initializer)
  ) {
    initializer = initializer.expression
  }

  // The production loader validates this owner-data module in the generated build.
  // Validate here too so malformed fixtures fail before starting a build.
  const replacement = JSON.stringify(config, null, 2)
  return `${source.slice(0, initializer.getStart(file))}${replacement}${source.slice(initializer.end)}`
}
