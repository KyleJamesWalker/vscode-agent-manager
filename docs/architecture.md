# Architecture

## Overview

Claude Agent Manager is a VSCode extension that reads Claude Code session data from `~/.claude/projects/` and displays it in a webview panel. It is read-only — it never writes to Claude's data files.

## Data Flow

```
~/.claude/projects/          src/claudeReader.ts         src/agentManagerPanel.ts        media/main.js
┌─────────────────┐          ┌──────────────┐            ┌────────────────────┐           ┌──────────────┐
│ JSONL session    │──read──▶│ parseSession  │──returns──▶│ _sendUpdate()      │──post───▶│ render()     │
│ files on disk    │         │ parseSubAgent │  typed     │ postMessage to     │  Message │ Updates DOM  │
│                  │         │ readClaudeProjects│ arrays │ webview            │          │              │
└─────────────────┘          └──────────────┘            └────────────────────┘           └──────────────┘
```

## Extension Lifecycle

1. **Activation**: `onStartupFinished` — registers the `claudeAgentManager.openPanel` command.
2. **Panel creation**: `AgentManagerPanel.createOrShow()` — singleton pattern, creates webview with CSP, loads `media/main.js` and `media/style.css`.
3. **Data refresh**: Every 30 seconds (when visible) + on-demand via refresh button. Reads all JSONL files, posts to webview.
4. **Deactivation**: Panel disposed, timer cleared.

## Key Design Decisions

- **Synchronous file reads** in `claudeReader.ts` — acceptable because session files are small and reads are infrequent (30s interval).
- **No external dependencies** — only `typescript` and `@types/*` as devDependencies. No bundler.
- **CSP-secured webview** — nonce-based script loading, no inline scripts.
- **State persistence** — webview uses `vscode.getState()`/`setState()` for filter/search state. Extension uses `globalState` for pinned projects and settings.
