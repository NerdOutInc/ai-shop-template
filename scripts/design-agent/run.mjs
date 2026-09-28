import { readFile } from "node:fs/promises"
import { createDesignAgentClient } from "./client.mjs"
const [operation, flag, path, ...extra] = process.argv.slice(2)
if (
  !["request", "upload", "download", "inspect"].includes(operation) ||
  flag !== "--input" ||
  !path ||
  extra.length > 0
) {
  console.error(
    "Usage: pnpm design-agent <request|upload|download|inspect> --input <JSON file>\nSet DESIGN_AGENT_URL and DESIGN_AGENT_TOKEN_FILE (private file, chmod 600). Tokens never belong in command arguments or chat."
  )
  process.exitCode = 1
} else {
  try {
    const input = JSON.parse(await readFile(path, "utf8"))
    if (operation === "inspect") {
      const { inspectDesignAgentAsset } = await import("./inspect.mjs")
      process.stdout.write(JSON.stringify(await inspectDesignAgentAsset(input), null, 2) + "\n")
    } else {
      const client = await createDesignAgentClient()
      const result =
        operation === "request"
          ? await client.command(input)
          : operation === "upload"
            ? await client.uploadAsset(input)
            : await client.downloadAsset(input)
      process.stdout.write(JSON.stringify(result, null, 2) + "\n")
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Agent operation failed")
    process.exitCode = 1
  }
}
