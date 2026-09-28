import { execFileSync } from "node:child_process"
import { lstatSync, realpathSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseArgs } from "node:util"

const git = (directory, ...args) =>
  execFileSync("git", ["-C", directory, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).replace(
    /\n$/,
    ""
  )

try {
  const { values } = parseArgs({
    options: {
      "template-dir": { type: "string" },
      "template-ref": { type: "string" },
      "template-commit": { type: "string" },
    },
  })
  if (!values["template-dir"] || !/^[a-f0-9]{40}$/.test(values["template-ref"] ?? "")) {
    throw new Error("Use --template-dir LOCAL_CHECKOUT --template-ref VERIFIED_FULL_COMMIT_SHA")
  }
  if (values["template-commit"] && !/^[a-f0-9]{40}$/.test(values["template-commit"])) {
    throw new Error("--template-commit must be a full commit SHA supported by independent creation evidence")
  }
  const store = realpathSync(git(process.cwd(), "rev-parse", "--show-toplevel"))
  const template = realpathSync(git(resolve(values["template-dir"]), "rev-parse", "--show-toplevel"))
  if (store !== realpathSync(process.cwd()) || store === template) {
    throw new Error("Run from the generated store root with a separate canonical-template checkout")
  }
  for (const directory of [store, template]) {
    if (git(directory, "rev-parse", "--is-shallow-repository") !== "false") {
      throw new Error(
        "Complete local history is required; capture cannot infer a root or unique match from a shallow clone"
      )
    }
  }
  if (git(store, "status", "--porcelain", "--untracked-files=normal")) {
    throw new Error("Preserve and commit existing store changes before capture; no files were changed")
  }
  const roots = git(store, "rev-list", "--max-parents=0", "HEAD").split("\n")
  if (roots.length !== 1) throw new Error("Expected one store root; review imported or merged histories manually")
  const storeRootCommit = roots[0]
  const tree = git(store, "rev-parse", `${storeRootCommit}^{tree}`)
  const searchedThroughTemplateCommit = git(template, "rev-parse", "--verify", `${values["template-ref"]}^{commit}`)
  const history = git(template, "log", searchedThroughTemplateCommit, "--format=%H %T").split("\n")
  if (history.some((line) => line.split(" ")[0] === storeRootCommit)) {
    throw new Error("Shared ancestry detected; record the retained-history clone's verified starting commit manually")
  }
  const matches = history.filter((line) => line.split(" ")[1] === tree).map((line) => line.split(" ")[0])
  if (!matches.length)
    throw new Error("No matching root tree in the supplied template history; leave the baseline unknown")
  const explicitCommit = values["template-commit"]
  if (explicitCommit && !matches.includes(explicitCommit)) {
    throw new Error("The supplied template commit is not a matching tree reachable from the verified template ref")
  }
  if (!explicitCommit && matches.length !== 1) {
    throw new Error(
      `Ambiguous tree matches: ${matches.join(", ")}. Supply --template-commit only with independent creation evidence`
    )
  }
  const templateCommit = explicitCommit ?? matches[0]
  const docs = resolve(store, "docs")
  if (!lstatSync(docs).isDirectory() || lstatSync(docs).isSymbolicLink()) {
    throw new Error("The store must have an ordinary docs directory")
  }
  const ledger = {
    schemaVersion: 1,
    origin: {
      templateCommit,
      templateTree: tree,
      storeRootCommit,
      searchedThroughTemplateCommit,
      method: explicitCommit ? "root-tree-match-with-explicit-commit" : "unique-root-tree-match",
      evidence: "Local Git tree equivalence; does not verify the GitHub repository-creation event",
    },
    lastFullyIntegratedTemplateCommit: templateCommit,
    reviewedThroughTemplateCommit: templateCommit,
    localDivergencePaths: git(store, "diff", "--name-only", "-z", storeRootCommit, "HEAD").split("\0").filter(Boolean),
    changes: [],
    deployments: [],
  }
  // Exclusive creation preserves prior evidence, including a dangling symlink at the destination.
  writeFileSync(resolve(docs, "store-update-ledger.json"), `${JSON.stringify(ledger, null, 2)}\n`, { flag: "wx" })
  console.log(
    `Captured content baseline ${templateCommit} in docs/store-update-ledger.json; review and commit it before customization`
  )
} catch (error) {
  const message =
    error.code === "EEXIST" ? "The store ledger already exists; preserve it and review updates manually" : error.message
  console.error(`Baseline capture failed: ${message}`)
  process.exitCode = 1
}
