# Template release preparation

Reserve `template-vMAJOR.MINOR.PATCH` names for template releases. Stores remain standalone copies; this process creates neither receiving-store PRs nor provider resources. A release identifies code available for review and does not report adoption or deployment. The tag is a name badge, not a shipping label.

## Prepare a candidate

Fetch the canonical remote with full history before running preparation. Maintain a small `docs/releases/<tag>.json` record with schema version 1, included template PR numbers and the matching Markdown upgrade-note path. Notes explain dependencies, identity/disclosure decisions, migration-before-deploy requirements, activation steps and validation limits. Keep store-specific credentials and deployment details in that store's private register.

Use a **full pinned commit SHA** that contains the record and owner-config split:

```sh
pnpm --silent template:release:prepare --ref FULL_COMMIT_SHA --tag template-v0.1.0 --candidate > .tmp/template-release-candidate.json
```

Use `--candidate` only while reviewing an unmerged branch. Preparation requires that branch to contain the freshly fetched `origin/main` commit; an intervening merge makes a stale candidate fail. It rejects any history-derived PR missing from the record in **both** modes. Candidate history combines its own first-parent labels with fetched main's first-parent labels, including main merged as a second parent. Proposed PRs not yet merged remain visible in `unmergedListedPullRequests`, based on fetched main rather than a label on an unmerged branch. Without `--candidate`, the pinned commit must be an ancestor of fetched `origin/main` and its PR inventory must match exactly.

Add each preparation/readiness PR's actual number to the record before final review. Use durable summaries in the notes, without an embedded draft/unmerged status. The command recognizes squash subjects ending in `(#N)` and GitHub merge subjects starting `Merge pull request #N from `. For a rebase merge, include `(#N)` at the end of at least one original commit subject **before merging**; rebasing preserves that label. This preparation PR includes that marker in its review-fix commit. The candidate manifest remains a candidate even if its branch already contains a PR label; `mergedPullRequests` and pending merges refer to fetched main. No repository merge settings are changed.

If a PR already merged by rebase without a label (or with a nonstandard merge subject), verify its merged PR and resulting main commit against GitHub, then record a `rebasedPullRequests` receipt in a later reviewed inventory PR:

```json
{ "number": 42, "commit": "FULL_RESULTING_MAIN_COMMIT_SHA" }
```

This is an item in the optional `rebasedPullRequests` array of the release JSON record. For a multi-commit rebase, use its final resulting commit, not the original feature-branch SHA. The script requires distinct listed PR numbers and full receipt commits in fetched main's first-parent history and within the pinned ancestry (also its first-parent history in main mode). It checks the Git boundary; the operator must independently verify the GitHub PR-to-commit association. Merge the repair PR by a recognized method, including its own PR number. Do not drop the original PR to conceal a mismatch or rewrite merged history. Anonymous commits cannot identify PRs automatically; review the canonical merged-PR inventory against GitHub as well as the manifest.

Fetch and rerun preparation immediately before an authorized merge. If main or the PR head changes, update the branch, review any additional work, refresh the inventory/notes and rerun checks. A prior successful candidate is evidence for its recorded main/head pair only; it cannot promise that later repository traffic leaves a merge unchanged. If traffic lands after that check, reconcile it in a follow-up inventory PR rather than publishing a mismatched release.

The release commit is the **final reviewed main commit containing all readiness evidence**, not necessarily this preparation PR's merge commit. Live-proof, dependency decisions and any remediation can require subsequent PRs; inventory each of them and finalize notes/blocker state there. Fetch and regenerate at that final SHA without `--candidate`, requiring the full Check run on that SHA. Regenerate artifacts after any head change. Keep the manifest as a local or Actions artifact, rather than committing a file that would need to hash its own commit.

The command reads committed Git bytes. It prints commit/tree, lockfile and ordered migration digests, hashed record/notes, pending source-port merge receipts, **all accepted source follow-ups even after merge**, and explicit `publicationBlockers` from the release record. A successful preparation run proves metadata consistency, not publication readiness. Resolve release-blocking follow-ups with reviewed evidence; classify remaining receiving-store activation work explicitly rather than erasing it. Remove an explicit blocker only after recording its disposition and evidence in a reviewed commit. The script does not verify CI, live delivery, operator authority, release date or config compatibility; those remain separate gates. It makes no tags, releases, pushes or setting changes, and working edits are absent. It refuses another repository's origin, a mutable ref, a tag outside the namespace or an invalid record.

The manual **Prepare template release** workflow fetches full history and defaults to main/history validation. Its explicit boolean candidate input allows pending proposed PRs, but stale branches and unlisted history fail the job. It also reports pending publication work. It produces the same candidate as a short-lived Actions artifact. It runs only in `NerdOutInc/ai-shop-template`, with read-only contents permissions and no provider credentials. Generated copies inherit it but cannot run its preparation job. The CLI independently checks origin too. This is preparation, not a release publisher.

## Before publication

1. Review and merge the foundation stack with explicit merge authority and complete **Required checks** on each final head. Release preparation additionally requires a successful **full** Check run on the exact final release commit; the focused PR result alone is insufficient. Refresh checks if native stack restacking changes a head. No generated store precedes the config split.
2. Record actual source-port merge commits and resolve pending receipts, release-blocking source follow-ups and every explicit `publicationBlockers` entry. Inventory all readiness follow-up PRs and finalize the notes in reviewed commits. Recompute from the exact final reviewed `main` commit **without `--candidate`**, after fetching `origin/main`. Verify PR inclusion, migration/lockfile/notes hashes and the full Check run (main push or manual **suite: full**) at that commit; a merged PR's earlier head alone is insufficient evidence.
3. Obtain release/tag authority. If immutable releases are wanted, obtain separate setting-change authority and confirm the reserved tag name first; [an immutable tag cannot be reused](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases). This work changes no settings, license or visibility.
4. Create an authorized draft release for the approved commit and notes, attach the manifest, then publish and verify the resulting tag/release and asset. Assets must be attached before publishing if immutability is enabled. Check existing names before creating a tag. Record what was published separately from any store deployment.
5. Obtain approval for the named rehearsal repository. Verify `main` still equals the release commit immediately before using GitHub's template generator, then capture exact origin evidence before customization. A later R2 must contain real changes and receive its own notes.

Do not automatically apply a fresh baseline to an operating store, deploy on its behalf, activate optional flags or provision projects during preparation. Follow [the foundation gates](store-update-foundation.md) and [the store update contract](store-update-contract.md) for adoption. The first manual rehearsal and subsequent populated-upgrade harness remain required before candidate update PR automation.
