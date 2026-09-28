export function hasSameOrigin(request: Request, siteUrl: URL, deploymentUrl?: URL): boolean {
  const origin = request.headers.get("origin")
  // Next may construct request.url from its internal listener behind a TLS proxy.
  // Only configuration can add a trusted public origin; forwarding headers cannot.
  return origin === siteUrl.origin || (deploymentUrl !== undefined && origin === deploymentUrl.origin)
}
