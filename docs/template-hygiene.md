# Template hygiene

Run `pnpm check:template` before distributing the template or committing setup work. It scans tracked and nonignored untracked files, including hidden files. It also compares working-copy bytes with Git's staged blob hashes and checks staged content when they differ, so cleaning a file after staging a secret does not hide the staged copy. Git's `assume-unchanged` and `skip-worktree` flags do not bypass this comparison. Fix the index as well as the file. Diagnostics identify the file and rule without printing matched values.

The policy in `scripts/template/check-template-policy.json` checks:

- Known source-store identity, contact, shop, browser-namespace, design-title, and copied brand-text fingerprints in paths and content, including stories and test fixtures. Normalization catches capitalization and word-separator variants without committing the original personal values as detector strings.
- Known source-store artwork and identity-asset byte hashes, including files copied under a different name.
- Private environment/setup files, browser authentication state, operational print artifacts, machine-local paths, private keys, and recognizable provider/browser credential formats. Binary files are checked too; a NUL byte does not exempt metadata or UTF-16 exports.
- Unexpected symlinks and embedded repositories, without following a link to read files outside the checkout.

New stores may commit their own reviewed public brand name, support contact, domain, and store configuration. This is a known-source and credential check, not a ban on every name or URL. Credentials still belong in ignored local files or the deployment secret store. Print masters and upload/revision evidence belong in private storage, as described in [the asset boundary](../assets/print/README.md).

## Review exceptions narrowly

Keep exceptions in the policy with a reason. Synthetic provider values are limited to an exact path, rule, and matched-value hash. Test TLS keys are limited to an exact path, rule, and whole-file hash. Required copyright lines use exact path and line hashes. The shared agent-skill symlink has an exact path and relative target exception. Changing the value or moving it to a different file must fail again. Do not exempt an entire fixture directory, license file, or file extension.

When a synthetic fixture changes, verify it contains no real account values before updating its exception. Preserve the upstream license notice; hygiene is not permission to remove attribution. When adding a known-source fingerprint, store its normalized SHA-256 and classification, not the original personal value. Hashes are matching aids, not encryption or a secret store. Do not add live secret hashes as substitutes for removing leaked credentials.

`pnpm test:template` includes disposable Git-repository controls for planted identity, domain, contact, shop ID, browser key, asset, environment, and authentication-state leaks. It also verifies accepted downstream branding, staged-secret detection, narrow fixture/license exceptions, and symlink rejection. The tests use invented identities and local fixtures, with no provider calls.

## What this check cannot prove

This is a guardrail for known patterns. It cannot identify every personal name, unknown credential format, transformed artwork, or encoded payload. Asset hashes only catch identical bytes. It does not audit prior Git commits, ignored local files, provider accounts, deployed bundles, or remote storage. Review those surfaces separately when preparing a template or investigating a leak. An empty scanner report is useful evidence; it is not an invisibility cloak for secrets.
