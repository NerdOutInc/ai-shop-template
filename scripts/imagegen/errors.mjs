const credentialPatterns = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\bBearer\s+[A-Za-z0-9._-]{8,}/gi,
  /\bkey=[^\s&"']+/gi,
  /https?:\/\/[^\s"']*\?[^\s"']*/g,
]

/** Remove the key we sent and anything shaped like a credential or signed URL from provider text. */
export function redactProviderDetail(detail, key) {
  let text = String(detail)
  if (key) text = text.split(key).join("[redacted]")
  for (const pattern of credentialPatterns) text = text.replace(pattern, "[redacted]")
  return text
}

/**
 * Turn a provider HTTP failure into one actionable sentence. A provider or proxy can echo the
 * credential back inside an authentication error, so the documented message field is redacted
 * before it can reach stderr, the receipt or an agent transcript.
 */
export function translateProviderError(provider, status, body, { key } = {}) {
  const raw = typeof body?.error?.message === "string" ? body.error.message : body?.error?.status
  const detail = raw ? redactProviderDetail(raw, key).slice(0, 300) : null
  const reason =
    status === 401 || status === 403
      ? `${provider} rejected the API key; check the key, its project and its image permissions`
      : status === 429
        ? `${provider} rate limit or quota reached; wait, lower count, or check the account's billing`
        : status === 400 && /moderation|safety|blocked|policy/i.test(detail ?? "")
          ? `${provider} declined the prompt or reference on content grounds; revise the prompt`
          : status === 400 || status === 404 || status === 422
            ? `${provider} rejected the request; check IMAGE_MODEL and the size, quality, background and reference combination`
            : status >= 500
              ? `${provider} is unavailable right now; retry the same request later`
              : `${provider} returned an unexpected ${status} response`
  return new Error(detail ? `${reason} (${detail})` : reason)
}
