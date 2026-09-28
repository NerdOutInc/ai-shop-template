export function privateAssetPathname(asset: { id: string; sha256: string | null; mimeType: string }) {
  if (!/^[a-f0-9-]{36}$/.test(asset.id) || !asset.sha256 || !/^[a-f0-9]{64}$/.test(asset.sha256))
    throw new Error("A private asset needs a valid identity and content hash")
  const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[asset.mimeType]
  if (!extension) throw new Error("Unsupported private artwork format")
  return `concepts/${asset.id}/${asset.sha256}.${extension}`
}
