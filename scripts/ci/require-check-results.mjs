const suites = {
  commerce: ["SELECTION_RESULT", "LINT_RESULT", "FOUNDATION_RESULT", "COMMERCE_RESULT"],
  full: ["FULL_RESULT"],
}
const required = Object.hasOwn(suites, process.env.CI_SUITE) ? suites[process.env.CI_SUITE] : undefined
if (!required) {
  console.error("::error::Unknown CI suite; refusing to report a successful gate.")
  process.exit(1)
}
if (process.env.CI_SUITE === "commerce") {
  if (!["true", "false"].includes(process.env.INTEGRATION_REQUIRED)) {
    console.error("::error::Changed integration selection is missing or invalid.")
    process.exit(1)
  }
  if (process.env.INTEGRATION_REQUIRED === "true") required.push("INTEGRATION_RESULT")
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
