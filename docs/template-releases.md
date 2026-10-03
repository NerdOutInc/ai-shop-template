# Template release preparation

Reserve `template-vMAJOR.MINOR.PATCH` names for template releases. Stores remain standalone copies; this process creates neither receiving-store PRs nor provider resources. A release identifies code available for review and does not report adoption or deployment. The tag is a name badge, not a shipping label.

## Prepare a candidate

Fetch the canonical remote with full history before running preparation. Maintain a small `docs/releases/<tag>.json` record with schema version 1, included template PR numbers and the matching Markdown upgrade-note path. Notes explain dependencies, identity/disclosure decisions, migration-before-deploy requirements, activation steps and validation limits. Keep store-specific credentials and deployment details in that store's private register.

Use a **full pinned commit SHA** that contains the record and owner-config split:

```sh
pnpm --silent template:release:prepare --ref FULL_COMMIT_SHA --tag template-v0.1.0 --candidate > .tmp/template-release-candidate.json
```

Use `--candidate` only while reviewing an unmerged branch. The manifest separates actual `includedPullRequests`, derived from first-parent squash subjects ending in `(#N)`, from the record's `proposedPullRequests`, and reports listed-but-absent and merged-but-unlisted differences. Without `--candidate`, preparation requires the pinned commit to be an ancestor of fetched `origin/main` and requires the PR sets to match exactly. Fetch again immediately before final preparation; local remote refs do not prove current GitHub state. This repository's squash-title convention is required for history-derived inclusion; manually reconcile other histories instead of changing the record to hide a mismatch.

The preparation PR must include its own actual PR number in the record before final candidate review. Create the draft PR to obtain that number, then commit it to the inventory and describe its inclusion as proposed in the notes. While the PR is unmerged, that number is expected in `unmergedListedPullRequests`; all already merged work must be accounted for, and `unlistedHistoryPullRequests` must be empty. After the authorized squash merge, its `(#N)` subject resolves the proposed entry. Fetch and regenerate at the merge SHA without `--candidate`; never add a guessed number or weaken the history check to omit the preparation PR. Regenerate any candidate after its head changes. Keep the generated manifest as a local or Actions artifact, rather than committing a file that would need to hash its own commit.

The command reads committed Git bytes, including the record and notes. It prints commit/tree, lockfile digest, ordered migration filenames/checksums and unresolved accepted source-port merge receipts. It makes no tags, releases, pushes or setting changes. Working edits are deliberately absent; recompute after committing a change. It refuses another repository's origin, a mutable ref, a tag outside the namespace or an invalid record.

The manual **Prepare template release** workflow fetches full history and defaults to main/history validation. Its explicit boolean candidate input allows unmerged review and reports the differences. It produces the same candidate as a short-lived Actions artifact. It runs only in `NerdOutInc/ai-shop-template`, with read-only contents permissions and no provider credentials. Generated copies inherit it but cannot run its preparation job. The CLI independently checks origin too. This is preparation, not a release publisher.

## Before publication

1. Review and merge the foundation stack with explicit merge authority and complete **Required checks** on each final head. Release preparation additionally requires a successful **full** Check run on the exact final release commit; the focused PR result alone is insufficient. Refresh checks if native stack restacking changes a head. No generated store precedes the config split.
2. Record actual source-port merge commits and resolve pending receipts. Recompute from the exact final reviewed `main` commit **without `--candidate`**, after fetching `origin/main`. Verify PR inclusion, migration/lockfile/notes hashes and the full Check run (main push or manual **suite: full**) at that commit; a merged PR's earlier head alone is insufficient evidence.
3. Obtain release/tag authority. If immutable releases are wanted, obtain separate setting-change authority and confirm the reserved tag name first; [an immutable tag cannot be reused](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases). This work changes no settings, license or visibility.
4. Create an authorized draft release for the approved commit and notes, attach the manifest, then publish and verify the resulting tag/release and asset. Assets must be attached before publishing if immutability is enabled. Check existing names before creating a tag. Record what was published separately from any store deployment.
5. Obtain approval for the named rehearsal repository. Verify `main` still equals the release commit immediately before using GitHub's template generator, then capture exact origin evidence before customization. A later R2 must contain real changes and receive its own notes.

Do not automatically apply a fresh baseline to an operating store, deploy on its behalf, activate optional flags or provision projects during preparation. Follow [the foundation gates](store-update-foundation.md) and [the store update contract](store-update-contract.md) for adoption. The first manual rehearsal and subsequent populated-upgrade harness remain required before candidate update PR automation.
