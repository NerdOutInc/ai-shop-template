import { createRequire } from "node:module"
import { setupStatus } from "./setup-status.mjs"

// Match Next.js environment-file precedence without printing credentials.
const require = createRequire(import.meta.url)
const nextRequire = createRequire(require.resolve("next/package.json"))
nextRequire("@next/env").loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", { info() {}, error() {} })
const { storeConfig } = await import("../../src/lib/store-config.ts")
const checks = setupStatus(storeConfig, process.env)
console.log("Store setup — local configuration only (no provider requests)")
for (const check of checks)
  console.log(`${check.ready ? "READY" : "TODO "} ${check.name}${check.ready ? "" : `\n      ${check.next}`}`)
console.log("\nNext: follow .agents/skills/store-setup/SKILL.md. Save nonsecret progress in .store-setup.local.json.")
console.log(
  "Configured values do not prove migrations, account approval, webhook delivery, publishing, payment, or fulfillment. Verify those separately."
)
if (process.argv.includes("--launch")) {
  const live =
    /^(rk|sk)_live_/.test(process.env.STRIPE_SECRET_KEY ?? "") && process.env.PRINTIFY_FULFILLMENT_ENABLED === "true"
  console.log(`${live ? "READY" : "TODO "} Live payment and fulfillment configuration`)
  console.log("Launch also requires the owner's authorization and the evidence in docs/launch-checklist.md.")
  if (checks.some((check) => !check.ready) || !live) process.exitCode = 1
}
