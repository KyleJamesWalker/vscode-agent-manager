# Data Model

## Source Data

Claude Code stores session data as JSONL files in `~/.claude/projects/`. Directory structure:

```
~/.claude/projects/
  -Users-kyle-walker-work-my-project/     ← encoded project path
    abc123.jsonl                            ← session file
    abc123/                                 ← session directory (optional)
      subagents/
        agent-xyz789.jsonl                  ← subagent file
```

The project directory name is the filesystem path with `/` replaced by `-`.

## TypeScript Interfaces (src/types.ts)

### ClaudeProject
| Field | Type | Description |
|-------|------|-------------|
| `key` | `string` | Directory name under `~/.claude/projects/` |
| `path` | `string` | Decoded filesystem path to the project |
| `displayName` | `string` | `path.basename(path)` |
| `sessions` | `ClaudeSession[]` | Sorted by `lastTimestamp` descending |
| `lastActivity` | `string?` | Most recent session's `lastTimestamp` |

### ClaudeSession
| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | `string` | JSONL filename without extension |
| `cwd` | `string?` | Working directory from first message with `cwd` |
| `gitBranch` | `string?` | Git branch from first message with `gitBranch` |
| `firstPrompt` | `string?` | First non-meta user message (max 300 chars) |
| `firstTimestamp` | `string?` | Earliest timestamp in session |
| `lastTimestamp` | `string?` | Latest timestamp in session |
| `messageCount` | `number` | Count of user + assistant messages |
| `subAgents` | `SubAgent[]` | Parsed from `subagents/` directory |
| `lastMessageRole` | `string?` | `"user"` or `"assistant"` — used for waiting detection |

### SubAgent
Same shape as `ClaudeSession` but with `agentId` and `slug` instead of `sessionId`/`cwd`/`gitBranch`/`subAgents`.

## JSONL Message Format (RawMessage)

Each line in a JSONL file is a JSON object with:
- `type`: `"user"` | `"assistant"` | other
- `sessionId?`, `cwd?`, `gitBranch?`, `timestamp?`
- `message?.content`: `string` or `Array<{type, text?}>`
- `agentId?`, `slug?`, `isMeta?`

## Filtering Logic

- **Active**: `lastActivity` within 5 minutes
- **Waiting**: any session/subagent whose `lastMessageRole === "assistant"` and `lastTimestamp` within 5 minutes
- **Session age cutoff**: sessions older than 30 days (`MAX_SESSION_AGE_DAYS`) are excluded
