import type { CatalogDescriptionBlock, CatalogDescriptionInline } from "./catalog-product"

type Context = { blocks: CatalogDescriptionBlock[]; content: CatalogDescriptionInline[]; heading: boolean }
type List = {
  tag: string
  block: Extract<CatalogDescriptionBlock, { type: "list" }>
  item: Context | null
}

function decodeText(text: string) {
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  }
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
    if (!code.startsWith("#")) return entities[code.toLowerCase()] ?? entity
    const point = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : ""
  })
}

function flush(context: Context) {
  const first = context.content[0]
  const last = context.content.at(-1)
  if (first) first.text = first.text.trimStart()
  if (last) last.text = last.text.trimEnd()
  const content = context.content.filter((part) => part.text)
  if (content.length) context.blocks.push({ type: context.heading ? "heading" : "paragraph", content })
  context.content = []
  context.heading = false
}

export function parseDescriptionBlocks(html: string): CatalogDescriptionBlock[] {
  const root: Context = { blocks: [], content: [], heading: false }
  const lists: List[] = []
  let bold = 0
  let italic = 0

  function context() {
    const list = lists.at(-1)
    if (!list) return root
    if (!list.item) {
      list.item = { blocks: [], content: [], heading: false }
      list.block.items.push(list.item.blocks)
    }
    return list.item
  }

  function append(text: string) {
    if (!text) return
    const current = context()
    const previous = current.content.at(-1)
    if (previous && previous.bold === Boolean(bold) && previous.italic === Boolean(italic)) {
      previous.text += text
    } else {
      current.content.push({ text, bold: Boolean(bold), italic: Boolean(italic) })
    }
  }

  // This is a formatting reader, not an HTML renderer: only text and these typed blocks leave it.
  // Drop non-prose containers, including unfinished ones, before recognizing the small supported tag set.
  const prose = html.replace(
    /<!--[\s\S]*?(?:-->|$)|<(script|style|template|iframe|object|svg|math)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,
    ""
  )
  if (!/<\/?[a-z][^>]*>/i.test(prose)) {
    return prose.split(/\n+/).flatMap((line) => {
      const text = decodeText(line).replace(/\s+/g, " ").trim()
      return text ? [{ type: "paragraph" as const, content: [{ text, bold: false, italic: false }] }] : []
    })
  }
  const tokens = prose.match(/<[^>]*>|[^<]+|</g) ?? []
  for (const token of tokens) {
    const tag = token.match(/^<\s*(\/?)\s*([a-z][\da-z]*)\b/i)
    if (!tag) {
      // Literal newlines in HTML are whitespace; paragraph and br tags control the layout.
      const text = decodeText(token).replace(/\s+/g, " ")
      if (text.trim() || context().content.length) append(text)
      continue
    }
    const closing = Boolean(tag[1])
    const name = tag[2]!.toLowerCase()
    if (name === "strong" || name === "b") bold = Math.max(0, bold + (closing ? -1 : 1))
    else if (name === "em" || name === "i") italic = Math.max(0, italic + (closing ? -1 : 1))
    else if (name === "br" && !closing) append("\n")
    else if (/^(p|div|h[1-6])$/.test(name)) {
      flush(context())
      if (!closing) context().heading = /^h[1-6]$/.test(name)
    } else if (name === "ul" || name === "ol") {
      if (closing) {
        const index = lists.findLastIndex((list) => list.tag === name)
        if (index < 0) continue
        while (lists.length > index) {
          const list = lists.pop()!
          if (list.item) flush(list.item)
          list.block.items = list.block.items.filter((item) => item.length)
        }
      } else {
        // The supported description format does not need arbitrarily deep provider-controlled nesting.
        if (lists.length >= 8) continue
        const parent = context()
        flush(parent)
        const block: Extract<CatalogDescriptionBlock, { type: "list" }> = {
          type: "list",
          ordered: name === "ol",
          items: [],
        }
        parent.blocks.push(block)
        lists.push({ tag: name, block, item: null })
      }
    } else if (name === "li") {
      const list = lists.at(-1)
      if (list) {
        if (list.item) flush(list.item)
        list.item = null
        if (!closing) context()
      } else flush(root)
    } else if (/^(table|thead|tbody|tfoot|tr|td|th)$/.test(name)) {
      append(" ")
    }
  }
  while (lists.length) {
    const list = lists.pop()!
    if (list.item) flush(list.item)
    list.block.items = list.block.items.filter((item) => item.length)
  }
  flush(root)
  return root.blocks
}
