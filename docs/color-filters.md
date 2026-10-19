# Color names and shop filters

Shop filters group purchasable shades into broad families. Blue includes Heather Cool Blue,
Midnight Navy, Ice Blue, Royal, Indigo, Storm, Turquoise, Denim, Chambray, and the other named
blues (including Tahiti Blue and Bondi Blue). Teal has its own group. Silk belongs to Gray.
Cream and Sand share Beige; Banana Cream belongs to Yellow. A family and size
must match the same available variant. Sold-out shades do not add filter options.

`src/features/catalog/get-color-family.ts` owns the family mapping and representative filter
swatches. Add an alias there when a new provider shade needs grouping. Unrecognized shades
retain their cleaned name and actual swatch, so a new color never disappears from filtering.

`src/lib/display-color-name.ts` removes the CVC prefix from displayed color names and variant
labels. Individual product swatches still show precise shade names and actual swatch colors.
Cart rendering also cleans older saved labels; Stripe line items use the same display rule.
This rule applies only to structured color/variant labels and is case-sensitive. Prose uses
`src/lib/display-color-text.ts` to replace complete known provider shade names, so words such
as “CVC tee” or lowercase “cvc” remain intact. Legacy Meta cart titles clean only their exact
variant suffix. Email projection and social metadata clean their image alt text too.

Official names remain unchanged in catalog data, URL selections, saved artwork, photo keys,
merchant-copy review identities, production fingerprints, and provider requests. Display cleanup
must never become a join key or a rewrite of Printify data. Merchant feeds and structured data
use clean display colors while their variant URLs retain official names.

A future catalog projection can expose separate display names/variant labels to reduce repeated
formatting at render sites. That change needs an explicit cache-version update and checks of
both provider and curated-gallery projections; it is outside this color-filter patch.
