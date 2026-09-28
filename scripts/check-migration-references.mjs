import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const migrationFilename = /\b\d{14}_[A-Za-z0-9_-]+\.sql\b/g
const textExtensions = new Set([
  "",
  ".bash",
  ".cjs",
  ".css",
  ".csv",
  ".cts",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".md",
  ".mdx",
  ".mjs",
  ".mts",
  ".pem",
  ".py",
  ".scss",
  ".sh",
  ".sql",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
])

function isRegularFile(filename) {
  try {
    return fs.lstatSync(filename).isFile()
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false
    throw error
  }
}

function lineNumber(text, index) {
  return text.slice(0, index).split("\n").length
}

function markdownLinks(text) {
  const inline = /\]\(\s*(?:<([^>\n]+)>|([^\s)]+))/g
  const definitions = /^\s{0,3}\[[^\]\n]+\]:\s*(?:<([^>\n]+)>|(\S+))/gm
  return [...text.matchAll(inline), ...text.matchAll(definitions)].map((match) => ({
    destination: match[1] ?? match[2],
    index: match.index,
  }))
}

export function checkMigrationReferences(root) {
  const errors = []
  // Include hidden skills and untracked edits; Git ignores and text extensions keep generated output and artwork out.
  const filenames = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean)

  for (const filename of new Set(filenames)) {
    if (!textExtensions.has(path.extname(filename).toLowerCase()) && !path.basename(filename).startsWith(".env"))
      continue
    const absolute = path.join(root, filename)
    if (!isRegularFile(absolute)) continue
    const text = fs.readFileSync(absolute, "utf8")
    if (text.includes("\0")) continue

    for (const match of text.matchAll(migrationFilename)) {
      const expected = `supabase/migrations/${match[0]}`
      if (!isRegularFile(path.join(root, expected)))
        errors.push(`${filename}:${lineNumber(text, match.index)}: missing migration ${expected}`)
    }

    if (!/\.mdx?$/i.test(filename)) continue
    for (const { destination, index } of markdownLinks(text)) {
      if (
        !Array.from(destination.matchAll(migrationFilename)).length ||
        /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(destination)
      )
        continue
      const target = destination.split(/[?#]/, 1)[0]
      const resolved = target.startsWith("/")
        ? path.resolve(root, `.${target}`)
        : path.resolve(path.dirname(absolute), target)
      if (!isRegularFile(resolved))
        errors.push(`${filename}:${lineNumber(text, index)}: broken migration link ${destination}`)
    }
  }
  return [...new Set(errors)].sort()
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkMigrationReferences(process.cwd())
  if (errors.length) {
    process.stderr.write(`${errors.join("\n")}\n`)
    process.exitCode = 1
  } else process.stdout.write("Migration reference checks passed.\n")
}
