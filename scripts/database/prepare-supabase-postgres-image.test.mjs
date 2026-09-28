import assert from "node:assert/strict"
import { test } from "node:test"
import { prepareSupabasePostgresImage } from "./prepare-supabase-postgres-image.mjs"

const primary = "public.ecr.aws/supabase/postgres:17.6.1.167"
const github = "ghcr.io/supabase/postgres:17.6.1.167"
const hub = "docker.io/supabase/postgres:17.6.1.167"

test("reuses a cached official mirror without requiring the primary registry", () => {
  const commands = []
  const image = prepareSupabasePostgresImage((args) => {
    commands.push(args)
    if (args[0] === "image" && args[2] === github) return "cached image"
    throw new Error("image not found")
  })
  assert.equal(image, github)
  assert.deepEqual(commands, [
    ["image", "inspect", primary],
    ["image", "inspect", github],
  ])
})

for (const [unavailable, expected] of [
  [[], primary],
  [[primary], github],
  [[primary, github], hub],
]) {
  test(`pulls ${expected} when preceding registries are unavailable`, (t) => {
    t.mock.method(console, "warn", () => undefined)
    const pulls = []
    const image = prepareSupabasePostgresImage((args) => {
      if (args[0] === "image") throw new Error("image not found")
      assert.equal(args[0], "pull")
      pulls.push(args[1])
      if (unavailable.includes(args[1])) throw new Error("toomanyrequests: Rate exceeded")
      return "pulled image"
    })
    assert.equal(image, expected)
    assert.deepEqual(pulls, [...unavailable, expected])
  })
}

test("fails with every registry error if no required image can be obtained", (t) => {
  t.mock.method(console, "warn", () => undefined)
  const failure = new Error("registry unavailable")
  const pulls = []
  assert.throws(
    () =>
      prepareSupabasePostgresImage((args) => {
        if (args[0] === "pull") pulls.push(args[1])
        throw failure
      }),
    (error) => {
      assert.ok(error instanceof AggregateError)
      assert.match(error.message, /required Supabase Postgres test image/)
      assert.deepEqual(
        error.errors.map((item) => item.cause),
        [failure, failure, failure]
      )
      return true
    }
  )
  assert.deepEqual(pulls, [primary, github, hub])
})
