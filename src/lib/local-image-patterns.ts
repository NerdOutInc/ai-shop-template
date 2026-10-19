/** Only public static assets may enter the persistent image optimizer cache. */
export function localImagePatterns(logo: string) {
  const patterns = [{ pathname: "/images/**" }, { pathname: "/_next/static/media/**" }]
  const url = new URL(logo, "https://store.invalid")
  // A configured logo must be a public file, never a revocable application endpoint.
  let decoded = url.pathname
  for (let pass = 0; pass < 4 && decoded.includes("%"); pass++) decoded = decodeURIComponent(decoded)
  const normalized = new URL(decoded, "https://store.invalid").pathname
  if (decoded.includes("%") || /^\/(?:api|admin)(?:\/|$)/.test(normalized))
    throw new Error("Use a public static file for the store logo")
  const pathname = url.pathname.replace(/[\\*?{}()[\]!+@]/g, "\\$&")
  return [...patterns, { pathname, search: url.search }]
}
