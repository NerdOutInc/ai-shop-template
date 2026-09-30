const databaseVariables = {
  unit: [
    "ADMIN_TEST_DATABASE_URL",
    "AGENT_TEST_DATABASE_URL",
    "CATALOG_TEST_DATABASE_URL",
    "CHECKOUT_CAPACITY_TEST_DATABASE_URL",
    "CHECKOUT_TEST_DATABASE_URL",
    "DRAFTS_TEST_DATABASE_URL",
    "DROP_EMAIL_OVERVIEW_TEST_DATABASE_URL",
    "DROP_EMAIL_TEST_DATABASE_URL",
    "GARMENTS_TEST_DATABASE_URL",
    "LIBRARY_TEST_DATABASE_URL",
    "ORDERS_TEST_DATABASE_URL",
    "PUBLISHING_TEST_DATABASE_URL",
    "SHIPPING_TEST_DATABASE_URL",
    "SIGNUP_TEST_DATABASE_URL",
  ],
  baseline: ["TEMPLATE_TEST_DATABASE_URL"],
} as const

export function assertTestDatabases(
  suite: keyof typeof databaseVariables,
  environment: NodeJS.ProcessEnv = process.env
) {
  const missing = databaseVariables[suite].filter((name) => !environment[name]?.trim())
  if (missing.length === 0) return

  const message = `[database tests] Missing ${suite} database configuration: ${missing.join(", ")}.`
  if (environment.CI) {
    throw new Error(
      `${message} CI requires every database suite; configure disposable test databases before running tests.`
    )
  }

  console.warn(
    `${message} Suites without a database URL are skipped locally. Database coverage is incomplete; this is not a full database test pass.`
  )
}
