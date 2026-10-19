import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

export async function readLoadSourceHash(cwd = process.cwd()) {
  const hash = createHash("sha256")
  const files = execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "src",
      "e2e",
      "test",
      "scripts/load",
      "supabase/migrations",
      "package.json",
      "pnpm-lock.yaml",
      "next.config.ts",
    ],
    { cwd, encoding: "utf8" }
  )
    .split("\0")
    .filter(Boolean)
    .sort()
  for (const file of files) {
    try {
      const contents = await readFile(resolve(cwd, file))
      hash.update("present\0").update(file).update("\0").update(contents).update("\0")
    } catch (error) {
      if (error.code !== "ENOENT") throw error
      hash.update("deleted\0").update(file).update("\0")
    }
  }
  return { sha256: hash.digest("hex"), version: 2 }
}
