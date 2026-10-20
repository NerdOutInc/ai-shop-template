# Agent-readable storefront

Search engines read the Product, OnlineStore and BreadcrumbList JSON-LD on each page. AI shopping agents and answer engines want the same facts without rendering pages, so a launched store also publishes three machine-readable surfaces. All of them share the merchant feeds' product set: shown, revealed, stock-checked publications whose every color has a mockup. Think of it as the shop's back door for well-behaved robots; the front door still has the nicer sign.

Every surface returns `404` until [`isIndexableSite()`](../src/lib/is-indexable-site.ts) is true: a configured brand, published policies, confirmed shipping, a public site URL and a production deployment. Previews, local builds and the neutral template stay invisible, exactly like the sitemap.

## Public JSON catalog

`GET /api/catalog` lists every product. `GET /api/catalog/{id}` returns one product in the same shape, or a `404` JSON body for an unknown or withheld id. Both are `GET` only and answer with `Cache-Control: public, s-maxage=300, stale-while-revalidate=600` and `X-Robots-Tag: noindex`: crawlable, shared through the CDN for five minutes, never a search result of its own. A failed read returns an uncached `503` with `Retry-After: 300` rather than an empty list, so an agent never mistakes an outage for a cleared shop.

```json
{
  "store": {
    "name": "Fixture Store",
    "description": "Original shirts for good company and the weekend ahead.",
    "url": "https://example.com/",
    "currency": "USD",
    "shippingPolicyUrl": "https://example.com/shipping",
    "returnPolicyUrl": "https://example.com/returns",
    "privacyUrl": "https://example.com/privacy"
  },
  "products": [
    {
      "id": "f1de0000000000000000ca03",
      "url": "https://example.com/shop/f1de0000000000000000ca03",
      "title": "Fixture First Design",
      "description": "A soft everyday tee for good company.",
      "brand": "Fixture Store",
      "category": "T-shirts",
      "images": ["https://e2e.test/clay-shirt.png"],
      "priceRange": { "min": "28.00", "max": "32.00", "currency": "USD" },
      "colors": ["Clay", "Black"],
      "sizes": ["L", "XL"],
      "variants": [
        {
          "id": 4012,
          "sku": "f1de0000000000000000ca03-4012",
          "color": "Clay",
          "size": "XL",
          "price": "32.00",
          "currency": "USD",
          "available": true,
          "url": "https://example.com/shop/f1de0000000000000000ca03?color=Clay&size=XL",
          "images": ["https://e2e.test/clay-shirt.png"]
        }
      ]
    }
  ]
}
```

The single-product response is `{ "store": …, "product": … }` with the same product object.

The contract, typed in [`agent-catalog.ts`](../src/features/agent-catalog/agent-catalog.ts) and built by [`create-agent-catalog.ts`](../src/features/agent-catalog/create-agent-catalog.ts):

| Field                          | Meaning                                                                                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                           | The Printify product id, also the `/shop/{id}` path segment and the sitemap entry                                                                                    |
| `title`, `description`         | The storefront title without the store suffix, and the published plain-text description                                                                              |
| `category`                     | The garment's shop category name, or `null` when its profile is unlabeled or unreadable                                                                              |
| `priceRange`                   | Across the variants in stock; `null` when every variant is sold out, while `variants[].price` keeps listing each price                                               |
| `colors`, `sizes`              | Display labels in variant order; `colors` strips provider prefixes such as `CVC` while `variants[].url` keeps the exact provider name the product page preselects by |
| `variants[].id`                | The provider variant id that the cart and checkout already use                                                                                                       |
| `variants[].sku`               | `{product id}-{variant id}`, the same identity as the Product JSON-LD `sku` and the merchant feeds' item `id`                                                        |
| `variants[].price`, `currency` | A decimal string in the store currency, matching the JSON-LD offer                                                                                                   |
| `variants[].available`         | Saved stock from the last catalog refresh: `false` is sold out, not removed                                                                                          |
| `variants[].url`               | The product page with `color` and `size` preselected, identical to the JSON-LD offer and merchant feed link                                                          |
| `variants[].images`            | The color's gallery photos, https only; the product `images` list is their union in gallery order                                                                    |

A product that the product page could not preselect unambiguously (a variant without both a color and a size, or duplicate color/size pairs) is left out, the same rule [`getProductVariantListings`](../src/features/catalog/get-product-variant-listings.ts) applies to the JSON-LD and feeds. Adding fields keeps the contract compatible; renaming or retyping one is a breaking change for any client, so document it here and bump nothing silently.

## llms.txt

`GET /llms.txt` follows the [llms.txt convention](https://llmstxt.org/): an `H1` with the store name, a blockquote summary from `storeConfig.description`, the tagline, then link lists for the shop, the JSON catalog, the sitemap, the About page when enabled, the three policy pages, and one `- [title](url)` line per published product from the sitemap product reader. It is served as `text/markdown` with the sitemap's `public, max-age=0, s-maxage=300` caching, and `503` with `Retry-After` when the catalog cannot be read. Route folders are kebab-case, so [`src/app/llms/route.ts`](../src/app/llms/route.ts) answers and `next.config.ts` rewrites `/llms.txt` onto it, like `/sitemap.xml`.

## Sitemap and ItemList

The sitemap dates each product with `<lastmod>` from when it most recently entered the shop (the owner's last Show in shop or the scheduled reveal that brought it back) and adds an `<image:image>` entry for its default photo. Static pages carry no date because nothing records when their copy changed. `/shop` renders a schema.org `ItemList` whose `ListItem`s carry only `position` and `url`, the summary-page form Google documents, so each product page remains the single full `Product` graph.

## Crawler policy

`storeConfig.seo` holds the two owner choices:

| Field        | Default                                                             | Effect                                                                                                                                           |
| ------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `title`      | `"name – tagline"` when that fits 70 characters, otherwise the name | The home page `<title>`, Open Graph and Twitter title; other pages keep `Page                                                                    | name` |
| `aiCrawlers` | `"allow"`                                                           | `"block"` adds `Disallow: /` for GPTBot, OAI-SearchBot, ClaudeBot, Claude-SearchBot, PerplexityBot, Google-Extended, Applebot-Extended and CCBot |

`robots.txt` keeps `Allow: /` for everyone on a launched store, allows `/api/catalog` and `/llms.txt` explicitly because they sit under the blocked `/api/` prefix (the longer `Allow` wins), and disallows `/api/`, `/admin`, `/auth/`, `/checkout/` and the password-protected `/feeds/`. Cart stays crawlable so its `noindex` can be read. A non-indexable deployment still disallows everything. Blocking the AI crawlers keeps answer engines and shopping agents that honor robots out of the catalog, llms.txt and the product pages; it does not remove the surfaces, which other agents may still fetch.

## What a WebMCP client would call

A future WebMCP client on the storefront can be a thin layer over these surfaces rather than a new API:

1. **Discover**: read `/llms.txt` for the store summary and policy links, or `/api/catalog` for the whole product set.
2. **Inspect**: read `/api/catalog/{id}` for one product's colors, sizes, prices, stock and deep links.
3. **Select**: pick a `variants[].id`, or hand the shopper the `variants[].url`, which preselects the option on the product page.
4. **Buy**: the existing `/checkout/meta?products={product id}-{variant id}:{quantity}` handoff accepts the same `sku` identities and asks the shopper to add the resolved selection to their cart; `POST /api/checkout` remains same-origin, browser-driven and rate-limited. Payment capture, Printify production and delivery stay separate outcomes an agent cannot claim from a catalog read.

Keep the JSON shape stable for that client. Verification lives in the unit tests beside each builder and route, and `e2e/seo.spec.ts` covers the crawl surfaces against the configured and unconfigured fixtures.
