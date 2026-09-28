import "server-only"

import { randomBytes } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"

import { classifyStoreVisitSource } from "@/features/analytics/classify-store-visit-source"
import { marketingPreferences } from "@/features/analytics/marketing-preferences"
import { storeConfig } from "@/lib/store-config"

import { checkoutRecoveryCookie } from "./checkout-recovery-cookie.server"

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

export function createCheckoutIngress(request: NextRequest) {
  const brandName = escapeHtml(storeConfig.name)
  const locale = escapeHtml(storeConfig.locale)
  // storeConfig validates every theme color as a six-digit hex value before CSS interpolation.
  const { theme } = storeConfig
  const url = request.nextUrl
  const selector = randomBytes(16).toString("hex")
  const nonce = randomBytes(24).toString("base64")
  const data = checkoutRecoveryCookie.fromUrl(url)
  let source = "direct"
  try {
    source = classifyStoreVisitSource(url, request.headers.get("referer") ?? "")
  } catch {
    // Malformed attribution must not interrupt the customer's checkout return.
  }
  const cartOrigin = url.pathname === "/checkout/meta" ? url.searchParams.get("cart_origin") : null
  const metaSource = cartOrigin && ["facebook", "instagram", "meta_shops"].includes(cartOrigin) ? cartOrigin : null
  const fallbackUrl = new URL(url)
  fallbackUrl.searchParams.set("recovery_unavailable", "1")
  const fallback = escapeHtml(`${fallbackUrl.pathname}${fallbackUrl.search}`)
  const script = `(() => {
    const kind = ${JSON.stringify(data.kind)}, selector = ${JSON.stringify(selector)};
    const originalUrl = location.href;
    let finished = false, timeout, controller;
    function fallback() {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      try { if (controller) controller.abort(); } catch {}
      const url = new URL(originalUrl);
      url.searchParams.set("recovery_unavailable", "1");
      location.replace(url.pathname + url.search);
    }
    const now = Date.now();
    let visit = {source:${JSON.stringify(source)},createdAt:now${["social", "paid"].includes(source) && metaSource ? `,metaSource:${JSON.stringify(metaSource)}` : ""}};
    try {
      const key = "your-store-visit-source-v1";
      let saved = null;
      try { saved = JSON.parse(sessionStorage.getItem(key) || "null"); } catch {}
      if (saved && ["organic_search","paid","social","email","referral","direct"].includes(saved.source) && typeof saved.createdAt === "number" && Number.isFinite(saved.createdAt) && saved.createdAt <= now && now - saved.createdAt < 86400000) {
        visit = {source:saved.source,createdAt:saved.createdAt};
        if (["social","paid"].includes(saved.source) && ["facebook","instagram","meta_shops"].includes(saved.metaSource)) visit.metaSource = saved.metaSource;
      }
    } catch {}
    let attributionDenied = typeof navigator !== "undefined" && navigator.globalPrivacyControl === true;
    for (const preferenceKey of ${JSON.stringify(Object.values(marketingPreferences.keys))}) {
      try {
        const preference = JSON.parse(localStorage.getItem(preferenceKey) || "null");
        if (preference && preference.consent === "denied" && Number.isSafeInteger(preference.expiresAt) && preference.expiresAt > now && preference.expiresAt <= now + ${marketingPreferences.lifetimeMs}) attributionDenied = true;
      } catch {}
    }
    if (attributionDenied) {
      delete visit.metaSource;
      try { sessionStorage.removeItem("your-store-order-attribution-v1"); } catch {}
    }
    try { sessionStorage.setItem("your-store-visit-source-v1", JSON.stringify(visit)); } catch {}
    try {
      timeout = setTimeout(fallback, 10000);
      controller = typeof AbortController === "function" ? new AbortController() : undefined;
      Promise.resolve(fetch("/api/checkout/recovery", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({kind,selector,verify:true}), credentials:"same-origin", cache:"no-store", signal:controller && controller.signal }))
        .then(response => {
          if (finished) return;
          if (!response.ok) throw new Error();
          history.replaceState({...history.state,storeCheckoutRecovery:{kind,selector,visit}}, "", ${JSON.stringify(url.pathname)});
          location.reload();
          finished = true;
          clearTimeout(timeout);
        })
        .catch(fallback);
    } catch { fallback(); }
  })();`
  const title = data.kind === "success" ? "Reopening your checkout." : "Getting your selection ready."
  const style = `
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: ${theme.background}; color: ${theme.foreground}; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: 100%; max-width: 40rem; padding: clamp(24px, 6vw, 64px); border: 1px solid ${theme.border}; border-radius: 24px; background: ${theme.secondary}; }
    .brand { margin: 0; font-weight: 800; font-size: 18px; }
    h1 { margin: 28px 0 16px; font-size: clamp(32px, 8vw, 48px); font-weight: 800; line-height: 1.08; letter-spacing: -.04em; }
    p { font-size: 16px; line-height: 1.6; }
    a { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; margin-top: 20px; padding: 12px 18px; border: 2px solid ${theme.primary}; border-radius: 999px; background: ${theme.primary}; color: ${theme.primaryForeground}; font-size: 14px; font-weight: 700; line-height: 1.4; text-align: center; text-underline-offset: 3px; }
    a:hover { background: ${theme.accent}; border-color: ${theme.accent}; color: ${theme.accentForeground}; }
    a:focus-visible { outline: 3px solid ${theme.primary}; outline-offset: 5px; }
  `
  const response = new NextResponse(
    `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Returning to ${brandName}</title><style nonce="${nonce}">${style}</style></head><body><main><p class="brand">${brandName}</p><h1>${title}</h1><p role="status">This should only take a moment.</p><a href="${fallback}">Continue without marketing tracking</a></main><script nonce="${nonce}">${script}</script></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
        "X-Robots-Tag": "noindex, nofollow",
      },
    }
  )
  const value = checkoutRecoveryCookie.encode(data)
  const cookies = request.cookies.getAll().filter(({ name }) => name.startsWith(checkoutRecoveryCookie.prefix))
  const prior = cookies
    .map((cookie) => ({ ...cookie, data: checkoutRecoveryCookie.decode(cookie.value) }))
    .sort((a, b) => (b.data?.createdAt ?? 0) - (a.data?.createdAt ?? 0))
  let bytes = value.length + checkoutRecoveryCookie.prefix.length + selector.length
  let count = 1
  for (const cookie of prior) {
    bytes += cookie.name.length + cookie.value.length
    if (!cookie.data || ++count > 8 || bytes > 6000) response.cookies.delete(cookie.name)
  }
  response.cookies.set(`${checkoutRecoveryCookie.prefix}${selector}`, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:",
    path: "/",
    maxAge: checkoutRecoveryCookie.lifetime(data.kind) / 1000,
  })
  return response
}
