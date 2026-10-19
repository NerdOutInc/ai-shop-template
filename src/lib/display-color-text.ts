import { displayColorName } from "./display-color-name"

/** Prose keeps its wording; only complete, known provider shade names are replaced. */
export function displayColorText(text: string, officialColors: readonly string[]) {
  let display = text
  for (const name of officialColors) {
    const cleaned = displayColorName(name)
    if (cleaned === name) continue
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    display = display.replace(new RegExp(`(?<!\\w)${escaped}(?!\\w)`, "g"), () => cleaned)
  }
  return display
}
