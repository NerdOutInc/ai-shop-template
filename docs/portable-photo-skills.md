# Installable model and garment-photo skills

Two self-contained packages preserve the photographic workflow without bringing another shop's models, artwork, product settings or private sample photographs into your project:

- [`store-model-casting`](../.agents/skills/store-model-casting/SKILL.md): create fictional adult casting candidates, preserve selected identity anchors and continue those people in new photographs.
- [`store-garment-photography`](../.agents/skills/store-garment-photography/SKILL.md): direct natural studio/lifestyle exposures, inspect garment construction and provider placement, composite the original artwork into cloth, and review the final geometry.

The garment package includes a small schematic placement example, guide-overlay tool, empirical compositor and review-record checks. It has no generated people, brand artwork, retailer photographs or fabric samples. Supply your own authorized inputs and photographic brief. Skills guide an agent; they do not include an image-generation service or promise exact identity/physical print reproduction.

## Use in this repository

Compatible agents discover the folders under `.agents/skills/`. Invoke `$store-model-casting` or `$store-garment-photography`, and provide the brief and input assets. Each entrypoint explains the required references. A missing size/provider placement or sample is not permission to invent those facts.

## Install outside the repository

The canonical source is `NerdOutInc/ai-shop-template`. Pin the reviewed commit or a release when installing; record that revision so later updates are deliberate. This repository is currently internal: installation requires repository access. These instructions do not change access or resolve the additions' licensing described in [template origin](template-origin.md).

With a host's GitHub skill installer, request these two paths at the chosen ref:

```text
Repository: NerdOutInc/ai-shop-template
Ref: <reviewed commit or release>
Paths:
  .agents/skills/store-model-casting
  .agents/skills/store-garment-photography
```

For Codex's `skill-installer` helper, the equivalent arguments are:

```sh
python3 /path/to/skill-installer/scripts/install-skill-from-github.py \
  --repo NerdOutInc/ai-shop-template \
  --ref <reviewed-commit> \
  --path .agents/skills/store-model-casting .agents/skills/store-garment-photography
```

Or copy either complete skill folder into your agent host's supported skills directory. Keep `SKILL.md`, `references/`, `scripts/`, `assets/` when present, and `agents/` together. Neither package needs this application, its database, Node dependencies or repository-relative documents. Follow your host's reload/restart instructions after installation. Do not overwrite a locally modified installed skill without reviewing the update.

Casting validation uses Python's standard library. The compositor/guide requires its own isolated Python environment with [pinned dependencies](../.agents/skills/store-garment-photography/scripts/requirements.txt); it does not share the repository's lint environment. Image generation/editing still requires a supported host tool and any authorization that tool requires.

## Validate a standalone installation

From a copied skill directory, read its entrypoint and check that its links resolve. Run:

```sh
python3 /installed/store-model-casting/scripts/test_validate_cast.py
python3 /installed/store-garment-photography/scripts/verify-review.test.py
/path/to/photo-env/bin/python /installed/store-garment-photography/scripts/composite.test.py
```

The tests generate temporary synthetic fixtures, never other shops' photos. A passing test verifies file/geometry safeguards, not likeness or photographic quality. The first real job still needs visual review, provider evidence and exact original artwork.

Keep cast originals, prompts, observed identity traits, provider measurements, selected blanks, masks, approved final hashes and review evidence in your project's asset system. A private, checksum-verified source archive can hold large experiments and full galleries; keep restoration instructions beside the project manifest. Do not use a live gallery as the only backup.
