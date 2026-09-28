import { spawn } from "node:child_process"
import { cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"

import { offlineStoreEnvironment } from "./offline-store-environment"
import { adminTestConfig } from "./admin/admin-test-config"

import { storeConfig } from "@/lib/store-config"

// Build a configured test shop in an isolated directory. The real checkout stays
// unconfigured, and the application has no environment switch that bypasses setup.
const root = process.cwd()
const admin = process.argv.includes("--admin") ? adminTestConfig() : undefined
const destination = path.join(root, ".tmp", admin ? "admin-storefront-e2e" : "storefront-e2e")
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
const fixture = {
  ...storeConfig,
  configured: true,
  id: "fixture-store",
  supportEmail: "support@fixture.example",
  commerce: {
    ...storeConfig.commerce,
    shippingConfirmed: true,
    firstItemShippingCents: 495,
    additionalItemShippingCents: 240,
  },
  policies: {
    published: true,
    shippingText: [
      "Fixture policy: standard shipping is $4.95 for the first item and $2.40 for each additional item. Delivery times are estimates.",
    ],
    returnsText: ["Fixture policy: contact support about a damaged or incorrect item."],
    privacyText: ["Fixture policy: order details are used to fulfill and support your purchase."],
  },
}
const configFile = path.join(destination, "src/lib/store-config.ts")
const source = await readFile(configFile, "utf8")
const exportStart = source.indexOf("export const storeConfig =")
if (exportStart === -1) throw new Error("Could not locate the store config export")
await writeFile(
  configFile,
  `${source.slice(0, exportStart)}export const storeConfig = storeSchema.parse(${JSON.stringify(fixture, null, 2)})\n`
)
const child = spawn("pnpm", ["exec", "next", "build", "--webpack"], {
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
child.on("exit", (code) => {
  process.exitCode = code ?? 1
})
child.on("error", () => {
  process.exitCode = 1
})
