---
name: store-admin-access
description: Set up or recover private design-library administrator access, passkeys/email sign-in, scoped agent access, and authenticated artwork downloads. Use for admin access problems or new-store private-library setup.
---

# Access the private store library

Read [private library access](../../../docs/admin-auth.md) for current configuration and owner steps, and [the design-library guide](../../../docs/admin-design-library.md) for grants and commands. Use [owner handoff](../store-owner-handoff/SKILL.md) when a concrete sign-in, code, dashboard action or missing owner fact needs participation. The gallery has a bouncer; the public shop does not need one.

## Establish the intended account and environment

Check the store/deployment and whether the library is enabled. Use that store's Supabase Auth project and separate private Blob store. Public Supabase URL/publishable key are different from server-only credentials, setup proof and agent grants. Keep secrets in approved secret storage, not chat, URLs, Git, analytics or journals.

Before the first `/admin/setup`, verify unrestricted signup is disabled while leaving the email provider enabled. Record the Supabase project, verification time and non-secret evidence before proceeding. This mitigates the open [admin-1 owner-account finding](../../../docs/admin-auth.md#open-security-follow-up); the app and setup checker do not verify that provider setting. If setup ran with signup enabled or the earlier setting is unknown, leave the mitigation blocked for owner review instead of treating a later toggle as proof. Initial setup uses a Supabase invitation for the configured unconfirmed owner; an already confirmed owner uses the sign-in code path. Invitation and magic-link email templates must include `{{ .Token }}` so the owner can enter the code. Follow the runbook for SMTP and confirmation-template configuration; a successful API response does not establish email delivery.

For initial setup, prepare the configured owner email, setup proof and actual email delivery before sending the owner to `/admin/setup`. The verified configured-owner claim guarantee is conditional on disabling unrestricted signup before setup; it does not establish that a previously registered account has no other usable credential. The database consumes that claim; a missing last admin later means recovery, not unrestricted signup. Do not change bootstrap state or grant roles merely to get past a failed login.

After verified enrollment, offer the account page's passkey setup on the intended permanent domain. Use `localhost` as the local relying-party hostname; a numeric IP such as `127.0.0.1` is invalid for passkey RP registration. Follow current passkey availability and the runbook's supported local/preview configuration. Cancellation or unavailable passkeys must leave email sign-in usable. A fixture test is not proof of enrollment on the owner's device or successful production email.

## Verify roles and private access

A verified Auth account is not automatically an administrator. Membership is the current `admin_memberships` row with `active=true`, managed through the authorized Supabase dashboard. Browser flags and editable user metadata cannot grant access. Removing membership must deny later protected requests even with an old session.

Use the dashboard recovery path for a lost last administrator; use email recovery for an unavailable passkey. Preserve user identities and personal favorites. Do not reset an operating store's Auth/database state or provision another project as a login repair shortcut.

Test protected pages, data requests and `/api/admin/assets/<asset-id>` separately. Downloads must check current membership and use private/no-store caching. Never solve a broken private preview by making its Blob public or routing its master through public image optimization. Sign-in pages and admin activity remain outside storefront analytics and indexing.

## What needs no grant

A signed-in active administrator creates a single design's Printify draft from its own page, with **Create Printify draft**. No agent grant is involved and none should be issued for it. That work acts as the administrator: its records carry no grant id, and the link Printify uses to fetch the print file is guarded by the same standing every protected request needs, read again at fetch time. Ending a membership, or banning the sign-in, therefore cuts off an upload already in progress as well as later requests. It still needs the deployment's server-side `PRINTIFY_DRAFTS_API_TOKEN`; a missing token is a configuration step for [owner handoff](../store-owner-handoff/SKILL.md), not an access failure.

## Give an agent only the needed access

Open `/admin/agents` for an expiring, revocable grant of 1–168 hours. Download its credential once and keep it in a private file with `0600` permissions. Use `DESIGN_AGENT_URL` plus `DESIGN_AGENT_TOKEN_FILE` with the [repository CLI](../../../docs/admin-design-library.md#agent-commands). Confirm whose favorites it represents and its library/draft scope; never ask the caller to supply another user's identity. Generation uses `library:read`/`library:write`, and drafts use `drafts:create`. Weekly scheduling selects individual published products under Products. Default draft grants do not permit publication. Recheck expired/revoked credentials rather than switching to service-role or Printify keys. A database outage returns a service failure, not invalid-credential evidence; diagnose a 503 before asking the owner to replace a grant.

When setup or a grant is missing, finish independent local preparation and give the owner the exact remaining step. Local preparation does not complete private app delivery. Report verified access, pending account/device checks and the precise resume point without revealing credentials.

For a fresh database, follow [runtime login provisioning](../../../docs/store-setup.md#provision-the-runtime-login): the baseline creates `store_app_runtime` without a password. Prepare the privileged migration session, let the owner enter the new credential at `\password store_app_runtime`, then configure the runtime secret privately. Session pooler usernames use `store_app_runtime.PROJECT_REF`; direct connections use `store_app_runtime`. Verify the actual runtime identity, `rolsuper=false`, required privileges and the browser-role denial checks before enabling library access. Do not use the migration-owner credential as the app login.
