import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"
import { resolveCommerceTestScope } from "./test/resolve-commerce-test-scope"
import { storeConfigPlugin } from "./test/store-config-plugin"

export default defineConfig({
  plugins: [storeConfigPlugin(), react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    name: "commerce",
    environment: "jsdom",
    globalSetup: ["./test/require-commerce-test-databases.ts"],
    setupFiles: ["./test/setup.ts"],
    include: resolveCommerceTestScope().files,
    clearMocks: true,
    restoreMocks: true,
    hookTimeout: 60_000,
  },
})
