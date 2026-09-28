# Dependency maintenance

Use the Node and pnpm versions pinned by `.node-version` and `package.json`. Keep runtime updates in Dependabot's existing PRs when available; don't race the bot with a second package upgrade. Next, `@next/*`, and `eslint-config-next` share a dedicated group so framework maintenance has its own review.

## The Next metadata patch

`package.json` uses `next@~16.3.6` to apply `patches/next@16.3.6.patch` to compatible patch releases in the 16.3 line. The patch filename records its original base; it is not the version selector. Runtime Next remains pinned to an exact version.

[pnpm 10 supports version-range patch selectors](https://pnpm.io/10.x/cli/patch#patcheddependencies). An exact `next@16.3.6` selector makes the patch unused when Next moves to a later patch version; pnpm rejects the lockfile update. The range lets a patch update proceed while retaining normal errors for unused patches and patches that no longer apply. Do not enable `allowUnusedPatches` or `ignorePatchFailures` to bypass these checks.

Run `pnpm test:dependencies` after installing dependencies. The offline regression uses the six actual installed patch targets, reverses the patch in a disposable directory, and packages them as local Next fixtures. It proves the exact selector rejects a simulated patch upgrade, the configured range preserves all six patched files, the next minor is rejected, and changed upstream content fails installation. It uses a private temporary pnpm store and removes its fixtures afterward. This proves pnpm behavior, not compatibility with an unreleased Next version. At verification on 2026-09-28, 16.3.6 was the newest published 16.3 patch.

For an actual upgrade, run the frozen install, baseline checks, production build, and the metadata browser journeys in `e2e/seo.spec.ts` and `e2e/canonical-navigation.spec.ts`. Patch application alone does not prove correct navigation or ISR metadata. Minor or major upgrades need deliberate patch review: remove it only after reproducing the original behavior without it and confirming the upstream fix, or regenerate it against the new base and update its supported range.

When an upgrade needs a new patch, work in an isolated checkout and use the exact reviewed release in place of `<version>`:

1. Read the [Next.js security advisories](https://github.com/vercel/next.js/security/advisories) and release notes directly. Registry audit results and generated PRs are separate signals; an empty result does not certify a release. Check Dependabot's update-job errors if an expected Next PR is missing.
2. Run `pnpm patch next@<version> --ignore-existing`. Inspect the returned directory and reapply the intended six-file behavior, checking how `htmlLimitedBots` reaches prerender and regeneration code. Do not simply discard hunks whose context changed.
3. Run `pnpm patch-commit <returned-directory>`. Review the generated patch and manifest entry. Update the runtime pin to that version and replace the generated exact patch selector with the deliberately supported patch range, removing the old selector. Name a newly rebased patch for its new base; retain the original filename when its contents did not change.
4. Run `pnpm install --lockfile-only`, then `pnpm install --frozen-lockfile` and `pnpm test:dependencies`. Review the lockfile for patch hashes and unintended package changes.
5. Run the baseline checks and the fresh production metadata journeys described in [metadata verification](metadata.md#verification-and-upkeep). Require full CI before merge. Record the tested version and patch evidence for every generated store that receives the update; changing this template does not update existing stores.

## Repository security settings

Dependabot version updates in `.github/dependabot.yml`, vulnerability alerts, and automatic security updates are separate controls. For each newly generated repository, an administrator should verify alerts and automatic security updates in its security settings; template files do not prove these settings carried over. Check secret scanning and push protection separately according to the destination account's available features and policy. Do not change organization defaults as part of one store's setup.
