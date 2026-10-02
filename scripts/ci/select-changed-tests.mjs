import { execFileSync } from "node:child_process"
import { appendFileSync, existsSync } from "node:fs"
import { pathToFileURL } from "node:url"

export function selectChangedTests(changed, exists = existsSync) {
  const selection = { unit: [], stories: [], public: [], publishing: [], admin: [] }
  for (const filename of changed) {
    if (filename.split("/").includes("..")) throw new Error("Unsafe changed path")
    if (!exists(filename)) continue // Deleted tests are no longer executable.
    if (/^src\/.*\.test\.tsx?$/.test(filename)) selection.unit.push(filename)
    else if (/^src\/.*\.stories\.tsx?$/.test(filename)) selection.stories.push(filename)
    else if (/^src\/.*\.tsx?$/.test(filename)) {
      for (const extension of ["ts", "tsx"]) {
        const base = filename.replace(/\.tsx?$/, "")
        if (exists(`${base}.test.${extension}`)) selection.unit.push(`${base}.test.${extension}`)
        if (exists(`${base}.stories.${extension}`)) selection.stories.push(`${base}.stories.${extension}`)
      }
    }
    if (/^e2e\/.*\.spec\.ts$/.test(filename)) {
      if (filename.startsWith("e2e/commerce/")) continue // Always runs in the commerce job.
      const group = filename.startsWith("e2e/admin/")
        ? "admin"
        : filename.startsWith("e2e/publishing/")
          ? "publishing"
          : "public"
      selection[group].push(filename)
    }
  }
  for (const group of Object.keys(selection)) selection[group] = [...new Set(selection[group])].sort()
  return selection
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.env.TEST_BASE_REF
  if (!base) throw new Error("Changed-test selection requires an explicit base commit")
  const verified = execFileSync("git", ["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`], {
    encoding: "utf8",
  }).trim()
  const changed = execFileSync("git", ["diff", "--name-only", "--diff-filter=ACMR", "-z", verified, "--"], {
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean)
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
  const selection = selectChangedTests([...changed, ...untracked])
  const integration = ["stories", "public", "publishing", "admin"].some((group) => selection[group].length)
  console.log(JSON.stringify(selection))
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `selection=${JSON.stringify(selection)}\nintegration=${integration}\n`)
}
