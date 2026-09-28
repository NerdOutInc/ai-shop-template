import ts from "typescript"

/** Read the supported public configuration shape without importing or executing it. */
export function isConfiguredStore(bytes) {
  if (!bytes) return false
  const source = ts.createSourceFile("store-config.ts", bytes.toString("utf8"), ts.ScriptTarget.Latest, true)
  if (source.parseDiagnostics.length) return false
  let declaration
  let references = 0
  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === "storeConfig") references++
    ts.forEachChild(node, visit)
  }
  visit(source)
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue
    if (!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
    for (const candidate of statement.declarationList.declarations) {
      if (ts.isIdentifier(candidate.name) && candidate.name.text === "storeConfig") declaration = candidate
    }
  }
  // A later mutation, alias or duplicate binding makes the final flag uncertain.
  if (!declaration || references !== 1) return false
  let object = declaration.initializer
  const unwrap = (node) => {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node))) {
      node = node.expression
    }
    return node
  }
  object = unwrap(object)
  if (object && ts.isCallExpression(object)) {
    const callee = object.expression
    if (
      !ts.isPropertyAccessExpression(callee) ||
      !ts.isIdentifier(callee.expression) ||
      callee.expression.text !== "storeSchema" ||
      callee.name.text !== "parse" ||
      object.arguments.length !== 1 ||
      object.questionDotToken ||
      callee.questionDotToken
    )
      return false
    object = unwrap(object.arguments[0])
  }
  if (!object || !ts.isObjectLiteralExpression(object)) return false
  let configured
  for (const property of object.properties) {
    // Spreads, accessors and computed names could overwrite the literal flag.
    if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)))
      return false
    if (property.name.text !== "configured") continue
    if (configured) return false
    configured = property.initializer
  }
  return configured?.kind === ts.SyntaxKind.TrueKeyword
}
