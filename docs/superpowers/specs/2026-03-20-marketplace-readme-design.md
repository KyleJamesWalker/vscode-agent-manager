# Marketplace README & Screenshot Design

**Date:** 2026-03-20
**Status:** Approved

## Problem

The existing README is written for contributors building from source (npm install, F5 debug, Project Structure). Now that the extension is published on the VSCode Marketplace, the primary audience is end users installing via the marketplace. Additionally:

- The README incorrectly describes the extension as "read-only" — a Send button was added that fully submits messages to Claude sessions via terminal integration.
- The Export feature is mentioned but not prominently featured.
- There is no screenshot reference in the README.

## Approach

**Feature Showcase** structure: badges → screenshot → three grouped feature sections → installation → usage → collapsed developer section.

This matches the format used by popular marketplace extensions. Grouping features by capability (Monitor / Interact / Export) maps to the actual UI layout and gives users a clear mental model before they install.

## Design

### Structure

```
# Claude Code Agent Manager

[badges: version · license · marketplace]

> One-line tagline

![screenshot](screenshot.png)

## Features

### 🔍 Monitor
- bullet list

### 💬 Interact
- bullet list

### 📤 Export
- bullet list

## Installation

ext install command + search instructions

## Usage

Keybinding + command palette + keyboard nav cheatsheet

<details><summary>For Developers</summary>

## Build
## Run / Debug
## Project Structure
## How It Works

</details>

## License
```

### Content Changes

**Tagline** (replaces current headline description):
> A live dashboard for your Claude Code sessions — monitor agents, send messages, and export conversations without leaving VSCode.

**Monitor section** (sidebar features):
- Browse all projects, sessions, and subagents across workspaces
- Live status indicators: active (green), waiting for input (orange pulse), recent (yellow), idle (gray)
- Filter chips: All / Active / Waiting / Pinned — with live counts
- Sound notifications when a session needs attention, with configurable repeat intervals

**Interact section** (replaces "read-only" claim):
- Send messages directly to any Claude session from the panel
- Automatically resumes a session in a new terminal if Claude is not already running
- Full conversation view with Markdown rendering and collapsible tool badges (Bash shows command, Read/Edit shows filename, Grep shows pattern + match count)
- Live-tailing — new messages appear automatically via file watcher

**Export section**:
- Save any conversation to Markdown with one click
- Configurable tool output format: compact, expanded, or omit

**Installation**:
- Primary: search "Claude Code Agent Manager" in Extensions panel
- Secondary: `ext install KyleJamesWalker.vscode-cc-agent-manager`
- Remove VSIX-from-source instructions (or move to developer section)

**Usage**:
- Keybinding: `Cmd+Shift+A` / `Ctrl+Shift+A`
- Command Palette: `Claude: Open Agent Manager`
- Sidebar keyboard shortcuts: `j/k` navigate, `/` search, `p` pin, `?` help overlay

**Removed from top level** (moved inside `<details>For Developers</details>`):
- Build section (npm install, npm run compile)
- Run / Debug section (F5, Extension Development Host)
- Package & Install Locally section
- Project Structure
- How It Works

### Screenshot

- File: `screenshot.png` (already created, at project root)
- Referenced in README as `![screenshot](screenshot.png)`
- Placed immediately after the tagline/badges

### Badges

Use shields.io style badges for:
- Version (from package.json: v0.1.0)
- License (MIT)
- VSCode Marketplace install link

## Acceptance Criteria

1. README no longer contains the phrase "read-only" or any claim that the extension only reads data
2. Send/Interact feature is documented in the features section
3. Export feature is a first-class section
4. README contains `![screenshot](screenshot.png)` and `screenshot.png` exists at the project root
5. Installation instructions lead with marketplace install, not source build
6. Developer sections (Build, Debug, Project Structure, How It Works) are present but inside a `<details>` collapse
7. Keyboard shortcut to open the panel is documented
8. All badges link to correct URLs
