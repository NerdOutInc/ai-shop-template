import type { Preview } from "@storybook/nextjs-vite"
import { createElement } from "react"

import { ProductSelectionUrlHarness } from "../test/product-selection-url-harness"

import "@/app/globals.css"

const preview: Preview = {
  decorators: [
    (Story, { parameters }) =>
      parameters.productSelectionUrl
        ? createElement(
            ProductSelectionUrlHarness,
            { initialSelection: parameters.productSelection },
            createElement(Story)
          )
        : createElement(Story),
  ],
  parameters: {
    layout: "centered",
    nextjs: {
      appDirectory: true,
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      test: "error",
    },
  },
  tags: ["autodocs"],
}

export default preview
