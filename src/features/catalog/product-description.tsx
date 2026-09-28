import { Fragment } from "react"

import type { CatalogDescriptionBlock, CatalogDescriptionInline } from "./catalog-product"

function renderInline(content: CatalogDescriptionInline[]) {
  return content.map((part, index) => {
    const text = part.italic ? <em>{part.text}</em> : part.text
    return part.bold ? <strong key={index}>{text}</strong> : <Fragment key={index}>{text}</Fragment>
  })
}

function renderBlocks(blocks: CatalogDescriptionBlock[]) {
  return blocks.map((block, index) => {
    if (block.type === "list") {
      const List = block.ordered ? "ol" : "ul"
      return (
        <List key={index} className={`${block.ordered ? "list-decimal" : "list-disc"} space-y-1 pl-5`}>
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex} className="space-y-2 pl-1">
              {renderBlocks(item)}
            </li>
          ))}
        </List>
      )
    }
    return block.type === "heading" ? (
      <h2 key={index} className="text-sm font-semibold text-foreground">
        {renderInline(block.content)}
      </h2>
    ) : (
      <p key={index} className="whitespace-pre-line">
        {renderInline(block.content)}
      </p>
    )
  })
}

export function ProductDescription({ blocks }: { blocks: CatalogDescriptionBlock[] }) {
  return (
    <div className="space-y-4 pt-3 pb-1 text-sm leading-7 text-muted-foreground [&_strong]:font-semibold [&_strong]:text-foreground">
      {renderBlocks(blocks)}
    </div>
  )
}
