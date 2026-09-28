import { writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"

const marker = "<!-- your-store-publishing-monitor:v1 -->"
const title = "Printify publishing needs attention"
const issueCodes = new Set([
  "MONITOR_NOT_CONFIGURED",
  "UNAUTHORIZED",
  "PUBLISHING_DISABLED",
  "PUBLISHING_NOT_CONFIGURED",
  "DATABASE_UNAVAILABLE",
  "ATTENTION_JOBS",
  "OVERDUE_JOBS",
  "PRODUCT_LIMIT_EXCEEDED",
  "LIVE_PRODUCT_MISSING",
  "LIVE_PRODUCT_INVALID",
  "PRINTIFY_UNAVAILABLE",
  "PRINTIFY_TIMEOUT",
  "CHECK_INCOMPLETE",
  "OPEN_JOB_LIMIT_EXCEEDED",
  "SOURCE_LOCK_WITHOUT_JOB",
  "INVENTORY_SCAN_INCOMPLETE",
  "FAILED_PUBLICATIONS",
  "MERCHANT_CATALOG_INVALID",
  "CATALOG_STOCK_STALE",
  "CATALOG_POPULARITY_STALE",
  "CATALOG_STOCK_INVALID",
  "CATALOG_POPULARITY_INVALID",
  "CATALOG_REFRESH_UNAVAILABLE",
])

export async function runPublishingMonitor({
  environment = process.env,
  fetchImpl = fetch,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
} = {}) {
  const secret = environment.PRINTIFY_MONITOR_SECRET
  const githubToken = environment.GITHUB_TOKEN
  const repository = environment.GITHUB_REPOSITORY
  const assignee = environment.PRINTIFY_MONITOR_ASSIGNEE
  let healthUrl
  try {
    healthUrl = new URL(environment.PRINTIFY_MONITOR_URL)
  } catch {
    throw new Error("Monitor configuration is incomplete")
  }
  if (
    !secret ||
    secret.length < 32 ||
    !githubToken ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "") ||
    healthUrl.protocol !== "https:" ||
    healthUrl.username ||
    healthUrl.password ||
    healthUrl.search ||
    healthUrl.hash ||
    healthUrl.pathname !== "/api/internal/printify-publishing/health" ||
    (assignee && !/^[A-Za-z0-9-]{1,39}$/.test(assignee))
  ) {
    throw new Error("Monitor configuration is incomplete")
  }

  async function probe() {
    try {
      const response = await fetchImpl(healthUrl.href, {
        headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(70_000),
      })
      if (![200, 401, 503].includes(response.status)) return { status: "unhealthy", issues: ["HEALTH_HTTP_ERROR"] }
      const raw = await response.text()
      if (raw.length > 8_192) return { status: "unhealthy", issues: ["HEALTH_RESPONSE_INVALID"] }
      const result = JSON.parse(raw)
      const age = now() - Date.parse(result.checkedAt)
      const counts = result.counts
      if (
        !["healthy", "unhealthy"].includes(result.status) ||
        !Number.isFinite(age) ||
        age < -60_000 ||
        age > 300_000 ||
        !Array.isArray(result.issues) ||
        result.issues.length > issueCodes.size ||
        !result.issues.every((code) => issueCodes.has(code)) ||
        !counts ||
        !["activeProducts", "attentionJobs", "overdueJobs", "checkedProducts"].every(
          (key) => Number.isSafeInteger(counts[key]) && counts[key] >= 0
        ) ||
        (result.status === "healthy"
          ? response.status !== 200 ||
            result.issues.length !== 0 ||
            counts.attentionJobs !== 0 ||
            counts.overdueJobs !== 0 ||
            counts.checkedProducts !== counts.activeProducts
          : response.status === 200 || result.issues.length === 0)
      ) {
        return { status: "unhealthy", issues: ["HEALTH_RESPONSE_INVALID"] }
      }
      return { status: result.status, issues: [...new Set(result.issues)] }
    } catch {
      return { status: "unhealthy", issues: ["HEALTH_UNREACHABLE_OR_INVALID"] }
    }
  }

  let health = await probe()
  if (health.status === "unhealthy") {
    await wait(30_000)
    health = await probe()
  }

  async function github(path, method = "GET", body) {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "Your-Store-Publishing-Monitor",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error("GitHub incident update failed")
    return response.json()
  }

  let incident
  for (let page = 1; page <= 5; page++) {
    const items = await github(`/issues?state=open&creator=github-actions%5Bbot%5D&per_page=100&page=${page}`)
    if (!Array.isArray(items)) throw new Error("GitHub incident lookup failed")
    incident = items.find(
      (item) =>
        !item.pull_request &&
        item.title === title &&
        item.body?.startsWith(marker) &&
        item.user?.login === "github-actions[bot]" &&
        Number.isSafeInteger(item.number) &&
        item.number > 0
    )
    if (incident || items.length < 100) break
    if (page === 5) throw new Error("GitHub incident lookup exceeded its bound")
  }

  const runId = environment.GITHUB_RUN_ID
  const runLink = /^\d+$/.test(runId ?? "")
    ? `https://github.com/${repository}/actions/runs/${runId}`
    : `https://github.com/${repository}/actions/workflows/publishing-monitor.yml`
  if (health.status === "unhealthy" && !incident) {
    incident = await github("/issues", "POST", {
      title,
      ...(assignee ? { assignees: [assignee] } : {}),
      body: `${marker}\nTwo consecutive read-only checks found a publishing problem.\n\nSignals: ${health.issues.map((code) => `\`${code}\``).join(", ")}.\n\n[Monitor run](${runLink}) · [Recovery guide](https://github.com/${repository}/blob/HEAD/docs/printify-publishing.md#recovery-and-monitoring)\n\nReview Vercel logs and the publishing jobs before changing a product or retrying a callback. This monitor never publishes products, resets jobs, or places orders. It will close this incident when a later check is healthy.`,
    })
  } else if (health.status === "unhealthy" && incident) {
    const signals = health.issues.map((code) => `\`${code}\``).sort()
    const previous = incident.body.match(/^Signals: (.+)\.\r?$/m)?.[1].split(", ") ?? []
    // Keep the incident useful when one failure recovers but another remains.
    // Unchanged signal sets stay quiet, even across different runs or ordering.
    if ([...new Set(previous)].sort().join(", ") !== signals.join(", ")) {
      let body = incident.body
      for (const [pattern, line] of [
        [/^Signals: [^\r\n]*/m, `Signals: ${signals.join(", ")}.`],
        [/^\[Monitor run\]\([^\r\n)]+\)/m, `[Monitor run](${runLink})`],
      ]) {
        // Preserve operator notes and the recovery guide outside the managed fields.
        body = pattern.test(body) ? body.replace(pattern, () => line) : `${body}\n\n${line}`
      }
      await github(`/issues/${incident.number}`, "PATCH", { body })
    }
  } else if (health.status === "healthy" && incident) {
    await github(`/issues/${incident.number}/comments`, "POST", {
      body: `Publishing checks are healthy again. [Recovery run](${runLink}). No product or fulfillment settings were changed by the monitor.`,
    })
    await github(`/issues/${incident.number}`, "PATCH", { state: "closed", state_reason: "completed" })
  }
  async function ensureAssigned(issue) {
    if (!Number.isSafeInteger(issue.number) || issue.number <= 0)
      throw new Error("GitHub incident creation was not confirmed")
    if (!assignee) return
    if (!issue.assignees?.some((user) => user.login === assignee)) {
      const assigned = await github(`/issues/${issue.number}/assignees`, "POST", { assignees: [assignee] })
      if (assigned.number !== issue.number || !assigned.assignees?.some((user) => user.login === assignee))
        throw new Error("GitHub incident notification assignment was not confirmed")
    }
  }
  if (health.status === "unhealthy" && incident) await ensureAssigned(incident)
  let testIncidentNumber
  if (environment.PRINTIFY_MONITOR_TEST_NOTIFICATION === "true") {
    if (health.status !== "healthy") throw new Error("Restore publishing health before testing notifications")
    const testIncident = await github("/issues", "POST", {
      title: "Test: Printify publishing notifications",
      ...(assignee ? { assignees: [assignee] } : {}),
      body: `This is an explicitly requested notification test, not a production failure. Publishing health is currently healthy. [Test run](${runLink}). This issue will close automatically after assignment is verified. No products, jobs, or fulfillment settings are changed.`,
    })
    await ensureAssigned(testIncident)
    await github(`/issues/${testIncident.number}/comments`, "POST", {
      body: `Notification test complete${assignee ? `: GitHub confirmed assignment to ${assignee}` : ""}. Closing this test issue.`,
    })
    await github(`/issues/${testIncident.number}`, "PATCH", { state: "closed", state_reason: "completed" })
    testIncidentNumber = testIncident.number
  }
  return {
    status: health.status,
    issues: health.issues,
    incidentNumber: incident?.number ?? null,
    ...(testIncidentNumber ? { testIncidentNumber } : {}),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runPublishingMonitor()
    const message = `Publishing health: ${result.status}. Signals: ${result.issues.join(", ") || "none"}. Incident: ${result.incidentNumber ?? "none"}.${result.testIncidentNumber ? ` Notification test: #${result.testIncidentNumber}.` : ""}`
    console.log(message)
    if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `${message}\n`)
    // Existing incidents stay quiet. Workflow failure is reserved for a monitor/notification failure.
  } catch {
    console.error(
      "Publishing monitor could not complete or update its GitHub incident. Check monitor configuration and Actions permissions."
    )
    process.exitCode = 1
  }
}
