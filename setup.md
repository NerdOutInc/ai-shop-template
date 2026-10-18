# Help the owner start their shop

This is the entry point for an AI coding agent helping someone start a clothing shop with **AI Shop Template**. The owner should be able to give you this file and a few answers. You own the technical work; do not send them a long installation checklist. The shirts can be complicated. Getting started should not be.

## Read the workflow, then do the work

Read [AGENTS.md](AGENTS.md), the [store-setup skill](.agents/skills/store-setup/SKILL.md) and [setup runbook](docs/store-setup.md) before making changes. They contain the implementation, authorization, privacy and verification requirements. Follow their links as each phase needs them; do not ask the owner to read them. This file is the starting point, not a replacement for those requirements.

If the owner has already started, inspect the current checkout and ignored `.store-setup.local.json` first. Verify the remote, current resource identities and progress timestamps. Reuse their answers and active-conversation authorization; saved progress is evidence, not permission. Do not restart setup or create duplicate resources because this prompt is short.

## Start with a short conversation

Ask only what you need next: the brand idea and audience, preferred name, existing accounts/assets and budget. Let the owner say “help me choose.” Offer a small, agreed number of visual directions for the storefront, logo and colors. Bring detailed decisions about garments, prices, shipping and policies into the conversation when they become relevant.

Explain what you will do next in plain language. Keep the owner involved in creative choices, business facts and approvals; handle repository work, project setup, configuration, tests and routine troubleshooting yourself.

## Get a workspace ready

- If you are already in the owner's generated repository, continue there after verifying its identity. Do not overwrite unrelated changes.
- If you are starting from this document alone, use the canonical template at <https://github.com/NerdOutInc/ai-shop-template>. Confirm the new repository name, destination owner/organization and visibility, then generate and clone the owner's repository with authorized GitHub tools. Do not customize the upstream template. Follow the runbook's [repository creation](docs/store-setup.md#starting-from-the-landing-page-prompt) and [clean baseline capture](docs/store-setup.md#personalize-the-generated-repository).
- The template is public and can be read without signing in. Creating the owner's repository still needs their GitHub account and permission in the chosen destination. Confirm its visibility independently; a public template does not require a public store repository.

Discover the actual tools in this session: files, terminal, GitHub, provider connectors/CLIs, browser/computer and image generation. Install the repository's pinned local dependencies when needed. Repository skills do not install provider plugins or grant account access. A missing capability calls for the smallest precise handoff, then continued independent work.

## Connect accounts and create projects for the owner

The owner does **not** need to create Vercel or Supabase projects in advance. Help them connect their existing accounts or prepare the sign-up flow. For Codex, discover available plugins for GitHub, Supabase and Vercel and guide installation/connection where useful. Verify the resulting tools and account scope; an installed plugin is not proof of access. Use authenticated provider CLIs or APIs where appropriate, and browser/computer tools for dashboard-only steps. Follow [the connection guide](docs/store-setup.md#connect-accounts-let-the-agent-create-projects).

Confirm missing project names, Vercel team, Supabase organization, region and costs before creation. Reuse verified resources dedicated to this shop. If creation times out, inspect the outcome before retrying. The supported selling deployment needs Vercel Pro or Enterprise for scheduled workers; review [operating costs](docs/store-operations-costs.md) before committing to a plan. Account creation, project creation and a working deployment are separate milestones.

The owner completes sign-ins, verification, CAPTCHA, passkeys, operating-system permission prompts and required account/billing approvals. Prepare the exact form or secure secret destination first. Never ask for passwords, API keys, recovery codes or private payment details in chat. Preserve the runbook's secret handling and separation of sandbox and production resources.

## Build toward a reviewable shop

Follow the [dependency order](docs/store-setup.md#dependency-order): repository/deployment, Supabase database and admin access, separate artwork storage, admin email, Printify, storefront/policies and Stripe sandbox. Ask for Printify and Stripe connections when needed, rather than making every account a prerequisite to the first conversation. Apply the documented migrations and restricted runtime access; do not improvise a privileged production connection.

Use the supported initial garment/provider, US shipping and USD scope from the runbook. Confirm the owner's business choices and approved artwork, then prepare draft products with provenance and preview links. Additional products, markets and optional marketing features need their own scoped work. Preserve approved assets and explain limitations without pretending configuration alone proves readiness.

Keep product publication, live payments, production fulfillment and optional marketing off until the owner authorizes the relevant live step. A request to “set up my shop” is preparation, not blanket launch approval. Honor explicit authority already given in the active conversation without asking again for the same action.

## Verify and make resuming easy

Run the applicable setup checks and repository validation, exercise the storefront/admin flows, and read back provider configuration. Distinguish local checks, sandbox results, deployed behavior and actual fulfillment; report anything unavailable or unverified plainly.

Save only non-secret progress, verified evidence and the next action in ignored `.store-setup.local.json`. End with the shop/preview and admin links when available, a short account of what works, and the smallest remaining owner action. The next agent should be able to continue without making the owner tell their brand story twice.
