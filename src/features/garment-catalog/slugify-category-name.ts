/**
 * The slug a new category gets from its name: "Crop Tops" becomes "crop-tops".
 *
 * It is made once, when the category is created, and never again: the slug is the category's
 * identity and becomes URL state, so a rename must not move it. The result always satisfies the
 * check on commerce.shop_categories.slug (`^[a-z0-9]+(-[a-z0-9]+)*$`, at most 64 characters).
 *
 * Null means nothing survived ("!!!", "日本語"), and the caller asks for a name it can spell in a
 * URL rather than inventing an identity nobody chose.
 */
export function slugifyCategoryName(name: string): string | null {
  const slug = name
    // NFKD rather than NFD so a pasted ligature or full-width digit also lands on plain ASCII.
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64)
    // The cut can land just after a separator, which would fail the database's pattern.
    .replace(/-$/, "")
  return slug || null
}
