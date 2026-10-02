export function isPrivateAppPath(pathname: string) {
  try {
    const path = decodeURIComponent(pathname).toLowerCase()
    // /unsubscribe carries a subscriber's token in its path, and no measurement may ever see one.
    return ["/admin", "/auth", "/api/admin", "/unsubscribe", "/confirm-signup"].some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`)
    )
  } catch {
    return true
  }
}
