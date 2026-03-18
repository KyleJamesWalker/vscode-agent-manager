# Session Interaction Design

**Date:** 2026-03-18
**Inspired by:** [see-claude](https://github.com/lukejbyrne/see-claude)
**Status:** Approved

## Overview

Add interactive session control to the Claude Agent Manager extension. Currently read-only, the extension will gain the ability to focus running Claude terminals, send messages to sessions, and resume past sessions — all from within the conversation panel. A "thinking" status is also introduced to distinguish Claude mid-tool-execution from Claude waiting for user input.

---

## 1. TerminalManager Service

**New file:** `src/terminalManager.ts`

### Responsibilities

- **Process scan (every 5s):** Discover running Claude processes and link them to VSCode terminals.
  1. `pgrep -x claude` → array of Claude PIDs
  2. For each PID: get parent PID via `ps -p <pid> -o ppid=`
  3. Match parent PID against `terminal.processId` for each entry in `vscode.window.terminals`
  4. Get Claude process CWD via `lsof -p <pid> -Fn | grep '^n/'`
  5. Store `cwd → vscode.Terminal` map

- **Explicit tracking:** Terminals created by the extension (resume/launch) are added to the map immediately, without waiting for the next scan.

- **Resume:** If no terminal exists for a session's CWD, create a new `vscode.Terminal` and run `claude --resume <sessionId>` in that directory. Add to map immediately.

- **Send:** `terminal.sendText(text, true)` — appends a newline (equivalent to pressing Enter).

- **Focus:** `terminal.show()`.

### Public API

```typescript
getTerminalForCwd(cwd: string): vscode.Terminal | undefined
resumeSession(sessionId: string, cwd: string): Promise<vscode.Terminal>
sendToSession(cwd: string, text: string): Promise<void>
focusSession(cwd: string): void
dispose(): void
```

### Lifecycle

- Instantiated in `AgentManagerPanel` constructor; disposed on panel dispose.
- Scan interval paused when the panel is hidden, resumed on show (mirrors existing file watcher pattern).
- On each scan, if the current conversation's CWD changes terminal status, posts `terminalStatus` to the webview.

---

## 2. Conversation Header Actions

### Current header layout

```
Breadcrumb  |  LIVE badge  |  Export button
```

### New header layout

```
Breadcrumb  |  LIVE badge  |  [Focus ⤴]  [Send ✉]  |  Export button
```

### Focus button

- Rendered only when `TerminalManager` reports a live terminal for the current session's CWD.
- Appears/disappears reactively via `terminalStatus` messages (no full re-render).
- On click: webview posts `{ command: 'focusTerminal' }` → extension calls `terminalManager.focusSession(cwd)`.

### Send button

- Always visible when a conversation is loaded.
- Toggles the send input bar open/closed.
- If no live terminal exists when the user submits a message, the extension automatically resumes the session first, then sends.

### New webview message (extension → webview)

```typescript
{ command: 'terminalStatus', cwd: string, hasTerminal: boolean }
```

Sent on each scan cycle when the status for the current session changes. Drives Focus button visibility.

---

## 3. Send Input Component

An inline input bar pinned to the bottom of the conversation panel, below the message list. Slides in when Send is toggled; pushes the message list up (does not overlap).

### Behavior

| Action | Result |
|--------|--------|
| Click Send button | Bar slides open |
| `Enter` | Submit message |
| `Shift+Enter` | Insert newline |
| `Escape` | Close and clear bar |
| Click Send button again | Close and clear bar |

### States

- **Idle:** Textarea enabled, submit button active (disabled if input empty).
- **In-flight:** Textarea `disabled`, submit button shows spinner.
- **Success:** Input clears; bar stays open (ready for follow-up).
- **Error:** Textarea re-enables; small inline error message appears below textarea.

### Textarea

- Single-line initially; grows up to 4 lines via JS height adjustment on `input` event.
- `resize: none`.

### Message protocol

**Webview → extension:**
```typescript
{ command: 'sendMessage', text: string }
```

**Extension → webview:**
```typescript
{ command: 'sendMessageResult', success: boolean, error?: string }
```

The extension handler calls `terminalManager.sendToSession(cwd, text)`, resuming first if needed.

---

## 4. "Thinking" Status

### Motivation

The current `waiting` status (orange pulse) covers two distinct states that should look different:
- Claude has responded and is **waiting for user input** — needs the user's attention.
- Claude is **mid-tool-execution** — actively running tools; the user need not act.

### Detection

In Claude Code's JSONL, the last message determines status. The new logic in `claudeReader.ts`:

| Last message | Last content block | New status |
|---|---|---|
| `role: user` | any | `active` (unchanged) |
| `role: assistant` | `type: tool_use` | `thinking` (NEW) |
| `role: assistant` | `type: text` | `waiting` (unchanged) |

### Visual indicator

| Status | Color | Animation |
|---|---|---|
| `active` | green | solid dot |
| `thinking` | blue/purple | pulse |
| `waiting` | orange | pulse |
| `recent` | dimmer dot | none |
| `idle` | gray | none |

### Scope of change

- `claudeReader.ts` — status derivation in `readClaudeProjects()` and `readConversation()`
- `media/main.js` — new `thinking` CSS class handling in status dot and filter logic
- `media/style.css` — `.status-thinking` dot color + keyframe animation
- `src/types.ts` — extend status type if explicitly typed

---

## Architecture Impact

### New file

- `src/terminalManager.ts` — standalone service, no circular deps

### Modified files

- `src/agentManagerPanel.ts` — instantiate TerminalManager, handle new webview messages (`focusTerminal`, `sendMessage`), post `terminalStatus` and `sendMessageResult`
- `src/claudeReader.ts` — thinking status detection
- `src/types.ts` — add `thinking` to session/subagent status type
- `media/main.js` — Focus/Send buttons in header, send input bar component, `terminalStatus` handler, `sendMessageResult` handler
- `media/style.css` — send bar styles, thinking status dot

### Non-goals

- No writes to Claude's `.claude/projects/` data files (session interaction goes through the terminal, not the data layer).
- No AppleScript or macOS-specific APIs — terminal control uses VSCode's cross-platform `vscode.Terminal` API only.
- No message history in the send bar — single-message input only (no ↑ arrow history).
