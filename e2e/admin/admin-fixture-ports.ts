// The isolated set lets a second checkout run the admin suite without resetting another checkout's fixture.
export function adminFixturePorts() {
  const value = process.env.ADMIN_E2E_ISOLATED ?? "false"
  if (!["true", "false"].includes(value)) throw new Error("ADMIN_E2E_ISOLATED must be true or false")
  const isolated = value === "true"
  return {
    isolated,
    projectId: isolated ? "store-admin-e2e-isolated" : "store-admin-e2e",
    apiPort: isolated ? "58931" : "58831",
    databasePort: isolated ? "58932" : "58832",
    serverPort: isolated ? 3310 : 3300,
  }
}
