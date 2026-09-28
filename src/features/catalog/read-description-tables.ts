/** Complete top-level tables and their exact spans, retaining nested tables for strict validation. */
export function readDescriptionTables(html: string) {
  const tables: { table: string; index: number; end: number }[] = []
  let depth = 0
  let start = 0
  for (const match of html.matchAll(/<\/?table\b[^>]*>/gi)) {
    if (!match[0].startsWith("</")) {
      if (depth === 0) start = match.index
      depth++
    } else if (depth > 0) {
      depth--
      if (depth === 0) {
        const end = match.index + match[0].length
        tables.push({ table: html.slice(start, end), index: start, end })
      }
    }
  }
  return tables
}
