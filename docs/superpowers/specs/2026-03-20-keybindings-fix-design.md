# Keyboard Navigation Fixes & Enhancements

Branch: `fix-keybindings`
Files changed: `media/main.js`, `media/style.css`

---

## Bug 1: Vim Keybindings Dead on First Open

### Problem

Vim-style keybindings (`j`, `k`, `h`, `l`) do nothing when the webview first opens. Only `?` (help overlay) and `Esc` (closes help) work. Users have no discoverable path to keyboard navigation.

### Root Cause

`sidebarHasFocus` initialised to `false`. A guard blocked all vim bindings until sidebar focus was explicitly activated:

```javascript
if (!sidebarHasFocus && e.key !== 'Tab' && e.key !== '?') return;
```

The only non-guarded entry point was `Tab`, which appears only deep in the `?` help overlay — not surfaced anywhere as a prerequisite.

### Fix

- Initialise `let sidebarHasFocus = true;`
- Remove the guard entirely

### Acceptance Criteria

- AC-1: Opening the webview and pressing `j` immediately moves focus to the first sidebar item
- AC-2: `k` moves focus up
- AC-3: `h` collapses a project or moves to parent
- AC-4: `l` expands a project or enters first child
- AC-5: `?` opens the help overlay
- AC-6: `Esc` inside the help overlay closes it

---

## Bug 2: Keyboard Navigation Ignores Mouse Selection

### Problem

After clicking a sidebar item or project header with the mouse, pressing `j`/`k` restarts navigation from the top of the list instead of continuing from the clicked position.

### Root Cause

`focusedIndex` is never updated on mouse interaction. It remains `-1` after any click, so `moveFocus(1)` always resolves to index `0`. Two code paths were affected:

- **Session/agent clicks** — handled in `selectConversation`, which updated visual `.selected` state but never set `focusedIndex`
- **Project header clicks** — handled in the `.tree-project-header` click listener in `bindSidebarEvents`, same omission

### Fix

After each mouse click, find the clicked element's position in `getFlatNavigationList()` and assign `focusedIndex` directly (not via `setFocusedItem`, to avoid adding `.focused` styling on top of `.selected`):

```javascript
const items = getFlatNavigationList();
const idx = items.findIndex((item) => item.el === rowEl);
if (idx >= 0) focusedIndex = idx;
```

Applied in both `selectConversation` (for sessions/agents) and the project header click handler.

### Acceptance Criteria

- AC-7: After clicking the 5th sidebar item with the mouse, pressing `j` moves to the 6th item
- AC-8: After clicking the 5th sidebar item with the mouse, pressing `k` moves to the 4th item
- AC-9: After clicking a project header to expand/collapse it, `j`/`k` continues from that project
- AC-10: Mouse clicks do not add a `.focused` outline — only `.selected` styling is applied

---

## Bug 3: Enter Does Not Exit Search

### Problem

Pressing `/` correctly focuses the search input. `Escape` exits it and returns to sidebar navigation. `Enter` (the natural "confirm and go back") does nothing — focus stays trapped in the input.

### Root Cause

The search keydown block only handled `Escape`:

```javascript
if (document.activeElement === searchInput) {
  if (e.key === 'Escape') { searchInput.blur(); sidebarHasFocus = true; e.preventDefault(); }
  return;
}
```

`Enter` hit the `return` and was swallowed with no effect.

### Fix

```javascript
if (document.activeElement === searchInput) {
  if (e.key === 'Escape' || e.key === 'Enter') {
    searchInput.blur();
    sidebarHasFocus = true;
    e.preventDefault();
  }
  return;
}
```

### Acceptance Criteria

- AC-11: Pressing `Enter` in the search input blurs it and returns `j`/`k` navigation to the sidebar
- AC-12: Pressing `Escape` from search still works (existing behaviour preserved)

---

## Bug 4: / Does Not Select Existing Search Text

### Problem

Pressing `/` to open search when text already exists forces the user to backspace before typing a new query. The cursor lands at the end of the existing text.

### Root Cause

The `/` handler called only `searchInput.focus()` — no selection of existing content.

### Fix

```javascript
case '/':
  e.preventDefault(); searchInput.focus(); searchInput.select(); sidebarHasFocus = false; break;
```

### Acceptance Criteria

- AC-13: Pressing `/` when the search input is empty focuses it (no change in behaviour)
- AC-14: Pressing `/` when the search input contains text selects all of it, so typing immediately replaces it

---

## Feature: Conversation Panel Vim Navigation

### Design

Extend `sidebarHasFocus` into a two-panel focus model. When conversation focus is active, `j`/`k`/`gg`/`G` scroll the conversation instead of moving the sidebar selection. `h` returns to sidebar focus. `l` on a session or agent opens the conversation and automatically shifts focus right.

A subtle border ring on `#conversation-container` (`conv-focused` CSS class) indicates which panel is active, consistent with the existing sidebar `.focused` dotted outline.

### Key Behaviour by Panel Focus

| Key | Sidebar focus | Conversation focus |
|-----|---------------|--------------------|
| `j` | Move selection down | Scroll conversation down 80px |
| `k` | Move selection up | Scroll conversation up 80px |
| `h` | Collapse / go to parent | Return focus to sidebar (remove ring) |
| `l` (on project) | Expand / move into first child | — |
| `l` (on session/agent) | Open conversation + shift focus right | — |
| `gg` | Jump to first sidebar item | Scroll conversation to top |
| `G` | Jump to last sidebar item | Scroll conversation to bottom |
| `Tab` | Switch to conversation focus | Switch to sidebar focus |
| `Escape` | Deselect session, return to sidebar | Return to sidebar |

### CSS

```css
#conversation-container.conv-focused {
  outline: 1px solid var(--vscode-focusBorder, #007fd4);
  outline-offset: -2px;
}
```

### Help Overlay Updates

- `h`: "Collapse / go to parent / return to sidebar"
- `l`: "Expand / open conversation (shifts focus right)"

### Acceptance Criteria

- AC-15: Pressing `l` on a focused session/agent opens the conversation and shifts focus to the conversation panel (ring appears)
- AC-16: With conversation focus, `j` scrolls down 80px and `k` scrolls up 80px
- AC-17: With conversation focus, `gg` scrolls to top and `G` scrolls to bottom
- AC-18: With conversation focus, `h` returns focus to sidebar (ring disappears, `j`/`k` navigate sidebar again)
- AC-19: `Tab` toggles between sidebar and conversation focus in both directions
- AC-20: `Escape` always removes conversation ring and returns to sidebar focus
- AC-21: `l` on a project still expands it (or moves into first child if already expanded)
- AC-22: Clicking a session still opens the conversation without breaking keyboard navigation

---

## Full Acceptance Criteria Index

| ID | Description |
|----|-------------|
| AC-1 | `j` works immediately on webview open |
| AC-2 | `k` moves focus up |
| AC-3 | `h` collapses / goes to parent |
| AC-4 | `l` expands / enters first child |
| AC-5 | `?` opens help overlay |
| AC-6 | `Esc` in help overlay closes it |
| AC-7 | Mouse click on item → `j` moves to next item |
| AC-8 | Mouse click on item → `k` moves to previous item |
| AC-9 | Mouse click on project header → `j`/`k` continues from that project |
| AC-10 | Mouse clicks apply `.selected` only, not `.focused` |
| AC-11 | `Enter` exits search and returns sidebar navigation |
| AC-12 | `Escape` exits search and returns sidebar navigation |
| AC-13 | `/` on empty search focuses input |
| AC-14 | `/` on non-empty search selects all existing text |
| AC-15 | `l` on session/agent opens conversation and shifts focus right |
| AC-16 | Conversation focus: `j`/`k` scroll ±80px |
| AC-17 | Conversation focus: `gg`/`G` scroll to top/bottom |
| AC-18 | Conversation focus: `h` returns to sidebar |
| AC-19 | `Tab` toggles panel focus in both directions |
| AC-20 | `Escape` always returns to sidebar focus |
| AC-21 | `l` on project still expands/enters |
| AC-22 | Mouse session click still opens conversation |
