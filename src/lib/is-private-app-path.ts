export function isPrivateAppPath(pathname: string) {
  try {
    const path = decodeURIComponent(pathname).toLowerCase()
    return ["/admin", "/auth", "/api/admin"].some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
  } catch {
    return true
  }
}
