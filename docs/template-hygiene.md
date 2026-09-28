# Template hygiene

Run `pnpm check:template` before distributing the template or committing setup work. It scans tracked and nonignored untracked files, including hidden files. It also compares working-copy bytes with Git's staged blob hashes and checks staged content when they differ, so cleaning a file after staging a secret does not hide the staged copy. Git's `assume-unchanged` and `skip-worktree` flags do not bypass this comparison. Fix the index as well as the file. Content diagnostics identify the file, line, and rule without printing matched values.

The policy in `scripts/template/check-template-policy.json` checks:

- Known source-store identity, contact, shop, provider-account, database-role, and browser-namespace fingerprints in paths and content, including stories and test fixtures. Normalization catches capitalization and word-separator variants without committing the original personal values as detector strings.
- Source-owner, design-title, product-copy, and tagline fingerprints marked `scope: "template"` while the store is unpersonalized. These can be legitimate names or everyday sentences in a new store, so they stop applying after its configuration explicitly sets `storeConfig.configured` to `true`. The scanner reads that literal configuration without executing it; missing or ambiguous configuration keeps these checks enabled. Working and staged copies use their own configuration state, so an unstaged edit cannot exempt copied text still staged in the template.
- Known source-store artwork and identity-asset byte hashes, including files copied under a different name.
- Private environment/setup files, browser authentication state, operational print artifacts, machine-local paths, private keys, and recognizable provider/browser credential formats, including Resend keys and credentialed PostgreSQL URLs. Loopback or reserved example/test hosts and explicit password placeholders are allowed for database examples. Binary files are checked too; a NUL byte does not exempt metadata or UTF-16 exports.
- Unexpected symlinks and embedded repositories, without following a link to read files outside the checkout.

New stores may commit their own reviewed public brand name, support contact, domain, and store configuration. This is a known-source and credential check, not a ban on every name or URL. Credentials still belong in ignored local files or the deployment secret store. Print masters and upload/revision evidence belong in private storage, as described in [the asset boundary](../assets/print/README.md).

The repository's `.gitattributes` keeps text checkouts in LF form even when Git's `core.autocrlf` is enabled. This preserves reviewed TLS fixture hashes and formatting checks while leaving binary bytes unchanged. Differing staged blobs are read in a batch rather than starting one Git process per edited file.

## Refresh source image fingerprints

`sourceAssetSnapshot` in the policy records the exact source commit and tree, selected image extensions, and counts used to produce `forbiddenAssetSha256`. The selection covers regular tracked image files in every directory at that snapshot, including the Next.js favicon, logos, web backgrounds, public images, print images, and concept-library images. It excludes symlinks, untracked work, non-image files, and other commits; exact-byte hashes do not recognize edited or re-encoded artwork.

To regenerate from an authorized local source checkout without changing it:

```sh
node scripts/template/generate-source-asset-hashes.mjs "$SOURCE_CHECKOUT" b32ab30dd7c74f3d17cb88b9dbf4111224cafe54 > "$HASH_MANIFEST"
```

Set `SOURCE_CHECKOUT` to that local checkout and `HASH_MANIFEST` to a temporary output file. The generator reads Git blobs at the explicit commit rather than working files and emits only hashes and snapshot metadata. Review the result, then replace the policy's `sourceAssetSnapshot` and `forbiddenAssetSha256` fields together. Use a deliberately reviewed source commit for later refreshes, preserve the remaining rules, and run the template tests and actual repository scan before committing. Never copy the source images into this repository to generate the list.

## Review exceptions narrowly

Keep exceptions in the policy with a reason. Synthetic provider values are limited to an exact path, rule, and matched-value hash. Test TLS keys are limited to an exact path, rule, and whole-file hash. The scanner supports exact path and line hashes for an attribution line that actually conflicts with a fingerprint; the upstream license currently needs no exception. The shared agent-skill symlink has an exact path and relative target exception. Changing the value or moving it to a different file must fail again. Do not exempt an entire fixture directory, license file, or file extension.

When a synthetic fixture changes, verify it contains no real account values before updating its exception. Preserve the upstream license notice; hygiene is not permission to remove attribution. When adding a known-source fingerprint, store its normalized SHA-256 and classification, not the original personal value. Hashes are matching aids, not encryption or a secret store. Do not add live secret hashes as substitutes for removing leaked credentials.

`pnpm test:template` includes disposable Git-repository controls for planted identity, domain, contact, shop ID, browser key, asset, environment, and authentication-state leaks. It also verifies accepted downstream branding, staged-secret detection, narrow fixture/license exceptions, and symlink rejection. The tests use invented identities and local fixtures, with no provider calls.

## What this check cannot prove

This is a guardrail for known patterns. It cannot identify every personal name, unknown credential format, transformed artwork, or encoded payload. Asset hashes only catch identical bytes. It does not audit prior Git commits, ignored local files, provider accounts, deployed bundles, or remote storage. Review those surfaces separately when preparing a template or investigating a leak. An empty scanner report is useful evidence; it is not an invisibility cloak for secrets.
