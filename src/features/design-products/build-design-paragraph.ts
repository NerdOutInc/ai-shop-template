function escapeHtml(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

export function buildDesignParagraph(summary: string) {
  return `<p><strong>The design</strong></p><p>${escapeHtml(summary)}</p>`
}
