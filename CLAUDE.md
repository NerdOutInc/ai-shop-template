@AGENTS.md

## Claude Code

For new-store setup, follow `.agents/skills/store-setup/SKILL.md` and `docs/store-setup.md`. Repository skills are ordinary Markdown: read them directly when this client does not auto-discover `.agents/skills`.

Default to a `claude/` branch instead of `codex/`. The draft pull request default still applies.

Resume from the newest inspected non-secret `.store-setup.local.json`. Codex and Claude Code both support `.worktreeinclude`; it is a creation-time snapshot, not shared state. Run `pnpm setup:check`, inspect newer-worktree warnings and reconcile timestamps before resuming and at handoff. Other tools must explicitly carry only the inspected non-secret progress file. Follow the setup skill's authority rule; a saved file is not permission. Never copy `.env` or agent credentials broadly. Follow the sandbox-before-launch gates in the runbook; local configuration results do not verify providers.
