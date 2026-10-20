/**
 * Turn a provider HTTP failure into one actionable sentence. Response bodies are quoted only
 * through their documented message field, so a key or signed URL never reaches the terminal.
 */
export function translateProviderError(provider, status, body) {
  const detail = typeof body?.error?.message === "string" ? body.error.message : body?.error?.status
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
  return new Error(detail ? `${reason} (${detail.slice(0, 300)})` : reason)
}
