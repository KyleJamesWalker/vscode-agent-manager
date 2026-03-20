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
  claudeReader.ts       ← Data layer: reads ~/.claude/projects/ JSONL files; exports readConversation
  exporter.ts           ← Export feature: renders conversations to Markdown files
  types.ts              ← TypeScript interfaces (ClaudeProject, ClaudeSession, SubAgent,
                           MessageBlock, ConversationMessage, ManagerSettings)
media/
  main.js               ← Webview client JS (IIFE, no framework)
  style.css             ← Webview styles
  marked.min.js         ← Vendored Markdown renderer used in conversation view
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

## GitHub Actions & Publishing

Two workflows handle versioning and marketplace publishing.

### Release workflow (`.github/workflows/release.yml`)

Triggers when a PR is **merged into `main`** with one of these labels: `major`, `minor`, or `patch`.

Steps:
1. Bumps `package.json` version via `npm version <type>`
2. Commits the version bump back to `main` with `[skip ci]`
3. Creates and pushes a git tag (`v<version>`)
4. Creates a **draft** GitHub release with auto-generated notes

The release is left as a draft so you can review the changelog before it goes public.

### Publish workflow (`.github/workflows/publish.yml`)

Triggers when a GitHub release is **published** (i.e. you manually promote the draft).

Steps:
1. Runs `npm ci` and `npx @vscode/vsce package`
2. Uploads the `.vsix` artifact to the GitHub release
3. Publishes to the VS Code Marketplace via `vsce publish`

Requires a `VSCE_PAT` repository secret (a Personal Access Token from the VS Code Marketplace publisher account).

### Release process (end to end)

1. Label your PR with `major`, `minor`, or `patch` before merging
2. Merge the PR — the Release workflow runs automatically
3. Go to the GitHub Releases page and review the draft
4. Click **Publish release** — the Publish workflow runs and pushes to the Marketplace

> **Why draft?** GitHub Actions workflows triggered by `GITHUB_TOKEN` cannot cascade into other workflow runs. Creating the release as a draft and publishing it manually ensures the `release: published` event is attributed to your user account, which correctly triggers the Publish workflow.
