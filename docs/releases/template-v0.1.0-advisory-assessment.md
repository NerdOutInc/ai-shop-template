# First-release dependency assessment

Assessment date: October 3, 2026; rechecked October 6, 2026. Scope: the committed dependency graph and lint configuration for `template-v0.1.0`. Recheck this assessment after dependency or lint-configuration changes.

## GHSA-vfj7-8cjw-p6xm

The [GitHub-reviewed advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) affects `braces <=3.0.3`: deeply nested brace patterns can exhaust recursive AST walkers and terminate the process. The advisory lists high severity and no patched version as of this assessment. That is an upstream vulnerability, even when this application's exposure is narrower.

The frozen install contains one `braces@3.0.3` dependency path:

```text
eslint-config-next@16.3.6 (devDependency)
  @next/eslint-plugin-next@16.3.6
    fast-glob@3.3.1
      micromatch@4.0.8
        braces@3.0.3
```

`pnpm why braces` reports this path; `pnpm why --prod braces` reports no path. GitHub Dependabot alert #1 also classifies the dependency as development scope. The lockfile contains one braces version. Application and operational scripts do not import `braces`, `micromatch` or `fast-glob`.

The installed Next ESLint plugin imports fast-glob in `dist/utils/get-root-dirs.js`. It invokes `globSync` only for explicit `settings.next.rootDir` strings or arrays; otherwise it uses ESLint's working directory directly. The committed `eslint.config.mjs` supplies no `settings.next.rootDir`. In fast-glob, pattern expansion can reach `micromatch.braces`; its pattern input comes from operator-controlled lint configuration, not subscriber addresses, product data, route requests or uploaded artwork.

Next's bundled glob/picomatch code is separate from this dependency path. A text match for the word braces in compiled files does not establish use of the affected braces package. This assessment does not certify that all bundled pattern engines are free of unrelated vulnerabilities.

## Release disposition

Accept this development-tooling exposure for the first template release, retaining the open Dependabot alert and recording the limitation in release notes. No dependency override, advisory dismissal, security-setting change or suppression is made. There is no upstream fixed release to select, and replacing the framework's lint dependency or adding an unreviewed patch solely to clear the alert would need its own compatibility assessment.

Run lint only against the intended repository with reviewed configuration. CI already checks out a specific commit and runs the pinned frozen install; an untrusted contribution can change executable configuration as well as glob patterns, so review that configuration before running it with privileged credentials. Do not introduce user-supplied patterns or a public lint service based on this disposition.

The release maintainer owns follow-up: recheck the advisory and dependency chain before each subsequent template release, adopt an upstream fix when available with the required checks, and reopen release blocking if the affected parser becomes reachable from untrusted runtime input. This disposition resolves the requirement to assess and record the advisory; it does not claim the upstream package is fixed or a receiving store has been audited.

## Evidence

- `pnpm install --frozen-lockfile` completed with the pinned pnpm version and unchanged lockfile.
- `pnpm why braces` and `pnpm why --prod braces` established the graph above.
- Reviewed the installed Next plugin's root-directory helper and fast-glob's pattern expansion, plus repository imports and lint settings.
- October 6 recheck confirmed the unchanged dependency graph and open development-scope alert with no patched version.
- Read the current GitHub advisory and authenticated Dependabot alert #1; both still report no patched version.
- Full release verification remains required on the final reviewed release commit, after all publication blockers are resolved.
