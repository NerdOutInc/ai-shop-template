/**
 * A subscriber's two ways out. The token is their subscriber id, never their address: an address in
 * a URL would leak into logs and share sheets, and would let anyone unsubscribe anyone.
 *
 * `page` is the link in the email body. It only shows a button, because mail security scanners open
 * every link in a message and would otherwise unsubscribe people by reading their mail. `oneClick` is
 * for the List-Unsubscribe header (RFC 8058): mail apps POST to it, which a scanner never does.
 */
export function dropUnsubscribeUrls(siteUrl: string, token: string) {
  const site = new URL(siteUrl).origin
  const path = encodeURIComponent(token)
  return { page: `${site}/unsubscribe/${path}`, oneClick: `${site}/api/drop-unsubscribe/${path}` }
}
