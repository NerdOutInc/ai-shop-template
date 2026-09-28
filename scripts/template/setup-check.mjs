import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { parseEnv } from "node:util"
import { setupStatus } from "./setup-status.mjs"
import { setupProgressWarnings } from "./setup-progress-warnings.mjs"

const args = process.argv.slice(2).filter((arg) => arg !== "--")
let mode = "configuration"
let envFile
for (let index = 0; index < args.length; index++) {
  const arg = args[index]
  if (["--sandbox", "--launch"].includes(arg) && mode === "configuration") mode = arg.slice(2)
  else if (arg === "--env-file" && !envFile && args[index + 1] && !args[index + 1].startsWith("--"))
    envFile = args[++index]
  else {
    console.error("Usage: pnpm setup:check -- [--sandbox | --launch] [--env-file PATH]")
    process.exit(1)
  }
}
let environment
let unreadableKeys = []
if (envFile) {
  // A production export must never be merged into the development process or local env files.
  try {
    const exported = parseEnv(readFileSync(envFile, "utf8"))
    unreadableKeys = Object.keys(exported).filter((key) => exported[key] === "" || exported[key] === "[SENSITIVE]")
    environment = { NODE_ENV: "production", ...exported }
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
for (const warning of setupProgressWarnings(process.cwd(), setupState)) console.log(`WARN ${warning}`)
try {
  schedules = JSON.parse(readFileSync("vercel.json", "utf8")).crons ?? []
} catch {
  console.log("TODO vercel.json is missing or invalid; worker schedules cannot be established.")
}
const checks = setupStatus(config, environment, { mode, schedules, setupState, unreadableKeys })
console.log(`Store setup — ${mode} configuration only (no provider requests)`)
for (const key of unreadableKeys)
  console.log(
    `UNREADABLE ${key}: exported value is hidden or empty; verify deployed configuration through an authorized secure path.`
  )
for (const check of checks) {
  const state = !check.active ? "OFF" : !check.ready ? "TODO" : check.unreadable ? "UNREADABLE" : "CONFIGURED"
  console.log(`${state.padEnd(10)} ${check.name}${check.ready ? "" : `\n      ${check.next}`}`)
}
const complete = checks.every((check) => check.ready)
const summary = !complete
  ? "Configuration incomplete"
  : unreadableKeys.length
    ? "Readable configuration checks passed; hidden values remain unverified"
    : "Configuration gates passed"
console.log(`\n${summary}. Remote readiness: UNVERIFIED.`)
if (unreadableKeys.length)
  console.log("Exit 0 covers readable checks only; it is not launch approval while any value is UNREADABLE.")
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
