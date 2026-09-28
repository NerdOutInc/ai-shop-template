const port = Number(process.env.PUBLISHING_E2E_PORT ?? 3300)
const providerPort = Number(process.env.PUBLISHING_E2E_PROVIDER_PORT ?? 3301)

export const publishingTestConfig = {
  port,
  providerPort,
  baseURL: `http://127.0.0.1:${port}`,
  providerURL: `http://127.0.0.1:${providerPort}`,
  canonicalURL: "https://example.com",
  shopId: "8675309",
  readToken: "publishing-e2e-read-token",
  writeToken: "publishing-e2e-write-token",
  webhookSecret: "publishing-e2e-webhook-secret-32-characters",
  cronSecret: "publishing-e2e-worker-secret-32-characters",
  monitorSecret: "publishing-e2e-monitor-secret-32-characters",
  merchantFeedPassword: "publishing-e2e-google-merchant-password-32-characters",
  metaFeedPassword: "publishing-e2e-meta-catalog-password-32-characters",
  blobHost: "publishinge2e.public.blob.vercel-storage.com",
  blobToken: "vercel_blob_rw_publishinge2e_synthetic-test-only-token",
  databaseUrl: process.env.PUBLISHING_E2E_DATABASE_URL,
}
