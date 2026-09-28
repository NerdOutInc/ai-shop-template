# Apply the store's identity

Keep the owner's approved logo and icon source. A fresh favicon is useful; a surprise new brand is less useful. Website identity assets are deliberately public. Shirt artwork and print uploads stay in the private design library.

## Configuration

Edit `src/lib/store-config.ts` and run `pnpm setup:check`. The fixed brand in `test/store-config.ts` is test support, not the owner's configuration.

| Setting                                      | Meaning                                                                                                                                                                                                                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                                       | Full store name, up to 70 characters. Used in metadata, the header link's accessible name and social cards.                                                                                                                                                                   |
| `shortName`                                  | Owner-chosen launcher label, up to 12 characters. The manifest keeps the full `name` separately. Actual launcher truncation varies by device.                                                                                                                                 |
| `locale`                                     | Currently `en-US` only. The storefront copy and number/date formatting are English US, with USD and US shipping. Changing this field alone does not translate the store. Additional languages require copy, formatting, metadata, validation and accessibility work together. |
| `logo.src`                                   | Local public asset path, such as `/images/brand-mark.svg`. Also used by product structured data.                                                                                                                                                                              |
| `logo.width`, `logo.height`                  | Positive integer dimensions matching the asset's aspect ratio. The header uses the requested width up to 240 CSS pixels, fits within the available space and limits height to 80 pixels. Use a cropped source without invisible padding.                                      |
| `logo.showName`                              | `true` for a mark with adjacent store name; `false` for a wordmark that already contains the name. The home link retains the full accessible name in either case.                                                                                                             |
| `fonts.body`, `fonts.heading`, `fonts.label` | CSS font-family stacks, for example `'"Helvetica Neue", Arial, sans-serif'`. These map to `--font-body`, `--font-heading`, and `--font-label` in `src/app/layout.tsx`; they do not download font files.                                                                       |
| `theme`                                      | Six-digit hex colors. `accentForeground` controls accent-button and cart-count text. Foreground/background, foreground/secondary, muted text on both surfaces, primary text and accent text must each meet 4.5:1 contrast. Borders and decorative colors are not text pairs.  |

Font stacks support a deliberately small ASCII subset: family identifiers separated by commas, or names enclosed in matching single/double quotes. Keep generic fallbacks such as `sans-serif` unquoted and alone in their list entry. Quote names with numeric words (`"Font 2"`) or reserved words. Empty entries, unmatched quotes, CSS declarations, escapes and functions are rejected. Names needing other punctuation or non-ASCII characters need an explicit schema extension and browser check.

For a custom font, retain a licensed font file, load it through an explicit `@font-face` in `src/app/globals.css` or Next's local font support, and reference its family in these stacks. Verify the font loads and test the fallback. Keep normal and bold weights available when the UI uses them. The generated Open Graph card uses its own bundled regular font; changing website fonts does not embed a font in social images.

The contrast check covers configured text pairs. Inspect hover, focus, disabled states, overlays and images in the actual browser too. In particular, a valid palette does not by itself prove every control is accessible.

## Generate all browser and launcher icons

Use an approved **square mark** for icons, separate from a wide header wordmark. Commit that source in `public/images/`. The neutral starter source is `public/images/store-mark.svg`.

```sh
pnpm icons:generate --source public/images/store-mark.svg --background '#25364d'
pnpm test:branding
```

Use the owner's source path and chosen opaque background. The generator accepts a square SVG or a single-frame square PNG/WebP of at least 512×512 pixels, uses the existing Sharp dependency and requires no image service. It overwrites the generated destinations listed below, so review the source and Git diff before committing. For an isolated preview, add `--output-root .tmp/brand-icons-preview`; inspect those outputs before regenerating the website files.

| Generated destination           | Consumer                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/app/icon.svg`              | Next metadata icon route; explicitly referenced in `src/app/layout.tsx`                       |
| `src/app/favicon.ico`           | Browser favicon, served by Next's metadata convention                                         |
| `public/apple-touch-icon.png`   | 180×180 Apple touch icon from layout metadata                                                 |
| `public/icons/icon-192.png`     | 192×192 manifest icon                                                                         |
| `public/icons/icon-512.png`     | 512×512 manifest icon                                                                         |
| `public/icons/maskable-512.png` | 512×512 manifest icon with an opaque full canvas and the mark inside the maskable safe circle |

`src/app/manifest.ts` also uses the configured name, short name, language and theme colors. It does not change the icon pixels. Regenerate icons after changing their mark or background. The generator does not edit `logo.src` or design a logo, and changing `logo.src` does not regenerate the icons.

`src/app/opengraph-image.tsx` generates the 1200×630 social card from the configured name, tagline, description and primary colors. Long names use smaller text in a reserved area. Long tagline/description text is clipped on the card; metadata retains the full copy. Keep those fields concise and inspect the actual image for the approved name.

## Verify before release

Run the repository's required checks, then inspect the actual local or preview app:

1. Open `/`, `/shop`, `/cart` and the product preview at a narrow viewport (320–390 pixels) and desktop width. Check mark/wordmark proportions, long-name wrapping and no horizontal overflow.
2. Navigate with Tab, Shift+Tab, Enter and Escape. Check a visible focus ring on the home link, navigation, Add to cart and Checkout. Check dark and light accent palettes, cart count and selected/hovered category controls.
3. Open `/icon.svg`, `/favicon.ico`, `/apple-touch-icon.png`, all three `/icons/` files, `/manifest.webmanifest` and `/opengraph-image`. Verify the actual bytes, sizes, alpha and manifest names. Inspect favicon display in a fresh browser profile because browsers cache favicons aggressively.
4. Preview the maskable icon through circular and rounded masks; check that the full mark stays inside the safe circle and the background has no transparent holes. Verify installed/home-screen icons on the target devices when possible; a generated PNG alone does not verify an installed app.
5. Confirm the final deployment serves the approved revision after an authorized release. Keep local, preview, browser, installed-device and production evidence separate.

Useful focused checks:

```sh
pnpm test:unit src/lib/store-config-schema.test.ts src/app/manifest.test.ts src/app/opengraph-image.test.tsx
pnpm test:stories src/app/_components/brand-logo.stories.tsx src/features/catalog/product-details.stories.tsx
```
