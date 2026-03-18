# Export Chat Feature — Design Spec

**Date:** 2026-03-17
**Status:** Approved

---

## Overview

Add an "Export" button to the conversation header that writes the currently viewed session (and all its subagents) to markdown files on disk. The root file links to agent files; all agent files share the same filename prefix as the root.

---

## Architecture & Data Flow

1. User clicks **Export** in the conversation header (only visible when a conversation is loaded).
2. Webview posts `exportChat` with `{ projectKey, sessionId }` to the extension. `agentId` is excluded — export always covers the full session tree (root + all subagents), regardless of which conversation is displayed.
3. `agentManagerPanel.ts` looks up the matching `ClaudeProject` and `ClaudeSession` from the last known `projects` list to resolve `displayName`, `cwd`, and the list of subagents. It then reads export settings from `globalState`, resolves the output path, and calls `exportConversation()` from `src/exporter.ts`.
4. `exporter.ts` receives `{ projectKey, sessionId, displayName, session }` plus resolved settings. It reads the root conversation via `readConversation(projectKey, sessionId)` and, for each subagent in `session.subAgents`, reads it via `readConversation(projectKey, sessionId, agent.agentId)`. `agent.agentId` is the bare ID without the `agent-` prefix — `readConversation` handles the prefix internally.
5. `exporter.ts` generates markdown strings and writes all files, returning `{ rootPath, agentPaths, skippedAgents }`.
6. The panel calls `vscode.window.showInformationMessage` with the root file path (and a skip warning if any agents were unreadable).
7. The panel posts `exportDone` back to the webview. **`exportDone` is always posted — success, failure, or user cancellation — so the button is always re-enabled.**

**Dialog cancelled:** If `vscode.window.showSaveDialog` returns `undefined` (user dismissed), the export is silently aborted, no error is shown, and `exportDone` is still posted.

**Auto-refresh safety:** The 30-second auto-refresh sends an `update` message to the webview. Because `retainContextWhenHidden: true` is set and the export button state is tracked in a local JS variable, an in-flight export is not affected by a concurrent `update` message.

---

## Prerequisites / Structural Changes

`ManagerSettings` is currently a local interface inside `agentManagerPanel.ts`. It must be **moved to `src/types.ts`** and exported, so `exporter.ts` can import it. This is a prerequisite refactor with no behaviour change.

---

## Settings Additions

Two new fields added to `ManagerSettings` in `src/types.ts` and persisted in `globalState`. Both exposed as radio groups in the settings panel.

### Export Destination (`exportDestination`)

| Value | Behaviour | Default |
|-------|-----------|---------|
| `dialog` | VSCode Save As dialog each time | ✓ |
| `default` | Fixed folder: `~/Documents/claude-exports/`. Created recursively if absent; creation failure → `showErrorMessage`. | |
| `cwd` | Session working directory (`session.cwd`). **If `cwd` is undefined/absent, falls back silently to `dialog`.** If `cwd` is known but the write fails (e.g. permissions), surfaces via `showErrorMessage` — no silent fallback. | |

### Tool Call Format (`exportToolFormat`)

| Value | Behaviour | Default |
|-------|-----------|---------|
| `compact` | `> **{ToolName}** {preview}` blockquote | ✓ |
| `expanded` | Fenced code blocks with full input + output (or error) | |
| `omit` | Tool blocks skipped entirely | |

**Compact preview rule:** Use the `preview` string from `MessageBlock` (already computed by `generateToolPreview()` in `claudeReader.ts`), truncated to 60 characters. If `preview` is empty, render just `> **{ToolName}**`.

---

## File Naming

Given a root path of `/some/dir/my-session.md`:

- Root file: `my-session.md`
- Agent files: `my-session-agent-{label}.md` where `label = slug || agentId[:8]`

**Collision deduplication:** If two agents produce the same `label`, append `-2`, `-3`, etc. to disambiguate (e.g., `my-session-agent-general-purpose-2.md`). Check for collisions before writing any files.

All files land in the same directory. Files are **overwritten silently**. In `dialog` mode the OS Save As dialog provides native overwrite confirmation for the root file; agent files are always overwritten silently.

---

## Markdown Structure

### Root file

```markdown
# Session: {firstPrompt truncated to 80 chars at export time}

**Project:** {displayName}
**Branch:** {gitBranch}
**Date:** {firstTimestamp as YYYY-MM-DD}

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

**Fallbacks:**
- `firstPrompt` missing → title uses `sessionId[:8]`
- `firstTimestamp` missing → `"Unknown date"`
- `gitBranch` missing → omit the **Branch** line entirely
- No subagents → omit the "Agents" section entirely

Note: `session.firstPrompt` may be up to 300 characters (truncated by the parser). The exporter applies a further truncation to 80 characters for the heading.

### Agent file

Same structure as root, with:
- A backlink on the first line: `← [Back to session](./my-session.md)`
- No "Agents" section
- Title: `# Agent: {slug || agentId[:8]}`

### Tool block formats

**compact** (default):
```markdown
> **Read** `src/foo.ts`
```

**expanded — success:**
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
> (file contents)
> ```
````

**expanded — error (`isError: true`):** Replace `*Output*` with `*Error*`:
````markdown
> **Read**
>
> *Input*
> ```
> src/foo.ts
> ```
>
> *Error*
> ```
> (error message)
> ```
````

**omit**: block skipped entirely.

---

## Error Handling

| Situation | Behaviour |
|-----------|-----------|
| `dialog` mode, user cancels Save As | Silent abort; `exportDone` posted; no error message |
| `cwd` mode, `session.cwd` is undefined | Silent fallback to `dialog` |
| `cwd` mode, write fails (permissions etc.) | `showErrorMessage`; `exportDone` posted |
| `default` mode, directory missing | Create recursively; on failure → `showErrorMessage`; `exportDone` posted |
| Any file write fails | `showErrorMessage`; `exportDone` posted |
| Subagent file unreadable | Skip it; omit its link from root Agents section; notification includes `"(N agent(s) could not be read)"` |
| `exportDone` guarantee | Always posted — success, failure, or cancellation |

---

## Components Changed / Added

| File | Change |
|------|--------|
| `src/types.ts` | Move `ManagerSettings` here from `agentManagerPanel.ts`; add `exportDestination` and `exportToolFormat` fields |
| `src/exporter.ts` | **New.** `exportConversation(params, settings)` — generates markdown, writes files, returns `{ rootPath, agentPaths, skippedAgents }` |
| `src/agentManagerPanel.ts` | Import `ManagerSettings` from `types.ts`; handle `exportChat` message; resolve output path; call exporter; show notification; post `exportDone` |
| `media/main.js` | Add Export button to conversation header; disable during export; re-enable on `exportDone`; add radio groups to settings panel |
| `media/style.css` | Style the export button and settings radio groups |

---

## Acceptance Criteria

- [ ] Export button appears only when a conversation is loaded; hidden otherwise
- [ ] Clicking export always exports the full session tree (root + all subagents)
- [ ] `dialog` mode: Save As dialog opens; cancelling silently re-enables button with no error
- [ ] `default` mode: files written to `~/Documents/claude-exports/`; directory created if absent
- [ ] `cwd` mode: files written to `session.cwd`; falls back to dialog if `cwd` is undefined
- [ ] All three `exportToolFormat` modes render correctly
- [ ] `compact` tool blocks use the existing `preview` string, truncated to 60 chars
- [ ] `expanded` tool blocks render `*Error*` instead of `*Output*` when `isError` is true
- [ ] Root file contains relative links to all successfully exported agent files
- [ ] Agent files contain a backlink to the root file
- [ ] Agent filename collisions are deduplicated with `-2`, `-3` suffixes
- [ ] Unreadable subagent files are skipped with a count in the notification
- [ ] Export button re-enables after success, failure, and cancellation
- [ ] `ManagerSettings` is exported from `src/types.ts`

---

## Out of Scope

- Exporting multiple sessions at once
- HTML or PDF output formats
- Exporting from the sidebar without viewing the conversation first
