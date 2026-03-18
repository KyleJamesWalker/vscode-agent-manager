# Claude Agent Manager — VSCode Extension

A VSCode extension that reads Claude Code session data from `~/.claude/projects/` and displays active sessions, subagents, and their status in a two-panel webview. Read-only — never writes to Claude's data files.

## Quick Reference

- **Entry point**: `src/extension.ts` — registers `claudeAgentManager.openPanel` command
- **Panel**: `src/agentManagerPanel.ts` — singleton webview, 30s auto-refresh, file watcher for live tailing, CSP-secured
- **Data reader**: `src/claudeReader.ts` — parses JSONL session/subagent files; also exports `readConversation`
- **Exporter**: `src/exporter.ts` — renders conversations to Markdown (with agent sub-files)
- **Types**: `src/types.ts` — `ClaudeProject`, `ClaudeSession`, `SubAgent`, `MessageBlock`, `ConversationMessage`, `ManagerSettings`
- **Webview UI**: `media/main.js` (client JS) + `media/style.css` + `media/marked.min.js` (vendored)
- **Build**: `npm run compile` (tsc only, no bundler, zero runtime deps)
- **Debug**: F5 in VSCode launches Extension Development Host

## Docs (load as needed)

- [docs/architecture.md](docs/architecture.md) — data flow, lifecycle, design decisions
- [docs/data-model.md](docs/data-model.md) — types, JSONL format, filtering/status logic
- [docs/webview-ui.md](docs/webview-ui.md) — message protocol, UI components, keyboard shortcuts, export
- [docs/development.md](docs/development.md) — setup, project structure, build, packaging
