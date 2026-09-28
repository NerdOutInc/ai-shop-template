import { isGarmentDetailHeading } from "@/features/catalog/is-garment-detail-heading"
import { isGarmentSectionTitle } from "@/features/catalog/is-garment-section-title"
import { parseDescriptionBlocks } from "@/features/catalog/parse-description-blocks"
import { readDescriptionTables } from "@/features/catalog/read-description-tables"
import { readProductDescription } from "@/features/catalog/read-product-description"
import { readSectionTitle } from "@/features/catalog/read-section-title"

function hasSizeGuideMarker(table: string) {
  return [...table.matchAll(/<table\b[^>]*>/gi)].some(([tag]) =>
    [...tag.replace(/^<\w+\b/i, "").matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].some(
      ([, name, quoted, singleQuoted, unquoted]) =>
        name!.toLowerCase() === "id" && (quoted ?? singleQuoted ?? unquoted ?? "").toLowerCase() === "size-guide"
    )
  )
}

/**
 * Recover garment prose and one authoritative chart, including charts before the old design blurb.
 * The title is the donor's own, so a heading that repeats it is never taken for the garment.
 */
export function readGarmentDescription(html: string, productTitle: string) {
  // Apply the same visible-content boundary as the storefront before selecting any source facts.
  const content = html.replace(
    /<!--[\s\S]*?(?:-->|$)|<(script|style|template|iframe|object|svg|math)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,
    ""
  )
  const tables = readDescriptionTables(content)
  const tableTagCount = (value: string) => (value.match(/<\/?table\b[^>]*>/gi) ?? []).length
  if (tables.reduce((count, { table }) => count + tableTagCount(table), 0) !== tableTagCount(content)) return null
  const parsed = tables.map((entry) => ({ ...entry, guide: readProductDescription(entry.table).sizeGuide }))
  // A malformed explicit chart cannot be replaced with another table elsewhere in the description.
  if (parsed.some(({ table, guide }) => hasSizeGuideMarker(table) && !guide)) return null
  const charts = parsed.filter(({ guide }) => guide !== null)
  const first = charts[0]
  if (!first?.guide || charts.some(({ guide }) => JSON.stringify(guide) !== JSON.stringify(first.guide))) return null

  // A list item is content, never a section title, just as the storefront reads it.
  const inList = (index: number) => {
    const before = content.slice(0, index)
    return (before.match(/<[ou]l\b/gi)?.length ?? 0) > (before.match(/<\/[ou]l\s*>/gi)?.length ?? 0)
  }
  const headings = [...content.matchAll(/<(p|h[1-6])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)]
    .filter((match) => !tables.some(({ index, end }) => match.index >= index && match.index < end))
    .map((match) => {
      const blocks = parseDescriptionBlocks(match[0])
      const title = blocks.length === 1 && !inList(match.index) ? readSectionTitle(blocks[0]!) : null
      return {
        index: match.index,
        end: match.index + match[0].length,
        text: match[2]!
          .replace(/<[^>]*>/g, "")
          .replace(/&nbsp;/gi, " ")
          .replace(/\s+/g, " ")
          .trim(),
        garment: title !== null && isGarmentSectionTitle(title, productTitle),
      }
    })
  const isSizingHeading = (text: string) => /^(?:size guide|sizing)[\s:]*$/i.test(text)
  // Start where the product page's "The garment" starts, whatever the garment is called, so a crop
  // top's copy begins at "The crop top" rather than at "Care". The named headings still count, so a
  // donor with only a care section keeps lending its chart.
  const start = headings.find(
    ({ text, garment }) => garment || (isGarmentDetailHeading(text) && !isSizingHeading(text))
  )
  if (!start) return null
  const captions = headings.filter(
    (heading) =>
      isSizingHeading(heading.text) &&
      charts.some(({ index }) => heading.end <= index && !content.slice(heading.end, index).trim())
  )
  const omitted = [...charts, ...captions].toSorted((a, b) => a.index - b.index)
  let cursor = start.index
  let prose = ""
  for (const { index, end } of omitted) {
    if (end <= cursor) continue
    prose += content.slice(cursor, Math.max(cursor, index))
    cursor = end
  }
  prose += content.slice(cursor)
  // Preserve inline text spacing and styles while removing provider indentation that can exceed
  // the draft limit. Concatenation also preserves literal dollar replacement tokens in cell text.
  const compactTable = first.table
    .replace(/(<(?:table|thead|tbody|tfoot|tr)\b[^>]*>|<\/(?:thead|tbody|tfoot|tr|th|td)\s*>)\s+(?=<)/gi, "$1")
    .replace(/(<t[dh]\b[^>]*>)\s+/gi, "$1")
    .replace(/\s+(<\/t[dh]>)/gi, "$1")
  return { description: `${prose}${compactTable}`, sizeGuide: first.guide }
}
