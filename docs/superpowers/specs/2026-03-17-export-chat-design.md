# Export Chat Feature — Design Spec

**Date:** 2026-03-17
**Status:** Approved

---

## Overview

Add an "Export" button to the conversation header that writes the currently viewed session (and its subagents) to markdown files on disk. The root file links to agent files; all agent files share the same filename prefix as the root.

---

## Architecture & Data Flow

1. User clicks **Export** in the conversation header (only visible when a conversation is loaded).
2. Webview posts `exportChat` with `{ projectKey, sessionId, agentId? }` to the extension.
3. `agentManagerPanel.ts` reads export settings from `globalState`, resolves the output path, then calls `exportConversation()` from the new `src/exporter.ts` module.
4. `exporter.ts` reads the root session via `readConversation()` and, if the session has subagents, reads each one. It generates all markdown strings and writes root + agent files.
5. The panel calls `vscode.window.showInformationMessage` with the root file path.
6. The panel posts `exportDone` back to the webview, re-enabling the export button.

**"Save As" destination:** `vscode.window.showSaveDialog` returns only the root path. Agent file paths are derived automatically — no second dialog shown.

---

## Settings Additions

Two new fields added to the existing `ManagerSettings` interface and persisted in `globalState`. Both are exposed as radio groups in the settings panel.

### Export Destination (`exportDestination`)

| Value | Behaviour | Default |
|-------|-----------|---------|
| `dialog` | VSCode Save As dialog each time | ✓ |
| `default` | Fixed folder: `~/Documents/claude-exports/` | |
| `cwd` | Project working directory (`session.cwd`) | |

### Tool Call Format (`exportToolFormat`)

| Value | Behaviour | Default |
|-------|-----------|---------|
| `compact` | `> **{ToolName}** {preview}` blockquote | ✓ |
| `expanded` | Fenced code blocks with full input + output | |
| `omit` | Tool blocks skipped entirely | |

---

## File Naming

Given a root path of `/some/dir/my-session.md`:

- Root file: `my-session.md`
- Agent files: `my-session-agent-{slug||agentId[:8]}.md`

All files land in the same directory.

---

## Markdown Structure

### Root file

```markdown
# Session: {firstPrompt truncated to 80 chars}

**Project:** {displayName}
**Branch:** {gitBranch}
**Date:** {firstTimestamp formatted as ISO date}

## Agents

- [general-purpose](./my-session-agent-general-purpose.md)
- [explore](./my-session-agent-explore.md)

---

## Conversation

### You · 10:32 AM

{text block — preserved as-is, already markdown}

### Claude · 10:32 AM

{text block}

> **Read** `src/foo.ts`
```

The "Agents" section is omitted when the session has no subagents.

### Agent file

Same structure as root, with:
- No "Agents" section
- A backlink at the top: `← [Back to session](./my-session.md)`
- Title reflects the agent's slug or truncated ID

### Tool block formats

**compact** (default):
```markdown
> **Read** `src/foo.ts`
```

**expanded**:
````markdown
> **Read**
>
> *Input*
> ```
> src/foo.ts
> ```
>
> *Output*
> ```
> 1→export interface SubAgent {
> ...
> ```
````

**omit**: block skipped, not written.

---

## Components Changed / Added

| File | Change |
|------|--------|
| `src/types.ts` | Add `exportDestination` and `exportToolFormat` to `ManagerSettings` |
| `src/exporter.ts` | **New.** `exportConversation(params, settings)` — reads conversations, generates markdown, writes files, returns `{ rootPath, agentPaths }` |
| `src/agentManagerPanel.ts` | Handle `exportChat` message; resolve output path; call exporter; show notification; post `exportDone` |
| `media/main.js` | Add Export button to conversation header; disable during export; re-enable on `exportDone` |
| `media/style.css` | Style the export button and settings radio groups |

---

## Error Handling

- If destination is `cwd` but `session.cwd` is unknown → fall back to `dialog`
- If write fails → `vscode.window.showErrorMessage` with the error
- The button is always re-enabled after success or failure

---

## Out of Scope

- Exporting multiple sessions at once
- HTML or PDF output formats
- Exporting from the sidebar without viewing the conversation first
