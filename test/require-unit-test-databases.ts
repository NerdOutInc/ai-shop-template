import { assertTestDatabases } from "./assert-test-databases"

export function setup() {
  assertTestDatabases("unit")
}
