# Session Interaction Design

**Date:** 2026-03-18
**Inspired by:** [see-claude](https://github.com/lukejbyrne/see-claude), and desire for easier interactions.
**Status:** Approved

## Overview

Add interactive session control to the Claude Agent Manager extension. Currently read-only, the extension will gain the ability to focus running Claude terminals, send messages to sessions, and resume past sessions — all from within the conversation panel. A "thinking" status is also introduced to distinguish Claude mid-tool-execution from Claude waiting for user input.

---

## 1. TerminalManager Service

**New file:** `src/terminalManager.ts`

### Responsibilities

- **Process scan (every 5s):** Discover running Claude processes and link them to VSCode terminals.
  1. `pgrep -x claude` → array of Claude PIDs (macOS/Linux only — see Platform section)
  2. For each PID: get parent PID via `ps -p <pid> -o ppid=`
  3. Match parent PID against `terminal.processId` for each entry in `vscode.window.terminals`
  4. Get Claude process CWD:
     - macOS: `lsof -p <pid> -Fn | grep '^n/'`
     - Linux: `fs.readlinkSync('/proc/<pid>/cwd')`
  5. Store `cwd → vscode.Terminal` map

- **Explicit tracking:** Terminals created by the extension (resume) are added to the map immediately, without waiting for the next scan.

- **Resume:** If no terminal exists for a session's CWD, create a new `vscode.Terminal` with `cwd` set and run `claude --resume <sessionId>`. Add to map immediately. `resumeSession` awaits a 2-second delay internally before resolving, giving Claude time to reach its interactive prompt. Callers (including `sendToSession`) simply await `resumeSession` and then proceed — the delay is fully contained in `resumeSession`.

- **Send:** `terminal.sendText(text, true)` — appends a newline (equivalent to pressing Enter).

- **Focus:** `terminal.show()`.

### Public API

```typescript
getTerminalForCwd(cwd: string): vscode.Terminal | undefined
resumeSession(sessionId: string, cwd: string): Promise<vscode.Terminal>
sendToSession(cwd: string, text: string): Promise<void>
focusSession(cwd: string): void
setCurrentCwd(cwd: string | undefined): void
dispose(): void
```

### Platform support

Process scanning uses `pgrep` and either `lsof` (macOS) or `/proc` (Linux). Windows has neither; on Windows the scan step is skipped and only terminals created by the extension are tracked. The Focus button will not appear for pre-existing terminals on Windows.

`pgrep -x claude` matches the exact process name `claude`. If Claude is installed as an npm global binary the process name is `claude`. If this returns no results, the scan silently yields an empty set (no error surfaced to the user).

### Scan change-detection state

`TerminalManager` maintains an internal `Map<cwd, boolean>` (`_prevHasTerminal`) to detect changes between scan cycles. On each scan cycle, if `hasTerminal !== _prevHasTerminal.get(currentCwd)`, a `terminalStatus` message is posted and the map is updated. Only the currently-displayed session's CWD is checked; status for other sessions is not broadcast.

`AgentManagerPanel` calls `terminalManager.setCurrentCwd(cwd)` whenever the user switches sessions. `setCurrentCwd` immediately posts a `terminalStatus` for the new CWD based on the current map state (regardless of whether the value changed) so the webview is up to date after a session switch.

### Lifecycle

- Instantiated in `AgentManagerPanel` constructor; disposed on panel dispose.
- Scan interval paused when the panel is hidden, resumed on show (mirrors existing file watcher pattern).
- `setCurrentCwd(cwd: string | undefined)` added to public API.

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

Both new buttons follow the same initial-hidden / JS-show pattern as the Export button — hidden until a conversation is selected via `selectConversation()`.

### Focus button

- Shown only when `TerminalManager` reports a live terminal for the current session's CWD.
- Appears/disappears reactively via `terminalStatus` messages — no full re-render.
- On click: webview posts `{ command: 'focusTerminal' }` → extension calls `terminalManager.focusSession(currentCwd)`.

### Send button

- Shown whenever a conversation is loaded (same lifecycle as Export button).
- Toggles the send input bar open/closed.
- If no live terminal exists when the user submits a message, the extension automatically resumes first then sends (with the 2-second delay described in §1).

### Extension-side CWD tracking

`AgentManagerPanel` stores `_currentCwd: string | undefined` alongside the existing `_watchedProjectKey` / `_watchedSessionId` / `_watchedAgentId`.

It is set in the `loadConversation` handler: the handler already has `projectKey` and `sessionId`, so it looks up the session directly from `this._projects` (find project by key, find session by sessionId) and reads `session.cwd`. This lookup happens synchronously before `readConversation` is called, so `_currentCwd` is always set before any subsequent `focusTerminal` or `sendMessage` message can arrive.

When a **subagent** conversation is loaded (`agentId` is set), `_currentCwd` is still resolved from the **parent session** (same projectKey + sessionId lookup). Subagents share the parent session's CWD for terminal operations.

If `cwd` is undefined (field is optional in `ClaudeSession`), both `focusTerminal` and `sendMessage` commands return: `{ command: 'sendMessageResult', success: false, error: 'Session has no working directory' }`.

### New messages

**Extension → webview** (sent when terminal status changes for the current session):
```typescript
{ command: 'terminalStatus', sessionId: string, hasTerminal: boolean }
```
`sessionId` lets the webview confirm the update applies to the currently-displayed session (guards against stale messages after switching sessions).

**Extension → webview** (sent in `conversation` response — includes CWD for matching):
The existing `conversation` message gains one additional field: `cwd: string | undefined`.

---

## 3. Send Input Component

An inline input bar pinned to the bottom of the conversation panel, below the message list. Slides in when Send is toggled; pushes the message list up (does not overlap).

### Behavior

| Action | Result |
|--------|--------|
| Click Send button | Bar slides open, textarea focused |
| `Enter` | Submit message |
| `Shift+Enter` | Insert newline |
| `Escape` | `stopPropagation()` + close and clear bar (prevents global Escape from also deselecting the session) |
| Click Send button again | Close and clear bar |

### States

- **Idle:** Textarea enabled, submit button active (disabled if input empty).
- **Resuming:** Shown when no live terminal exists and resume is in progress. Textarea disabled, submit button shows "Resuming…" label. The extension's `sendToSession` awaits `resumeSession` (which handles the 2-second delay internally) before calling `terminal.sendText`, then replies with `sendMessageResult`. The webview stays in Resuming state until it receives `sendMessageResult`.
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

The extension handler calls `terminalManager.sendToSession(cwd, text)`. If `cwd` is undefined, it returns an error immediately. `sendToSession` calls `resumeSession` if no terminal exists (which awaits the 2-second delay internally), then calls `terminal.sendText(text, true)`.

---

## 4. "Thinking" Status

### Motivation

The current `waiting` status (orange pulse) covers two distinct states:
- Claude has responded and is **waiting for user input** — needs the user's attention.
- Claude is **mid-tool-execution** — actively running tools; the user need not act.

### Computed status field

Rather than deriving status in the webview from `lastMessageRole` + `lastTimestamp`, status is computed in `claudeReader.ts` and stored in a new `status` field on both `ClaudeSession` and `SubAgent`. This is cleaner and ensures the incremental `sidebarRowUpdate` path carries the same status as the full refresh path.

**`ClaudeSession` and `SubAgent` both gain:**
```typescript
status: 'active' | 'thinking' | 'waiting' | 'recent' | 'idle'
```

The webview still uses `lastTimestamp` to compute `recent` vs `idle` (time-based thresholds), but `active` / `thinking` / `waiting` come from the reader.

### Detection logic (in `claudeReader.ts`)

During message parsing, track:
- `lastMessageRole: 'user' | 'assistant'`
- `lastContentBlockType: string | undefined` — the `type` field of the last item in the last message's `content` array (only tracked when `lastMessageRole === 'assistant'`)

Status derivation:

| `lastMessageRole` | `lastContentBlockType` | `status` |
|---|---|---|
| `'user'` | any | `'active'` |
| `'assistant'` | `'tool_use'` | `'thinking'` |
| `'assistant'` | `'text'` or `undefined` | `'waiting'` |

When `content` is a plain string (not an array), `lastContentBlockType` is `undefined`, which maps to `'waiting'` — same as a text-block assistant message.

`recent` and `idle` are time-based overlays applied in the webview (>5min → `recent`, >2h → `idle`) — unchanged from current behavior, but only applied when `status` is not `active`/`thinking`/`waiting`.

### `sidebarRowUpdate` update

The `sidebarRowUpdate` message gains a `status` field:
```typescript
{ command: 'sidebarRowUpdate', sessionId: string, status: string, lastTimestamp: string, messageCount: number }
```
This ensures the live-tail path shows `thinking` correctly, not just the 30-second full refresh.

The `handleSidebarRowUpdate` handler in `main.js` uses `status` directly to set the dot CSS class (e.g. `status-thinking`, `status-active`, `status-waiting`), applying time-based overlay (`recent`/`idle`) only when `status` is none of `active`/`thinking`/`waiting`. The `isItemWaiting()` check for the orange badge uses `status === 'waiting'` — `thinking` does not trigger the waiting badge since it does not require user action.

### Filter chip behavior

`thinking` sessions appear under the **Active** filter chip (they are live and not waiting for user input). The **Waiting** filter chip matches only `status === 'waiting'`. No new filter chip is added.

### Visual indicator

| Status | Color | Animation |
|---|---|---|
| `active` | green | solid dot |
| `thinking` | blue/purple | pulse |
| `waiting` | orange | pulse |
| `recent` | dimmer dot | none |
| `idle` | gray | none |

### Scope of change

- `src/types.ts` — add `status: 'active' | 'thinking' | 'waiting' | 'recent' | 'idle'` to `ClaudeSession` and `SubAgent`
- `src/claudeReader.ts` — track `lastContentBlockType` during parse; compute and store `status`
- `src/agentManagerPanel.ts` — include `status` in `sidebarRowUpdate`
- `media/main.js` — consume `status` from data (remove derived status from `lastMessageRole`); handle `thinking` CSS class; update `sidebarRowUpdate` handler
- `media/style.css` — `.status-thinking` dot color + pulse keyframe

---

## Architecture Impact

### New file

- `src/terminalManager.ts` — standalone service, no circular dependencies

### Modified files

- `src/types.ts` — `status` field on `ClaudeSession` and `SubAgent`
- `src/claudeReader.ts` — `lastContentBlockType` tracking; computed `status` field; `thinking` detection
- `src/agentManagerPanel.ts` — instantiate `TerminalManager`; track `_currentCwd`; handle `focusTerminal` and `sendMessage` webview messages; post `terminalStatus` and `sendMessageResult`; include `status` in `sidebarRowUpdate`; include `cwd` in `conversation` message
- `media/main.js` — Focus/Send buttons (hidden until conversation loaded); send input bar component; `terminalStatus` handler; `sendMessageResult` handler; consume computed `status` from data; Escape `stopPropagation` in send bar
- `media/style.css` — send bar layout; thinking status dot + animation

### Non-goals

- No writes to Claude's `.claude/projects/` data files — interaction goes through the terminal only.
- No message history in the send bar (no ↑ arrow recall).
- No Windows process scanning — Feature degrades gracefully: Focus button absent for pre-existing terminals; Resume/Send still work for extension-created terminals.
