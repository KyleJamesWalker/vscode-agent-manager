---
title: Add Test Infrastructure
date: 2026-03-18
status: approved
---

# Add Test Infrastructure

## Overview

Add a test suite to the extension using Jest for unit tests and `@vscode/test-electron` + Mocha for integration tests. No test script currently exists in `package.json`. This spec covers tooling setup, directory structure, unit coverage targets, and the one integration test.

## Directory Structure

```
src/test/
  unit/
    claudeReader.test.ts   ← Jest
    exporter.test.ts       ← Jest
  integration/
    suite/
      extension.test.ts    ← Mocha (runs in Extension Development Host)
      index.ts             ← Mocha suite entry point
    runTest.ts             ← launches @vscode/test-electron

jest.config.js
```

## Tooling

### New dev dependencies

| Package | Purpose |
|---|---|
| `jest` | Unit test runner |
| `ts-jest` | TypeScript transform for Jest |
| `@types/jest` | Jest type declarations |
| `@vscode/test-electron` | Launches Extension Development Host for integration |
| `mocha` | Test framework used inside the Extension Host |
| `@types/mocha` | Mocha type declarations |

### package.json scripts

```json
"test":             "npm run test:unit && npm run test:integration",
"test:unit":        "jest",
"test:integration": "node ./out/test/integration/runTest.js"
```

### jest.config.js

Configured with `ts-jest` preset, `node` test environment, and a `testMatch` pointing at `src/test/unit/**/*.test.ts`.

### tsconfig.json

Include `src/test/**` so integration test files compile to `out/test/`.

## Unit Tests

### claudeReader.test.ts

Mocks the `fs` module (jest module mock). Feeds fixture JSONL strings via `fs.readFileSync` mock. Asserts on return values of the two public exports.

**`readConversation`**
- String `content` field parsed as text block
- Array `content` field: text items extracted, tool_use + tool_result paired by `tool_use_id`
- `isMeta: true` messages filtered out
- Empty and malformed JSONL lines skipped without throwing

**`readClaudeProjects`**
- Sessions with `lastTimestamp` older than 30 days are excluded
- Projects sorted descending by `lastActivity`
- `decodeDirName` fallback used when session has no `cwd`

### exporter.test.ts

Mocks `fs.writeFileSync` to capture written content. Asserts on Markdown output from `exportConversation`.

**`exportConversation`**
- `omit` format: no tool blocks in output
- `compact` format: tool blocks rendered as `> **ToolName** preview`
- `expanded` format: tool blocks include input and output sections
- Agent sub-files written with correct back-link to root file
- Agent with zero messages counted in `skippedAgents`, not written

### Exported helpers

The following private helpers will be exported to enable direct unit testing:

| Module | Function | Why worth isolating |
|---|---|---|
| `exporter.ts` | `deduplicateLabels` | Collision logic when agents share a slug |
| `exporter.ts` | `renderToolBlock` | Three distinct format modes |
| `exporter.ts` | `formatToolInput` | Per-tool switch dispatch |
| `exporter.ts` | `generateToolPreview` | Per-tool switch dispatch |
| `claudeReader.ts` | `decodeDirName` | Path encoding/decoding logic |

## Integration Test

One suite running inside the Extension Development Host via `@vscode/test-electron`.

**`extension.test.ts`** — Suite: "Extension activation"

1. **Command is registered** — after activating the extension, `vscode.commands.getCommands()` includes `claudeAgentManager.openPanel`
2. **Command opens a webview panel** — executing the command and waiting one tick confirms a webview tab is visible in `vscode.window.tabGroups`

`runTest.ts` boots a temporary empty workspace, points at the compiled `suite/index.ts`.

## Acceptance Criteria

1. `npm run test:unit` runs and passes with no VS Code installation required
2. `npm run test:integration` runs in the Extension Development Host and passes
3. `npm test` runs both suites sequentially
4. All new test files compile cleanly under the existing `tsconfig.json`
5. Exported helpers from `claudeReader.ts` and `exporter.ts` remain backward-compatible (additive change only)
