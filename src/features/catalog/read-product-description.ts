import type { CatalogDescriptionBlock, CatalogSizeGuide } from "./catalog-product"
import { parseDescriptionBlocks } from "./parse-description-blocks"
import { readDescriptionTables } from "./read-description-tables"

function textContent(html: string) {
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  }
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
      if (!code.startsWith("#")) return entities[code.toLowerCase()] ?? entity
      const point = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : ""
    })
    .replace(/\s+/g, " ")
    .trim()
}

function attributes(tag: string) {
  return [...tag.replace(/^<\w+\b/, "").matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map(
    ([, name, quoted, singleQuoted, unquoted]) => ({
      name: name!.toLowerCase(),
      value: quoted ?? singleQuoted ?? unquoted ?? "",
    })
  )
}

function isSizeLabel(label: string) {
  const normalized = label.toUpperCase().replace(/^YOUTH\s+/, "Y")
  return normalized
    .split(/\s*[/–-]\s*/)
    .every((size) => /^(?:ONE SIZE(?: FITS ALL)?|Y?(?:[SML]|X{1,4}[SL]|\d{1,2}X[SL])|\d{1,3})$/.test(size))
}

function readTable(table: string, explicitlyMarked: boolean): CatalogSizeGuide | null {
  // Merged cells and nested tables need a different layout model; flattening them can shift measurements.
  if ((table.match(/<table\b/gi)?.length ?? 0) !== 1) return null
  const cells = [...table.matchAll(/<t[hd]\b[^>]*>/gi)]
  if (
    cells.some(([tag]) =>
      attributes(tag).some(({ name, value }) => (name === "colspan" || name === "rowspan") && Number(value) !== 1)
    )
  )
    return null
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)].map((row) =>
    [...row[1]!.matchAll(/<t([hd])\b[^>]*>([\s\S]*?)<\/t\1\s*>/gi)].map((cell) => textContent(cell[2]!))
  )
  const sizes = rows[0]?.slice(1) ?? []
  const measurements = rows.slice(1).map(([label, ...values]) => ({ label: label ?? "", values }))
  if (
    rows.length !== (table.match(/<tr\b/gi)?.length ?? 0) ||
    rows.flat().length !== cells.length ||
    !sizes.length ||
    sizes.some((size) => !size) ||
    !measurements.length ||
    measurements.some((row) => !row.label || row.values.length !== sizes.length)
  )
    return null

  if (!explicitlyMarked) {
    // Printify's rich-text editor can drop the table ID. Recognize its apparel matrix by content,
    // not styling, while leaving unrelated tables (prices, shipping, etc.) in the description.
    const measurementLabel = /^[a-z][a-z\d ()/.'-]*,\s*(in|cm)$/i
    const units = measurements.map(({ label }) => label.match(measurementLabel)?.[1]?.toLowerCase())
    if (
      !/^(?:size|measurement)?$/i.test(rows[0]?.[0] ?? "") ||
      !sizes.every(isSizeLabel) ||
      new Set(sizes.map((size) => size.toUpperCase())).size !== sizes.length ||
      units.some((unit) => !unit) ||
      new Set(units).size !== 1 ||
      measurements.every(({ label }) => /^size tolerance,/i.test(label)) ||
      new Set(measurements.map(({ label }) => label.toLowerCase())).size !== measurements.length ||
      !measurements.every(({ values }) => values.every((value) => /^\d+(?:\.\d+)?$/.test(value)))
    )
      return null
  }
  return { sizes, measurements }
}

export function readProductDescription(html: string): {
  description: string
  descriptionBlocks: CatalogDescriptionBlock[]
  sizeGuide: CatalogSizeGuide | null
} {
  const content = html.replace(
    /<!--[\s\S]*?(?:-->|$)|<(script|style|template|iframe|object|svg|math)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,
    ""
  )
  const tables = readDescriptionTables(content).map(({ table, index, end }) => {
    const explicitlyMarked = attributes(table.match(/^<table\b[^>]*>/i)![0]).some(
      ({ name, value }) => name === "id" && value.toLowerCase() === "size-guide"
    )
    return { index, end, explicitlyMarked, guide: readTable(table, explicitlyMarked) }
  })
  const marked = tables.filter(({ explicitlyMarked }) => explicitlyMarked)
  // An explicit chart wins. With no marker, accept only one recognizable matrix, never an arbitrary first table.
  const candidates = marked.length ? marked : tables.filter(({ guide }) => guide)
  const selected = candidates.length === 1 ? candidates[0] : undefined
  const sizeGuide = selected?.guide ?? null
  // Return text and table cells only. Provider HTML is never inserted into the document.
  const prose = sizeGuide && selected ? content.slice(0, selected.index) + content.slice(selected.end) : content
  const description = prose
    .replace(/<(?:br|\/p|\/div|\/li)\b[^>]*>/gi, "\n")
    .split("\n")
    .map(textContent)
    .filter(Boolean)
    .join("\n")
  return { description, descriptionBlocks: parseDescriptionBlocks(prose), sizeGuide }
}
