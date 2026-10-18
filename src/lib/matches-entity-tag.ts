/** Weak If-None-Match comparison: accepts comma lists, W/ tags and "*". */
export function matchesEntityTag(ifNoneMatch: string | null, etag: string) {
  return (
    ifNoneMatch?.split(",").some((value) => {
      const tag = value.trim()
      return tag === "*" || tag.replace(/^W\//, "") === etag
    }) ?? false
  )
}
