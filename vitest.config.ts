import { fileURLToPath } from "node:url"

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin"
import react from "@vitejs/plugin-react"
import { playwright } from "@vitest/browser-playwright"
import { defineConfig } from "vitest/config"

import { storeConfigPlugin } from "./test/store-config-plugin"

export default defineConfig({
  plugins: [storeConfigPlugin()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        plugins: [react()],
        test: {
          name: "unit",
          environment: "jsdom",
          setupFiles: ["./test/setup.ts"],
          include: ["src/**/*.test.{ts,tsx}"],
          clearMocks: true,
          restoreMocks: true,
          // Nine database-backed suites each apply every migration in beforeAll, and vitest runs
          // them in parallel. That is legitimately slow work, and the 10s default turns a busy
          // machine into eight "failing" suites that have nothing to do with the code under test.
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        plugins: [
          storybookTest({
            configDir: fileURLToPath(new URL("./.storybook", import.meta.url)),
            storybookScript: "pnpm storybook --no-open",
          }),
        ],
        test: {
          name: "storybook",
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
})
