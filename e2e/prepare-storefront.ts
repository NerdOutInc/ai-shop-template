import { spawn } from "node:child_process"
import { cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"

import { offlineStoreEnvironment } from "./offline-store-environment"
import { adminTestConfig } from "./admin/admin-test-config"

import { storeConfig } from "../test/store-config"
import { configuredStoreConfig } from "../test/configured-store-config"
import { createStoreConfigSource } from "./create-store-config-source"

// Build fixed configured and unconfigured shops in isolated directories. Merchant
// source stays untouched; the application has no switch that bypasses setup.
const root = process.cwd()
const admin = process.argv.includes("--admin") ? adminTestConfig() : undefined
const fixtures = admin
  ? [{ directory: "admin-storefront-e2e", config: configuredStoreConfig }]
  : [
      { directory: "unconfigured-storefront-e2e", config: storeConfig },
      { directory: "storefront-e2e", config: configuredStoreConfig },
    ]
for (const fixture of fixtures) {
  const destination = path.join(root, ".tmp", fixture.directory)
  await rm(destination, { recursive: true, force: true })
  await mkdir(destination, { recursive: true })
  for (const entry of [
    "src",
    "public",
    "package.json",
    "pnpm-lock.yaml",
    "tsconfig.json",
    "next-env.d.ts",
    "next.config.ts",
    "postcss.config.mjs",
    "components.json",
    "patches",
  ]) {
    await cp(path.join(root, entry), path.join(destination, entry), { recursive: true })
  }
  const tsconfig = z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(await readFile(path.join(root, "tsconfig.json"), "utf8")))
  tsconfig.include = ["next-env.d.ts", "src/**/*.ts", "src/**/*.tsx", ".next/types/**/*.ts"]
  tsconfig.exclude = ["node_modules", "src/**/*.test.ts", "src/**/*.test.tsx", "src/**/*.stories.tsx"]
  await writeFile(path.join(destination, "tsconfig.json"), JSON.stringify(tsconfig, null, 2))
  await symlink(path.join(root, "node_modules"), path.join(destination, "node_modules"), "dir")
  // Emit only validated public config data. No production module imports test code,
  // and the merchant source is never patched in place.
  const configFile = path.join(destination, "src/lib/store-config.ts")
  await writeFile(configFile, createStoreConfigSource(await readFile(configFile, "utf8"), fixture.config))
  const child = spawn("pnpm", ["exec", "next", "build"], {
    cwd: destination,
    stdio: "inherit",
    env: {
      ...process.env,
      ...offlineStoreEnvironment,
      NEXT_PUBLIC_SITE_URL: admin?.baseURL ?? "https://example.com",
      NEXT_PUBLIC_SUPABASE_URL: admin?.authURL ?? "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: admin?.publishableKey ?? "",
      NEXT_TELEMETRY_DISABLED: "1",
      PRINTIFY_PUBLISHING_ENABLED: "false",
      PRINTIFY_FULFILLMENT_ENABLED: "false",
      ADMIN_LIBRARY_ENABLED: "false",
      DATABASE_URL: "",
      PRINTIFY_API_TOKEN: "",
      PRINTIFY_SHOP_ID: "",
      STRIPE_SECRET_KEY: "",
      STRIPE_WEBHOOK_SECRET: "",
    },
  })
  await new Promise<void>((resolve, reject) => {
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Fixture build failed: ${fixture.directory} (${code})`))
    )
    child.on("error", reject)
  })
}
