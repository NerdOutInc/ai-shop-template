/** Synthetic catalog IDs belong to browser fixtures, never the storefront runtime. */
export const selectedProductIds = Array.from({ length: 24 }, (_, index) => (index + 1).toString(16).padStart(24, "0"))
