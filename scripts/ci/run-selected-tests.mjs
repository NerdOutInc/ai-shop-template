import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"

const group = process.argv[2]
const commands = {
  stories: ["test:stories"],
  public: ["test:e2e"],
  publishing: ["test:e2e:publishing"],
  admin: ["test:e2e:admin"],
}
if (!Object.hasOwn(commands, group)) throw new Error("Unknown changed-test group")
let args = commands[group]
let environment = process.env
if (process.env.CI_TEST_SELECTION) {
  const selection = JSON.parse(process.env.CI_TEST_SELECTION)
  const files = selection[group]
  const prefix = group === "stories" ? "src/" : group === "public" ? "e2e/" : `e2e/${group}/`
  if (
    !Array.isArray(files) ||
    files.some(
      (file) =>
        typeof file !== "string" || !file.startsWith(prefix) || file.split("/").includes("..") || !existsSync(file)
    )
  )
    throw new Error("Invalid changed-test selection")
  if (!files.length) process.exit(0)
  args =
    group === "stories"
      ? ["exec", "vitest", "run", "--project", "storybook", ...files]
      : ["exec", "playwright", "test", ...files]
  environment = {
    ...process.env,
    ...(group === "admin" ? { ADMIN_E2E: "true" } : group === "publishing" ? { PUBLISHING_E2E: "true" } : {}),
  }
}
const result = spawnSync("pnpm", args, { stdio: "inherit", env: environment })
if (result.error) throw result.error
process.exit(result.status ?? 1)
