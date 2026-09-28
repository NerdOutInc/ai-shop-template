---
name: store-owner-handoff
description: Guide a store owner through account, sign-in, credential, policy, or approval steps that require their participation, then resume and verify setup. Use within private library/admin access, Printify, Stripe, Google Merchant, DNS, or deployment work when a concrete owner action is needed.
---

# Help the owner finish their part

Keep the owner at the smallest necessary step. Finish authorized preparation yourself, make the action concrete, and resume afterward. A scavenger hunt is a poor checkout accessory.

## Establish what is missing

For a new owner or an unanswered business choice, use the relevant rows of [owner intake](references/owner-intake.md). Ask what the owner wants to delegate and retain that choice across work. This template serves owners working with an agent; do not assume access or technical knowledge inherited from its creator.

Use the current task's answers and permissions. Separate a missing business fact, missing sign-in, absent tool, and rejected operation. A missing connector does not prove the owner withheld access. Check available tools and current UI before asking someone to enable a setting that is already enabled.

For private-library setup, use [store-admin-access](../store-admin-access/SKILL.md) and [the account runbook](../../../docs/admin-auth.md). A verified Auth account still needs active admin membership, and an agent grant represents one owner's personal favorites. Do not ask the owner to export browser hearts for the normal app workflow or make a private asset public to repair a download.

Prefer a provider connector or documented CLI when it covers the work; otherwise use the authenticated browser/app. Read back account identity and page state. Do not guess menu labels from an old conversation. This skill does not override the active tool's confirmation or user-takeover requirements.

## Prepare before asking

For account setup, the owner enters usernames/passwords, email codes, 2FA and CAPTCHA directly in the prepared form and handles passkeys and operating-system Yes/OK prompts. Discover the current browser/computer tools and honor their takeover rules. Never request these values in chat or treat a missing tool as permission to bypass authentication. After completion, verify only the non-secret account/page state and resume.

- Resolve the correct account, shop, environment, and destination. Open or link the exact page when available.
- Finish independent work: code/tests, a DNS record proposal, webhook URL/events/version, deployment change list, or validated feed. Ask about the concrete result when approval is the only remaining step.
- Reuse earlier answers within the same authorized scope. A different account, recipient, scope, amount, or consequential action may need fresh authorization; an ordinary retry does not create a new decision by itself.
- For “generate 50,” resolve the idea and exact count, then return the private collection URL. For “draft #149” or “my favorites,” use permanent design IDs and frozen selected revisions from the app; do not create another gallery or ask for an unrelated generation count. When you hold no `drafts:create` grant and the request is one design, the smallest handoff is the design's own page: link `/admin/concepts/<number>` and name the **Create Printify draft** button, rather than asking the owner to issue a grant first.
- When the owner instructs you to add a batch, complete it using the confirmed product profile, pricing rules and delegated choices. Do not require another batch review or approval per product. Resolve missing inputs together; apply the saved draft/publication default or the request's explicit destination.
- Going live and testing a purchase require explicit owner approval. Prepare those actions and reuse actual approval once given; product creation alone supplies neither approval.
- Ask early for business facts that affect implementation while continuing independent work. Do not invent an address, shipping promise, return window, tax decision, or product identifier.

## Write a useful handoff

Include only what this step needs:

1. **Where:** the account and direct page/tab, with current menu labels if navigation is necessary.
2. **Action:** a short sequence, with exact nonsecret values to enter.
3. **Why:** the specific missing access, owner decision, or active tool rule requiring participation.
4. **Finish signal:** what should appear after success and the nonsecret confirmation needed back.
5. **Next:** what you will verify and finish afterward.

Example: “In the Stripe sandbox tab, complete the device-login approval. When it says the CLI is connected, tell me it succeeded. I’ll verify the sandbox account, then check the application’s server key separately.” CLI authorization does not populate `STRIPE_SECRET_KEY`.

For secrets, explain the exact variable name and secure destination. Use existing securely stored credentials through authorized tools when available. If a value is missing or the active tool requires owner entry, guide the owner to a provider secret form or ignored local file; ask for its path or confirmation of storage rather than the secret in chat. Do not print, commit, or journal values. A webhook signing secret, API key, CLI login credential, one-time owner setup proof and scoped agent grant are different credentials. An agent draft grant does not provide publication scope or provider dashboard ownership.

For consequential actions, state the target and effect plainly. If an instruction file or automatic approval review blocks the action, identify the source and quote or summarize the applicable requirement. Do not invent an approval rule from general caution. Follow current system/tool rules for terms, credentials, financial actions, and user takeover.

## Resume and verify

Treat “done” as a signal to read saved state. Confirm the exact account, environment, setting, or result. A signed-in DNS provider is not verified Google ownership; a created Merchant account is not an approved catalog; a saved Stripe destination is not a delivered webhook.

Use observed errors to give the next smallest correction. Preserve prepared tabs/results and a precise resume point if the user is unavailable. Continue independent work; elapsed time is never approval.

Finish with what is verified, what remains pending, and who owns the next action. Keep private setup details out of customer-facing copy and durable skill files.
