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
| Field | Type | Description |
|-------|------|-------------|
| `agentId` | `string` | Filename stem with `agent-` prefix stripped |
| `slug` | `string?` | Slug from first message with `slug` |
| `firstPrompt` | `string?` | First non-meta user message (max 200 chars) |
| `firstTimestamp` | `string?` | Earliest timestamp |
| `lastTimestamp` | `string?` | Latest timestamp |
| `messageCount` | `number` | Count of user + assistant messages |
| `lastMessageRole` | `string?` | `"user"` or `"assistant"` |

### MessageBlock
Represents one logical block within a conversation message.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `'text' \| 'tool'` | Block kind |
| `content` | `string` | Text content or tool name |
| `toolUseId` | `string?` | Present when `type === 'tool'` |
| `description` | `string?` | Agent `description` input field, if present |
| `input` | `string?` | Formatted tool input (human-readable) |
| `output` | `string?` | Tool result text |
| `isError` | `boolean?` | Whether the tool result was an error |
| `preview` | `string?` | Short preview shown in collapsed tool badge |

### ConversationMessage
| Field | Type | Description |
|-------|------|-------------|
| `role` | `'user' \| 'assistant'` | Message role |
| `blocks` | `MessageBlock[]` | Ordered content blocks |
| `timestamp` | `string?` | ISO timestamp of the message |

### ManagerSettings
| Field | Type | Description |
|-------|------|-------------|
| `soundEnabled` | `boolean` | Whether to play notification sounds |
| `soundRepeatSec` | `number` | Repeat interval in seconds (0 = never) |
| `exportDestination` | `'dialog' \| 'default' \| 'cwd'` | Where to save exported files |
| `exportToolFormat` | `'compact' \| 'expanded' \| 'omit'` | How tool calls appear in exports |

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
