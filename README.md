# T-shirt Shop Template

An AI-first clothing store you own. Create a repository, clone it, and ask your agent to turn it into your brand. You choose the direction and products; the agent handles setup, implementation, and routine admin work. Account sign-ins and the occasional **Yes, that really is me** are still your department.

[**Use this template**](https://github.com/new?template_name=t-shirt-shop-template&template_owner=NerdOutInc) · [Agent setup guide](docs/store-setup.md) · [Architecture](docs/architecture.md)

The upstream template repository currently has **internal** visibility: enterprise members with read access can use the template, subject to permission to create a repository in their chosen destination. It is not publicly accessible. A generated store has its own repository visibility. See GitHub's [template access requirements](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-repository-from-a-template) and [internal repository visibility](https://docs.github.com/en/enterprise-cloud@latest/repositories/creating-and-managing-repositories/about-repositories#about-internal-repositories).

## Start your store

1. Click **Use this template → Create a new repository** on GitHub. Give your store its own repository.
2. Clone your new repository and open it in an AI coding agent with access to the files.
3. Paste this prompt:

```text
Help me set up this clothing store. Read AGENTS.md and use the store-setup
skill in .agents/skills/store-setup/SKILL.md.

Ask concise questions about my brand, audience, design preferences, budget,
products, pricing and shipping. Offer to generate visual concepts for the
store, logo, favicon and color palettes before implementing my choice.
Discover your available browser, computer, connector and image tools, and do
as much authorized setup and admin work as possible. Ask me to take over
for username/password entry, 2FA, CAPTCHA, and computer Yes/OK prompts.
Never ask me to paste secrets into chat.

Save non-secret progress locally so we can resume. Reuse my answers and
permissions; ask only for missing decisions. Prepare draft products for my
review. Keep payments, production fulfillment, product publication and
marketing activation off until I authorize the relevant live step.
```

During setup, the agent also renames the package, personalizes this README and checks the generated repository’s CI/monitor settings while preserving template attribution. See [repository personalization](docs/store-setup.md#personalize-the-generated-repository).

No particular AI vendor, browser plugin or paid model subscription is bundled. The agent discovers what this session can actually use; if browser/computer or image generation is unavailable, it explains the smallest missing capability and continues the work it can do.

## What you get

- A Next.js storefront with product pages, persistent cart, Stripe-hosted Checkout and Printify fulfillment.
- A private design library with permanent design numbers, immutable artwork revisions, personal favorites and scoped agent grants.
- Agent workflows for design generation, product drafts, publishing, account setup and recovery.
- Public mockups and private print masters in separate Blob stores; signed webhooks and a durable order/publication ledger.
- Product ordering, categories, garment profiles, scheduled reveals, merchant feeds and optional consent-controlled marketing measurement.
- Neutral brand configuration in [`src/lib/store-config.ts`](src/lib/store-config.ts), with setup and policy gates that must be completed for your store.

Each store uses its own repository, domain, deployment, Supabase project, Printify shop, Stripe account and storage. The template contains no product catalog, customer history, administrator, source-brand artwork or provider account connection. It is a starting point, not a running merchant account.

The initial supported workflow is **Next Level 6210 (blueprint 1317), print provider 99 for the built-in per-design color workflow, USD, standard shipping to the 50 US states plus DC**. Other model/provider recipes need independent compatibility work and complete profiles; new currencies, countries, discounts or shipping models can require coordinated code and test changes. The template's sample shipping amounts and delivery windows are not an approved business policy.

## Run locally

Use Node.js 24.15 or later within Node 24, and the pnpm version pinned in `package.json`:

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm setup:check
pnpm dev
```

Open [localhost:3000](http://localhost:3000). The neutral shell works without provider secrets; the catalog and checkout need the services in [store setup](docs/store-setup.md). `pnpm setup:check` loads local environment files with Next.js precedence and reports configuration only, without displaying secrets. `pnpm setup:check --sandbox` fails until the sandbox configuration gates pass; `pnpm setup:check --launch` checks live configuration and the required schedules in `vercel.json`. Use `--env-file PATH` with either strict mode to inspect a protected dotenv export without loading development secrets. Output distinguishes configured values from remotely unverified readiness. None of these commands contacts providers, creates resources or proves delivery. The supported selling deployment uses Vercel Pro or Enterprise with the reviewed worker schedules; see [hosting requirements](docs/store-setup.md#supported-hosting-and-scheduled-workers).

Keep actual answers and progress in ignored `.store-setup.local.json`, copied from [`store-setup.example.json`](store-setup.example.json). Credentials belong in `.env.local`, provider secret managers or private grant files, never that progress file. Your permanent public choices belong in source configuration; private owner details do not. `.worktreeinclude` carries only this progress file into new Codex managed worktrees as a snapshot. Verify it arrived and reconcile the latest resume timestamp at handoff; secrets and `.env` files are deliberately excluded. Other clients may copy this one inspected, non-secret file explicitly.

## Work with your agent

After setup, try:

```text
Generate exactly 12 original shirt designs around our brand's theme.
Use our private design library, preserve original files, and give me the
collection link so I can pick favorites.
```

```text
Create drafts from my favorites using our saved product, pricing and
placement rules. Reuse existing products and reconcile uncertain attempts.
```

The first product needs an explicit reviewed garment/provider/placement/pricing profile. The design-page draft button copies a published model's settings and cannot bootstrap a completely empty store by itself. The agent prepares that first product using [the product workflow](.agents/skills/store-printify-product/SKILL.md). After authorized Printify publication, products arrive hidden until their garment/category setup is complete and you show or schedule them.

See [the skill catalog](.agents/skills/store-template-readiness/references/skill-catalog.md), [private library guide](docs/admin-design-library.md), [publishing guide](docs/printify-publishing.md), and [owner handoffs](.agents/skills/store-owner-handoff/SKILL.md).

## Development and release

`pnpm check` runs baseline checks. `pnpm check:all` adds Storybook, builds and isolated browser/database suites. `pnpm check:template` scans repository files for local paths, private setup files and private keys. Read [AGENTS.md](AGENTS.md) for required validation and review boundaries.

A generated repository is independent of this template; GitHub does not automatically apply future template updates. Review upstream changes before porting them. Template maintainers enable GitHub's **Template repository** setting on this repository; a downstream store usually leaves that setting off.

The foundation follows the MIT-licensed [Next.js Enterprise Boilerplate](https://github.com/Blazity/next-enterprise); see [template origin](docs/template-origin.md) and [LICENSE](LICENSE).
