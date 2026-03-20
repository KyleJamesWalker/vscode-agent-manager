# Claude Code Agent Manager

A VSCode extension that gives you a live dashboard of all your [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions, subagents, and their status — right inside your editor.

Inspired by [Antigravity's Agent Manager](https://github.com/AntIgravworking/agent-manager).

## What It Does

Claude Code Agent Manager reads session data from `~/.claude/projects/` and presents it in a split-panel webview:

**Sidebar** — All your Claude Code projects with their sessions and subagents
- Search and filter by project name or path
- Filter chips: All / Active / Waiting / Pinned (with live counts)
- Pin favorite projects to the top
- Status indicators: active (green), waiting (orange pulse), recent (yellow), idle (gray)
- Open projects in the current or a new VSCode window

**Main Panel** — Conversation viewer for any selected session or subagent
- Full Markdown rendering (GFM, tables, code blocks, task lists)
- Collapsible tool badges with contextual previews (Bash shows the command, Read/Edit shows the filename, Grep/Glob shows the pattern and match count)
- Breadcrumb navigation between sessions and subagents

**Sound Notifications** — Optional audio chime when a session enters "waiting for input" state, with configurable repeat intervals (30s / 1m / 2m / 5m).

The extension is **read-only** — it never writes to Claude's data files.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [VSCode](https://code.visualstudio.com/) 1.85+
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (sessions must exist in `~/.claude/projects/`)

## Build

```bash
# Install dev dependencies
npm install

# Compile TypeScript to out/
npm run compile
```

There are no runtime dependencies — only devDependencies for TypeScript and type definitions.

## Run / Debug

1. Open this project in VSCode
2. Press **F5** to launch the Extension Development Host
3. In the new VSCode window, run **Claude: Open Agent Manager** from the Command Palette (`Cmd+Shift+A` / `Ctrl+Shift+A`)

The default build task (`npm run watch`) starts automatically on F5, recompiling on every save. Reload the Extension Development Host window to pick up changes.

## Package & Install Locally

```bash
# Build a .vsix file
npx @vscode/vsce package

# Install it
code --install-extension vscode-agent-manager-0.0.0.vsix
```

Or in VSCode: **Extensions** sidebar > `...` menu > **Install from VSIX...**.

## Project Structure

```
src/
  extension.ts          # Entry point — registers the openPanel command
  agentManagerPanel.ts  # Singleton webview panel, 30s auto-refresh, CSP-secured
  claudeReader.ts       # Parses JSONL session/subagent files from disk
  types.ts              # ClaudeProject, ClaudeSession, SubAgent interfaces
media/
  main.js               # Webview client UI (vanilla JS, no framework)
  style.css             # Styles using VSCode theme variables
  marked.min.js         # Vendored Markdown parser (marked v17, GFM)
docs/
  architecture.md       # Data flow, lifecycle, design decisions
  data-model.md         # Types, JSONL format, filtering/status logic
  webview-ui.md         # Message protocol, UI components, sound system
  development.md        # Setup, build, packaging details
```

## How It Works

1. On activation, the extension registers the `claudeAgentManager.openPanel` command
2. Opening the panel creates a CSP-secured webview that reads `~/.claude/projects/`
3. Each project directory contains JSONL session files (and optional `subagents/` directories)
4. The reader parses messages, extracts metadata (git branch, first prompt, timestamps, tool usage), and derives session status
5. The webview refreshes every 30 seconds, updating status indicators and triggering sound notifications for newly waiting sessions

## License

MIT
