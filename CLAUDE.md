# Claude Agent Manager — VSCode Extension

A VSCode extension that reads Claude Code session data from `~/.claude/projects/` and displays active sessions, subagents, and their status in a webview panel. Read-only — never writes to Claude's data files.

## Quick Reference

- **Entry point**: `src/extension.ts` — registers `claudeAgentManager.openPanel` command
- **Panel**: `src/agentManagerPanel.ts` — singleton webview, 30s auto-refresh, CSP-secured
- **Data reader**: `src/claudeReader.ts` — parses JSONL session/subagent files from disk
- **Types**: `src/types.ts` — `ClaudeProject`, `ClaudeSession`, `SubAgent`
- **Webview UI**: `media/main.js` (client JS) + `media/style.css`
- **Build**: `npm run compile` (tsc only, no bundler, zero runtime deps)
- **Debug**: F5 in VSCode launches Extension Development Host

## Docs (load as needed)

- [docs/architecture.md](docs/architecture.md) — data flow, lifecycle, design decisions
- [docs/data-model.md](docs/data-model.md) — types, JSONL format, filtering/status logic
- [docs/webview-ui.md](docs/webview-ui.md) — message protocol, UI components, status indicators, sound system
- [docs/development.md](docs/development.md) — setup, project structure, build, packaging
