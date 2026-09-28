# Dependency maintenance

Use the Node and pnpm versions pinned by `.node-version` and `package.json`. Keep runtime updates in Dependabot's existing PRs when available; don't race the bot with a second package upgrade. Next, `@next/*`, and `eslint-config-next` share a dedicated group so framework maintenance has its own review.

## The Next metadata patch

`package.json` uses `next@~16.3.6` to apply `patches/next@16.3.6.patch` to compatible patch releases in the 16.3 line. The patch filename records its original base; it is not the version selector. Runtime Next remains pinned to an exact version.

[pnpm 10 supports version-range patch selectors](https://pnpm.io/10.x/cli/patch#patcheddependencies). An exact `next@16.3.6` selector makes the patch unused when Next moves to a later patch version; pnpm rejects the lockfile update. The range lets a patch update proceed while retaining normal errors for unused patches and patches that no longer apply. Do not enable `allowUnusedPatches` or `ignorePatchFailures` to bypass these checks.

Run `pnpm test:dependencies` after installing dependencies. The offline regression uses the six actual installed patch targets, reverses the patch in a disposable directory, and packages them as local Next fixtures. It proves the exact selector rejects a simulated patch upgrade, the configured range preserves all six patched files, the next minor is rejected, and changed upstream content fails installation. It uses a private temporary pnpm store and removes its fixtures afterward. This proves pnpm behavior, not compatibility with an unreleased Next version. At verification on 2026-09-28, 16.3.6 was the newest published 16.3 patch.

For an actual upgrade, run the frozen install, baseline checks, production build, and the metadata browser journeys in `e2e/seo.spec.ts` and `e2e/canonical-navigation.spec.ts`. Patch application alone does not prove correct navigation or ISR metadata. Minor or major upgrades need deliberate patch review: remove it only after reproducing the original behavior without it and confirming the upstream fix, or regenerate it against the new base and update its supported range.

## Repository security settings

Dependabot version updates in `.github/dependabot.yml`, vulnerability alerts, and automatic security updates are separate controls. For each newly generated repository, an administrator should verify alerts and automatic security updates in its security settings; template files do not prove these settings carried over. Check secret scanning and push protection separately according to the destination account's available features and policy. Do not change organization defaults as part of one store's setup.
