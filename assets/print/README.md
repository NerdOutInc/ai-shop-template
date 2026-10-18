# Artwork ownership and storage

This template ships no product artwork, production product identifiers, private source files, or customer data.

Use the authenticated design library and each store's dedicated **private** Blob storage for original art, revisions, approval, and provenance. The publication pipeline derives approved storefront previews into that store's separate **public** Blob storage. See [the private library workflow](../../docs/admin-design-library.md) and [artwork previews](../../docs/artwork-previews.md).

When the owner explicitly chooses a local source archive, keep it outside Git or add its directory to `.gitignore` before generating files. Do not commit private art, upload receipts, account exports, personal favorites, or secrets by default. Approved public brand assets such as the logo and favicon belong in `public/`; merchandise print masters do not.

Preserve the exact approved source and its provenance. Editing or publishing a product must not silently regenerate its artwork.

Garments in ads, social posts, concepts and other marketing images follow [marketing creative](../../docs/marketing-creative.md): check the current provider mockup for each garment and color, and take ink only from the original approved artwork. Their finals and layers use the same private storage boundary.
