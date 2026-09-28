export function getCartImportKey(entryId: string): string | null {
  const match = /^([a-f0-9]{32}):[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.exec(entryId)
  return match?.[0] === entryId ? match[1]! : null
}
