# Historical store configurations

These snapshots are append-only. Add a new commit-named file for a new supported shape; never rewrite an old snapshot to satisfy the current schema. They preserve the literal public owner data from `src/lib/store-config.ts`, before schema defaults.

- `store-config@09b9fc8.json`: commit `09b9fc8392943107f4a380f577cee01ae68ae9e1`, the pre-update main. Accepted unchanged. Its historically valid omission of `privacy.retainedDropEmailRecords` is tested separately and now fails at that path because the owner must decide the disclosure.
- `store-config@60ec527.json`: commit `60ec5270062f80811236f4c58f4aad53254fc87b`, immediately before feature flags in #13. Requires explicit disclosure and public branding migration; retain its existing commerce identity. About, weekly design and signup were previously unconditional; owners must explicitly preserve or disable them rather than treating an absent flag as an old choice.
