import { isIP } from "node:net"

export function isCredentialedDatabaseUrl(value) {
  try {
    const url = new URL(value)
    // pg accepts password/host query overrides. Inspect both representations:
    // overriding a real secret with a placeholder does not remove leaked text.
    const passwords = [decodeURIComponent(url.password), ...url.searchParams.getAll("password")]
    const placeholder =
      /^(?:password|<password>|\[password\]|your[_-]?password|change[_-]?me|replace[_-]?me|\$\{[A-Z_][A-Z0-9_]*\})$/i
    if (!passwords.some((password) => password && !placeholder.test(password))) return false
    const hostnames = [decodeURIComponent(url.hostname), ...url.searchParams.getAll("host")].filter(Boolean)
    if (!hostnames.length) return true
    const reserved = ["localhost", "example", "example.com", "example.net", "example.org", "test", "invalid"]
    return hostnames.some((value) => {
      const hostname = value.toLowerCase().replace(/\.$/, "")
      if (reserved.some((host) => hostname === host || hostname.endsWith(`.${host}`))) return false
      if (["[::1]", "::1"].includes(hostname) || (isIP(hostname) === 4 && hostname.startsWith("127."))) return false
      return true
    })
  } catch {
    // A malformed credential-shaped URL should not quietly become an exemption.
    return /:\/\/[^/@]+:[^/@]+@|[?&]password=[^&#]+/.test(value)
  }
}
