# Development Guide

## Prerequisites

- Node.js 20+
- VSCode 1.85+

## Setup

```bash
npm install
```

## Build & Run

```bash
npm run compile    # One-time build
npm run watch      # Watch mode
```

Or press **F5** in VSCode to launch the Extension Development Host (uses `.vscode/launch.json`).

## Project Structure

```
src/
  extension.ts          ← Entry point: registers command, activates on startup
  agentManagerPanel.ts  ← Webview panel: singleton, HTML template, message handling
  claudeReader.ts       ← Data layer: reads ~/.claude/projects/ JSONL files
  types.ts              ← TypeScript interfaces (ClaudeProject, ClaudeSession, SubAgent)
media/
  main.js               ← Webview client JS (IIFE, no framework)
  style.css             ← Webview styles
.vscode/
  launch.json           ← F5 debug config
  tasks.json            ← Build task
```

## Key Commands

| Command | Keybinding | Description |
|---------|------------|-------------|
| `claudeAgentManager.openPanel` | `Cmd+Shift+A` (Mac) / `Ctrl+Shift+A` | Open the Agent Manager panel |

## Build Output

TypeScript compiles to `out/` directory. The `.vscodeignore` ensures only `out/`, `media/`, and `package.json` are packaged.

## No Bundler

The extension has zero runtime dependencies and uses `tsc` directly. No webpack/esbuild/rollup.

## Packaging

```bash
npx vsce package    # Creates .vsix file
```
