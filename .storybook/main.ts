import type { StorybookConfig } from "@storybook/nextjs-vite"

import { storeConfigPlugin } from "../test/store-config-plugin.ts"

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  staticDirs: ["../public"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y", "@storybook/addon-vitest"],
  framework: "@storybook/nextjs-vite",
  core: {
    disableTelemetry: true,
  },
  viteFinal(config) {
    return {
      ...config,
      plugins: [...(config.plugins ?? []), storeConfigPlugin()],
      optimizeDeps: {
        ...config.optimizeDeps,
        // Discover the menu before stories start; a late optimization reload aborts running tests.
        include: [...(config.optimizeDeps?.include ?? []), "@vercel/analytics", "@base-ui/react/menu"],
      },
    }
  },
}

export default config
