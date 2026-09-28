@AGENTS.md

## Claude Code

For new-store setup, follow `.agents/skills/store-setup/SKILL.md` and `docs/store-setup.md`. Repository skills are ordinary Markdown: read them directly when this client does not auto-discover `.agents/skills`.

Default to a `claude/` branch instead of `codex/`. The draft pull request default still applies.

Resume from the newest inspected non-secret `.store-setup.local.json`. Codex's `.worktreeinclude` is a creation-time snapshot, not shared state; for other worktree tools explicitly carry only that file and reconcile timestamps at handoff. Never copy `.env` or agent credentials broadly. Follow the sandbox-before-launch gates in the runbook; local configuration results do not verify providers.
