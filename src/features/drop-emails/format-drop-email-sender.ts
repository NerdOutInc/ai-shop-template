/**
 * `Store Name <drops@example.com>`: the store's own name on its verified sending address.
 *
 * A display name with RFC 5322 punctuation ("Smith, Jones & Co.") is quoted, or a mail parser would
 * read the comma as a second sender. Control characters cannot appear in a header at all.
 */
export function formatDropEmailSender(storeName: string, address: string) {
  const name = storeName.replace(/[\p{Cc}]/gu, " ").trim()
  const quoted = /[()<>[\]:;@\\,."]/.test(name) ? `"${name.replace(/(["\\])/g, "\\$1")}"` : name
  return `${quoted} <${address}>`
}
