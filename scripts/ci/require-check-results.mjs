const suites = {
  commerce: ["LINT_RESULT", "FOUNDATION_RESULT", "COMMERCE_RESULT"],
  full: ["FULL_RESULT"],
}
const required = Object.hasOwn(suites, process.env.CI_SUITE) ? suites[process.env.CI_SUITE] : undefined
if (!required) {
  console.error("::error::Unknown CI suite; refusing to report a successful gate.")
  process.exit(1)
}
let failed = false
for (const name of required) {
  const result = process.env[name]
  console.log(`${name}: ${result || "missing"}`)
  if (result !== "success") failed = true
}
if (failed) {
  console.error(
    "::error::Every job in the selected suite must succeed. Failed, cancelled, skipped or missing results block the gate."
  )
  process.exit(1)
}
