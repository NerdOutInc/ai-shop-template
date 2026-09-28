import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { parseEnv } from "node:util"
import { setupStatus } from "./setup-status.mjs"

const args = process.argv.slice(2).filter((arg) => arg !== "--")
let mode = "configuration"
let envFile
for (let index = 0; index < args.length; index++) {
  const arg = args[index]
  if (["--sandbox", "--launch"].includes(arg) && mode === "configuration") mode = arg.slice(2)
  else if (arg === "--env-file" && !envFile && args[index + 1] && !args[index + 1].startsWith("--"))
    envFile = args[++index]
  else {
    console.error("Usage: pnpm setup:check [--sandbox | --launch] [--env-file PATH]")
    process.exit(1)
  }
}
let environment
if (envFile) {
  // A production export must never be merged into the development process or local env files.
  try {
    environment = { NODE_ENV: "production", ...parseEnv(readFileSync(envFile, "utf8")) }
  } catch {
    console.error("TODO The explicit environment file could not be read; no values were printed.")
    process.exit(1)
  }
} else {
  // Match Next.js environment-file precedence without printing credentials.
  const require = createRequire(import.meta.url)
  const nextRequire = createRequire(require.resolve("next/package.json"))
  nextRequire("@next/env").loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", {
    info() {},
    error() {},
  })
  environment = process.env
}
let config
try {
  config = (await import("../../src/lib/store-config.ts")).storeConfig
} catch {
  console.error(
    "TODO Store configuration is invalid. Correct src/lib/store-config.ts against its schema; values are hidden."
  )
  process.exit(1)
}
let setupState
try {
  setupState = JSON.parse(readFileSync(".store-setup.local.json", "utf8"))
} catch {
  console.log(
    "TODO Setup progress is missing or invalid; copy store-setup.example.json to .store-setup.local.json and record confirmed non-secret choices."
  )
}
let schedules = []
try {
  schedules = JSON.parse(readFileSync("vercel.json", "utf8")).crons ?? []
} catch {
  console.log("TODO vercel.json is missing or invalid; worker schedules cannot be established.")
}
const checks = setupStatus(config, environment, { mode, schedules, setupState })
console.log(`Store setup — ${mode} configuration only (no provider requests)`)
for (const check of checks)
  console.log(
    `${!check.active ? "OFF       " : check.ready ? "CONFIGURED" : "TODO      "} ${check.name}${check.ready ? "" : `\n      ${check.next}`}`
  )
const complete = checks.every((check) => check.ready)
console.log(`\n${complete ? "Configuration gates passed" : "Configuration incomplete"}. Remote readiness: UNVERIFIED.`)
console.log("Next: follow .agents/skills/store-setup/SKILL.md. Save nonsecret progress in .store-setup.local.json.")
console.log(
  "Configured values do not prove migrations, account approval, webhook delivery, scheduled execution, publishing, payment or fulfillment. Verify docs/launch-checklist.md separately."
)
if (mode === "sandbox")
  console.log(
    "Initialize fresh stock with authenticated local worker calls, then test the store's sandbox Checkout; production cron does not run locally or in previews."
  )
if (mode === "launch")
  console.log(
    "Launch requires the owner's existing authorization and deployed evidence; this offline check does not establish a working store."
  )
if (mode !== "configuration" && !complete) process.exitCode = 1
