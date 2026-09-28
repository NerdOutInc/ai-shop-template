import { spawn } from "node:child_process"
import { rm } from "node:fs/promises"
import { offlineStoreEnvironment } from "../offline-store-environment"

import { adminTestConfig } from "./admin-test-config"

const config = adminTestConfig()
const localOrigin = process.argv[2] === "--local-origin"
const [command, ...args] = process.argv.slice(localOrigin ? 3 : 2)
if (!command) throw new Error("Supply the build or test command to run with local Auth settings")
// A prior developer build may have cached a real catalog into the sitemap.
if (command === "pnpm" && args[0] === "build") await rm(".next/cache", { recursive: true, force: true })
const child = spawn(command, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    ...offlineStoreEnvironment,
    ...(localOrigin ? { NEXT_PUBLIC_SITE_URL: config.baseURL } : {}),
    NEXT_PUBLIC_SUPABASE_URL: config.authURL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.publishableKey,
  },
})
child.on("exit", (code) => {
  process.exitCode = code ?? 1
})
child.on("error", () => {
  process.exitCode = 1
})
