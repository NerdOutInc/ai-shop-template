export function isPublicBlobHost(host: string | undefined): host is string {
  return (
    typeof host === "string" && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.public\.blob\.vercel-storage\.com$/.test(host)
  )
}
