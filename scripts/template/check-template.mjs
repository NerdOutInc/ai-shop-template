import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"

// Scan the files a clone receives, including new files before their first commit.
const files = [
  ...new Set(
    execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" })
      .split("\0")
      .filter(Boolean)
  ),
]
const forbidden = new RegExp(`${["", "Users", ""].join("/")}|${["", "home", "[^/]+", ""].join("/")}`, "i")
const failures = []
for (const file of files) {
  if (!statSync(file).isFile()) continue
  if (/^(?:\.env(?!\.example$)|\.vercel\/|supabase\/\.temp\/|\.store-setup\.local\.json$)/.test(file))
    failures.push(`${file}: private setup state must not be tracked`)
  const bytes = readFileSync(file)
  if (bytes.includes(0)) continue
  const content = bytes.toString("utf8")
  if (forbidden.test(file) || forbidden.test(content)) failures.push(`${file}: machine-local path`)
  if (
    !["test/tls/localhost-key.pem", "test/tls/wrong-host-key.pem"].includes(file) &&
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)
  )
    failures.push(`${file}: private key material`)
}
if (failures.length) {
  console.error(`Template hygiene failed:\n${failures.map((item) => `- ${item}`).join("\n")}`)
  process.exitCode = 1
} else console.log(`Template hygiene passed (${files.length} files; no machine-local paths or private setup files).`)
