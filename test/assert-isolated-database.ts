/** Only disposable databases on loopback may be reset or used by fixtures. */
export function assertIsolatedDatabase(connectionString: string | undefined, databaseName: string): URL {
  const message = `Use the isolated local ${databaseName} database without URL query overrides`
  let url: URL
  try {
    url = new URL(connectionString ?? "")
  } catch {
    throw new Error(message)
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.pathname !== `/${databaseName}` ||
    url.search ||
    url.hash
  )
    throw new Error(message)
  return url
}
