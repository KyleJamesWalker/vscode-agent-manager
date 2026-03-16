# Webview UI

## File Locations

- **HTML template**: inline in `src/agentManagerPanel.ts` (`_getHtml()` method)
- **JavaScript**: `media/main.js` — all client-side logic (IIFE, no build step)
- **CSS**: `media/style.css`

## Communication Protocol

Extension → Webview:
```json
{ "command": "update", "projects": [...], "pinnedKeys": [...], "settings": {...} }
```

Webview → Extension:
```json
{ "command": "refresh" }
{ "command": "openFolder", "path": "/abs/path", "newWindow": true|false }
{ "command": "togglePin", "key": "project-dir-name" }
{ "command": "updateSettings", "settings": { "soundEnabled": bool, "soundRepeatSec": number } }
```

## UI Components

### Toolbar
- Logo + title
- Last-updated timestamp
- Refresh button → sends `refresh` message
- Settings gear → toggles notification settings dropdown

### Search Bar
- Text filter on `displayName` and `path`
- State persisted via `vscode.getState()`

### Filter Bar
Chips: All | Active | Waiting | Pinned — each shows a count badge when > 0.

### Stats Bar
Displays: project count, session count, agent count, active count (with pulse dot), waiting count.

### Project Cards
- Collapsible (click header to toggle)
- Shows: status dot, name, badges (waiting/agents/sessions), time ago
- Actions: Pin, Open, Open in New Window
- Lists up to 6 recent sessions with overflow indicator

### Session Rows
- Expandable (click to show subagents)
- Shows: status dot, first prompt, time ago, waiting label, git branch, message count, agent count

### Subagent Rows
- Shows: status dot, slug or ID, waiting label, task prompt, time ago

## Status Indicators

| Class | Condition | Visual |
|-------|-----------|--------|
| `active` | < 5 min, last msg from user | Green dot |
| `waiting` | < 5 min, last msg from assistant | Orange dot + label |
| `recent` | 5 min – 2 hours | Dimmer dot |
| `idle` | > 2 hours | Gray dot |

## Sound Notifications

- Web Audio API two-note chime (880Hz → 1175Hz)
- Triggers on NEW waiting items (not already in `previousWaitingIds`)
- Optional repeat interval (30s / 1m / 2m / 5m)
- Settings persisted via extension `globalState`
