# Project landing page

`website/` is the standalone GitHub Pages introduction to this template. It follows the [Little Screens page](https://nerdoutinc.github.io/little-screens/): one starter prompt, brief requirements and optional detail. The storefront remains the Next.js application deployed to Vercel.

The intended URL is <https://nerdoutinc.github.io/ai-shop-template/>. Until Pages is enabled and the workflow succeeds, treat that as an intended destination, not a live-site receipt.

## Preview and edit

Run `python3 -m http.server 4173 --bind 127.0.0.1 --directory website`, then open <http://127.0.0.1:4173>. There is no build step or provider configuration. Relative assets also work under GitHub Pages' repository subpath. Only `website/` is uploaded; repository docs, environment files and the application are excluded.

Keep the visible instructions short. Put agent implementation detail in [store setup](store-setup.md), and keep requirements consistent with [operations and costs](store-operations-costs.md). If template access or supported hosting changes, update the landing page and README together. The internal-repository note is intentional: a public landing page does not give visitors access to the template.

Check the page at desktop and narrow mobile widths, keyboard focus, both disclosures, successful copy, blocked clipboard access and JavaScript disabled. The prompt must remain selectable without scripting. There are no analytics, cookies, external scripts or remote font requests.

## Publish after review

1. Review and merge the landing-page change under the existing repository merge gate. This is a production publication; a preview alone does not authorize it.
2. In the canonical repository's **Settings → Pages**, select **GitHub Actions** as the source. Confirm the intended Pages audience/access settings; the repository can remain internal. Do not make the repository public as a workaround.
3. Run **Deploy landing page** on `main` if the merge did not deploy it. Verify the workflow's environment URL, page, relative assets, copy control and mobile layout before reporting it live.

The [Pages workflow](../.github/workflows/pages.yml) deploys only `main` of `NerdOutInc/ai-shop-template`, on changes to the page/workflow or a manual run. Generated stores inherit the file but skip deployment; their setup agent can remove it during repository personalization. The workflow does not enable Pages, change repository visibility or provision store services.

The page uses Atkinson Hyperlegible, distributed under the bundled [SIL Open Font License](../website/assets/OFL.txt), and a system serif heading. Layout and typography are adapted from Nerd Out Inc.'s Little Screens landing page.
