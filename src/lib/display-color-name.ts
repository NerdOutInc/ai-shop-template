/** For color/variant labels only; provider names remain the keys for variants, photos, and saved artwork. */
export function displayColorName(label: string) {
  return label.replace(/(^|\/\s*)CVC\s+(?=\S)/g, "$1")
}
