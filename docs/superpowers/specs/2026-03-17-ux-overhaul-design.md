# UX/UI Overhaul — Design Spec

## Context

Claude Agent Manager is a VS Code extension (targeting Marketplace publication) that reads Claude Code session data from `~/.claude/projects/` and displays active sessions, subagents, and conversations in a webview panel. The current UI works but has pain points: project cards consume too much vertical space, the conversation panel feels disconnected from sidebar selection, the layout doesn't adapt to narrow widths, and visual polish doesn't hold up across VS Code themes.

## Goals

- Compress the sidebar for scan-ability across many projects/sessions
- Create a stronger visual connection between sidebar selection and conversation content
- Support all three usage modes: monitoring, reviewing, and active session management
- Add keyboard navigation for power users
- Replace 30s polling with real-time tailing for active conversations
- Adapt layout for narrow panel widths (sidebar-docked usage)
- Achieve theme-aware polish across all VS Code color themes

## Non-Goals

- Resizable split pane (drag divider) — nice-to-have, not in this iteration
- First-run onboarding flow — deferred
- Writing to Claude's data files — extension remains read-only

---

## 1. Sidebar Redesign

### Layout

Replace the card-based project list with a tree view.

- **Project headers:** Single-line collapsible rows. `chevron` + `status dot` + `project name` + `time ago`. No path shown by default (available via tooltip on the project name). Hover reveals actions (pin, open, open-new) — same as today but smaller. ~22px per row.
- **Session rows:** Two-line rows indented under their project. First line: `status dot` + `prompt (truncated)` + `time ago`. Second line (indented further): `waiting badge` + `git branch` + `message count` + `agent count`. ~32px per row.
- **Subagent rows:** Nest one level deeper under their session, using the existing left-border-line treatment.

### Selection State

Active session gets a strong visual highlight:
- `background: var(--vscode-list-activeSelectionBackground)`
- `border-left: 2px solid var(--vscode-focusBorder)`

This is the primary mechanism connecting sidebar to conversation content.

### Unchanged

- **Filter bar:** All / Active / Waiting / Pinned chips stay as-is.
- **Search bar:** Text filter on displayName and path stays as-is.

---

## 2. Conversation Panel

### Header

Minimal breadcrumb bar: `project name` / `session ID (truncated to 8 chars)` in monospace. Export button on the right side. The breadcrumb provides navigational context (which project, which session) without repeating the prompt text already visible in the sidebar's selected row.

### Transition

When switching between different sessions, conversation content transitions with a CSS opacity crossfade (~150ms). Prevents the jarring "content pop" of instant innerHTML replacement. Tail updates (new messages arriving for the already-selected session) append without crossfade.

### Messages, Tool Badges

No changes to the conversation renderer. The message layout (role labels, timestamps, text blocks, markdown rendering) and tool badge collapsed/expanded pattern are already solid.

---

## 3. Real-Time Tailing

### File Watching

Replace the 30s `setInterval` for the active conversation with `fs.watch()` on the selected conversation's JSONL file. This applies to both session files (`<projectKey>/<sessionId>.jsonl`) and subagent files (`<projectKey>/<sessionId>/subagents/agent-<agentId>.jsonl`) — the watcher targets whichever file corresponds to the currently viewed conversation. Debounce file change events by 500ms, then re-read the conversation. The sidebar continues to refresh on a 30s poll (watching all project directories would be excessive).

### Watcher Lifecycle

Maintain a single `fs.FSWatcher` instance on `AgentManagerPanel`:
- **On session/subagent selection:** Close the existing watcher (if any), create a new one targeting the selected conversation's JSONL file.
- **On panel hide:** Close the watcher via `onDidChangeViewState`. The 30s poll handles background updates.
- **On panel show:** Re-create the watcher for the currently selected conversation (if any).
- **On panel dispose:** Close the watcher in the `dispose()` method.

### Read Strategy

On each debounced file change event, perform a full re-read of the conversation via the existing `readConversation()` function. Send the full message array to the webview with a `conversationTail` command (distinct from `conversation` used on initial load):

```
{ command: 'conversationTail', messages: [...], sessionId, agentId }
```

The webview handles `conversationTail` by comparing the new message count against the currently rendered count. Messages beyond the previous count are treated as "new" — they receive the highlight treatment and trigger the divider/pill logic. This avoids the complexity of incremental byte-offset reads while still enabling the new-message UX.

### Auto-Scroll (User at Bottom)

When the user is scrolled to the bottom (within a 50px threshold of `scrollHeight`):
- New messages auto-scroll into view.
- New messages get a subtle left-border highlight (`2px solid` active color) that fades out after 2 seconds via CSS transition.
- A "LIVE" indicator appears in the breadcrumb bar: pulsing green dot + "LIVE" label. Shown when the watched file has been modified within the last 60 seconds.

### LIVE Indicator Lifecycle

- **Activation:** Set a `liveTimeout` variable. On each file change event, clear the existing timeout and set a new 60-second `setTimeout`. While the timeout is active, show the LIVE indicator.
- **Deactivation (timeout):** When the 60-second timeout expires without a new file change, hide the LIVE indicator.
- **Deactivation (session switch):** Clear the timeout and hide the indicator immediately when the user selects a different session.

### Detached Scrolling (User Scrolled Up)

When the user has scrolled up to read history:
- Auto-scroll disengages. New messages append below the viewport without interrupting.
- A `--- new ---` divider line marks where new content begins (green line with centered "NEW" label).
- A floating pill anchored to the bottom of the conversation container shows "N new messages". Clicking it scrolls to the latest message and re-engages auto-scroll.

### Sidebar Side Effects

When a file watcher fires, also update the corresponding session row in the sidebar. Use a targeted DOM update: find the row by `data-session-id`, update its status dot class, waiting badge visibility, and message count text content. Do not re-render other rows. This keeps the sidebar feeling alive between 30s poll cycles without the cost of a full re-render.

---

## 4. Keyboard Navigation

### Model

Vim-inspired bindings, active only when the sidebar has focus. No conflicts with VS Code's built-in shortcuts because letter keys only bind in the sidebar's focus context.

### Bindings

| Key | Action |
|-----|--------|
| `j` | Move focus down (flat list: projects + sessions + subagents) |
| `k` | Move focus up |
| `h` | Collapse project / move focus to parent project |
| `l` | Expand project / move focus to first child session |
| `Enter` | Open conversation for focused item |
| `Escape` | Deselect conversation, return focus to sidebar |
| `p` | Toggle pin on focused project |
| `g` `g` | Jump to top of list (both presses within 500ms; single `g` is a no-op) |
| `G` | Jump to bottom of list |
| `/` | Focus the search input |
| `?` | Show keyboard shortcut overlay |
| `Tab` | Move focus between sidebar and conversation panel |

### Focus Indicators

Focused item in sidebar gets a visible indicator (dotted outline or background shift distinct from selection highlight). Standard scrolling keys (arrows, Page Up/Down, Home/End) work when the conversation panel is focused.

### Discoverability

No persistent keybinding hints in the UI. A tooltip on the sidebar header reads: "Keyboard: j/k to navigate, ? for help". Pressing `?` opens a centered modal overlay listing all shortcuts. The overlay is dismissed by `Escape` or clicking outside. While the overlay is open, other keyboard bindings are suppressed.

---

## 5. Responsive / Adaptive Layout

### Breakpoints

| Width | Behavior |
|-------|----------|
| > 600px | **Wide:** Full split pane — sidebar (280px fixed) + conversation side by side |
| ≤ 600px | **Narrow:** Sidebar collapses to icon rail, conversation gets full width |

### Icon Rail (Narrow Mode)

A vertical strip of status dots — one per **project**, reflecting the project's aggregate status (computed by the existing `projectStatusClass` function). Projects are separated by subtle gaps.

- **Hover:** Tooltip with project name and session count.
- **Click:** Expands the full sidebar as an overlay (slides from left with box-shadow). The overlay shows the full tree view — the user clicks a session to open the conversation and dismiss the overlay.

This matches the VS Code activity bar pattern: one icon per view container, not one icon per item within a view.

### Detection

Use `ResizeObserver` on the `#app` container (not `window.resize` — webview panels resize independently of the window).

### Transition

CSS transition on sidebar width (~200ms ease). Conversation panel flexes to fill available space. No layout jumps.

---

## 6. Theme-Aware Polish

### Principle

Every color must reference a VS Code CSS custom property with a hardcoded fallback. No bare hex values outside of fallback position.

### Status Dot Colors

| Status | Variable | Fallback |
|--------|----------|----------|
| Active | `var(--vscode-testing-iconPassed)` | `#4ec9b0` |
| Waiting | `var(--vscode-editorWarning-foreground)` | `#e8a030` |
| Recent | `var(--vscode-charts-yellow)` | `#cca700` |
| Idle | `var(--vscode-descriptionForeground)` with opacity | — |

### Message Role Colors

| Role | Variable | Fallback |
|------|----------|----------|
| User | `var(--vscode-gitDecoration-modifiedResourceForeground)` | `#d4b88c` |
| Assistant | `var(--vscode-textLink-foreground)` | `#6b9eff` |

### Other Mappings

- Tool badge backgrounds: `var(--vscode-textBlockQuote-background)` (replaces `rgba(128,128,128,0.1)`)
- Borders and dividers: consistently `var(--vscode-panel-border)` everywhere (audit remaining raw rgba values)
- Scrollbar: already theme-aware, no changes

### Light Theme Audit

Several opacity values in the current CSS assume a dark background and will appear washed out in light themes. Replace opacity-based dimming with direct use of theme foreground color variables (e.g., `var(--vscode-descriptionForeground)` instead of `color: var(--foreground); opacity: 0.5`).

---

## Files Affected

| File | Changes |
|------|---------|
| `media/style.css` | Full rewrite — tree view layout, responsive breakpoints, theme variables, focus styles, tailing indicators, icon rail |
| `media/main.js` | Sidebar render rewrite (tree view), keyboard nav system, scroll-aware tailing with `conversationTail` handler, ResizeObserver, crossfade transitions, icon rail, help overlay |
| `src/agentManagerPanel.ts` | HTML template updates, `fs.FSWatcher` lifecycle (create/teardown/pause on visibility), `conversationTail` message type, targeted sidebar update messages |
| `src/claudeReader.ts` | No structural changes |
| `src/types.ts` | No structural changes |

## Risks

- **`fs.watch()` reliability:** Node's `fs.watch` is platform-dependent and can fire duplicate events. The 500ms debounce mitigates this. If unreliable on a platform, the 30s poll remains as fallback.
- **Icon rail usability:** One dot per project may still be hard to distinguish at scale. If user testing shows confusion, add single-letter project abbreviations next to dots.
- **Vim bindings conflict:** If a VS Code keybinding captures `j`/`k` before the webview, the bindings won't work. Mitigation: webview key events are handled inside the webview context, not through VS Code's keybinding system, so conflicts are unlikely.
- **Full re-read on tail events:** For very large conversation files, the full re-read on each file change could be noticeable. Mitigation: the 500ms debounce limits frequency, and JSONL files rarely exceed a few MB. If performance becomes an issue, switch to an incremental read (track byte offset, read only appended lines) as a follow-up optimization.
