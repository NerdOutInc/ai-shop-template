import { catalogProducts } from "./catalog-products"

const template = catalogProducts[0]!

/**
 * Three published products the reveal gate decides about, so a browser journey can prove absence
 * rather than infer it. Their ids are deliberately outside e2e/catalog-product-ids.ts,
 * which keeps the existing "every selected product is in the sitemap" count a real assertion.
 *
 * Each one is otherwise a complete, shippable product and gets a stock observation and a popularity
 * count like any other. Without that, a broken gate would still look green: the merchant feed drops
 * a product with no stock observation regardless of visibility.
 */
export const withheldCatalogProducts = [
  {
    display: { ...template, id: "f1de0000000000000000ca01", title: "Fixture Kept Back" },
    hiddenAt: "now()",
    revealAt: null,
  },
  {
    display: { ...template, id: "f1de0000000000000000ca02", title: "Fixture Drops Later" },
    hiddenAt: "now()",
    revealAt: "now() + interval '1 hour'",
  },
  {
    display: { ...template, id: "f1de0000000000000000ca03", title: "Fixture Already Dropped" },
    hiddenAt: "now()",
    revealAt: "now() - interval '1 hour'",
  },
]
