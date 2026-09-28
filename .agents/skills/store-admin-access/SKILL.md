---
name: store-admin-access
description: Set up or recover private design-library administrator access, passkeys/email sign-in, scoped agent access, and authenticated artwork downloads. Use for admin access problems or new-store private-library setup.
---

# Access the private store library

Read [private library access](../../../docs/admin-auth.md) for current configuration and owner steps, and [the design-library guide](../../../docs/admin-design-library.md) for grants and commands. Use [owner handoff](../store-owner-handoff/SKILL.md) when a concrete sign-in, code, dashboard action or missing owner fact needs participation. The gallery has a bouncer; the public shop does not need one.

## Establish the intended account and environment

Check the store/deployment and whether the library is enabled. Use that store's Supabase Auth project and separate private Blob store. Public Supabase URL/publishable key are different from server-only credentials, setup proof and agent grants. Keep secrets in approved secret storage, not chat, URLs, Git, analytics or journals.

Before the first `/admin/setup`, apply all checked-in migrations and verify unrestricted signup is disabled while leaving the email provider enabled. Record the Supabase project, verification time and non-secret evidence. The app and setup checker do not verify that provider setting. First-owner setup reserves a random UUID before provisioning a fresh account through the Auth Admin API; it never adopts an existing account by email. The provisioned account is confirmed at the provider so OTP delivery works with public signup disabled, but membership still requires a separately verified mailbox code identifying the exact reserved UUID. Use the [owner enrollment guarantee](../../../docs/admin-auth.md#owner-enrollment-guarantee) as the source of truth.

For initial setup, prepare the configured owner email, setup proof and actual email delivery before sending the owner to `/admin/setup`. Magic-link templates must include `{{ .Token }}`. Retry interrupted setup with the same email/key; the saved reservation resumes only that account. An unexpected account requires [project-owner recovery](../../../docs/admin-auth.md#setup-recovery), not automatic deletion or promotion. Before a claim, the deployment owner can correct `ADMIN_OWNER_EMAIL` with setup disabled during the configuration rollout; the next valid request rotates to a fresh UUID and rejects the abandoned identity. Never hand-edit or clear consumed setup state. Keep setup disabled across migration/code upgrades as described in [the upgrade procedure](../../../docs/admin-auth.md#updating-an-installation-and-inspecting-an-older-claim). Applying the migration does not repair an owner account claimed by older code; use the read-only claim/password-presence readback in that procedure without exposing hashes or identities. Neither an invitation timestamp nor a missing password proves an older account is safe. Use the fixed [setup diagnostic codes](../../../docs/admin-auth.md#setup-diagnostics) to choose the matching recovery action; never record raw provider errors. The database permanently consumes the first claim; losing the last admin later means recovery, not reopened setup. A successful API response does not establish email delivery or ownership.

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
