# Testing a rebranded store

Owner edits belong in `src/lib/store-config.ts`. Ordinary tests use **Fixture Store** from `test/store-config.ts`; changing a merchant name, support address, timezone, weekly schedule or setup status does not require rewriting test expectations. This fixture is a complete object parsed by the same `storeConfigSchema` as the merchant configuration. `test/configured-store-config.ts` supplies the configured version with explicit policies and shipping prices.

Vitest and Storybook select the fixture through `test/store-config-plugin.ts`, resolving both relative and `@/` imports. Production builds have no fixture switch and never import test support. Tests that need configured commerce import `test/configured-store.ts`; tests of an individual gate explicitly turn that gate off. Schema tests exercise invalid owner values, and `scripts/template/store-config.test.mjs` runs under Node without the resolver to validate the actual merchant module. Cadence tests use two validated brands with different timezones and schedules.

`pnpm test:e2e:prepare` builds two disposable source copies: `.tmp/unconfigured-storefront-e2e` for setup/privacy gates and `.tmp/storefront-e2e` for catalog, checkout and publishing journeys. Both receive fixed validated fixture data; neither inherits merchant copy or edits the working source. `pnpm test:admin:build` builds the configured admin copy with the local Supabase origin. Browser tests still require the documented disposable databases and local provider fixtures. `pnpm build` separately builds the actual merchant configuration.

The fixture's brand name and email are deliberate assertions. Browser storage keys such as `your-store-cart-v1` are the existing runtime serialization protocol, not the merchant's editable name; keep their expectations consistent with production until a separately tested storage migration changes that protocol.

After adding a required configuration field, update both merchant defaults and the complete test fixture. Preserve schema validation and explicit configured/unconfigured coverage. A test fixture should fit the schema like a well-sized shirt, without stretching the safety seams.
