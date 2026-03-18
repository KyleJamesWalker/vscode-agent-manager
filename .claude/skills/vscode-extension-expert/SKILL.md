---
name: vscode-extension-expert
description: This skill provides expert-level guidance for VS Code extension development. Use when implementing new extension features, debugging extension code, designing WebView UIs, implementing Language Server Protocol features, or optimizing extension performance. Covers activation events, contribution points, VS Code API patterns, security best practices, testing strategies, state persistence, file watchers, singleton webview pattern, and publishing workflows.
---

# VS Code Extension Expert

## Overview

This skill enables expert-level VS Code extension development by providing comprehensive knowledge of the VS Code Extension API, architectural patterns, security requirements, and best practices. It should be used when creating new extensions, adding features to existing extensions, implementing WebViews, designing language support, or optimizing performance.

## When to Use This Skill

- Implementing new VS Code extension features
- Designing extension architecture and structure
- Creating WebView-based UIs with proper security
- Implementing Language Server Protocol (LSP) features
- Debugging extension activation or runtime issues
- Optimizing extension performance and startup time
- Preparing extensions for Marketplace publication

## Core Concepts

### Extension Anatomy

Every VS Code extension requires:

```
extension-name/
├── .vscode/              # Debug configurations
│   ├── launch.json
│   └── tasks.json
├── src/
│   └── extension.ts      # Main entry point
├── media/                # Webview assets (JS, CSS, vendored libs)
├── package.json          # Extension manifest (critical)
├── tsconfig.json         # TypeScript config
└── .vscodeignore         # Exclude from package
```

### Package.json Essential Fields

```json
{
  "name": "extension-name",
  "publisher": "publisher-id",
  "version": "0.0.1",
  "engines": { "vscode": "^1.85.0" },
  "main": "./out/extension.js",
  "activationEvents": [],
  "contributes": {
    "commands": [],
    "configuration": {},
    "views": {}
  },
  "extensionKind": ["workspace"]
}
```

### Extension Entry Point Pattern

```typescript
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  // Register commands, providers, listeners
  const disposable = vscode.commands.registerCommand('ext.command', () => {
    // Command implementation
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {
  // Cleanup resources
}
```

## Activation Events

Choose the most specific activation event to minimize startup impact:

| Event | Use Case | Example |
|-------|----------|---------|
| `onLanguage:<lang>` | Language-specific features | `onLanguage:python` |
| `onCommand:<command>` | Command-driven extensions | `onCommand:ext.showPanel` |
| `onView:<viewId>` | Sidebar view expansion | `onView:myTreeView` |
| `workspaceContains:<glob>` | Project-specific features | `workspaceContains:**/.eslintrc*` |
| `onFileSystem:<scheme>` | Custom file systems | `onFileSystem:sftp` |
| `onStartupFinished` | Background tasks | (prefer over `*`) |

**Critical**: Avoid using `*` as it activates on every VS Code startup.

## Contribution Points

### Commands

```json
{
  "contributes": {
    "commands": [{
      "command": "ext.doSomething",
      "title": "Do Something",
      "category": "My Extension",
      "icon": "$(symbol-method)"
    }],
    "keybindings": [{
      "command": "ext.doSomething",
      "key": "ctrl+shift+a",
      "mac": "cmd+shift+a"
    }]
  }
}
```

### Configuration

```json
{
  "contributes": {
    "configuration": {
      "title": "My Extension",
      "properties": {
        "myExtension.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Enable the extension"
        }
      }
    }
  }
}
```

### Views (Tree Views)

```json
{
  "contributes": {
    "views": {
      "explorer": [{
        "id": "myTreeView",
        "name": "My View"
      }]
    },
    "viewsContainers": {
      "activitybar": [{
        "id": "myContainer",
        "title": "My Extension",
        "icon": "resources/icon.svg"
      }]
    }
  }
}
```

## VS Code API Namespaces

### window API

```typescript
// Show messages
vscode.window.showInformationMessage('Hello!');
vscode.window.showErrorMessage('Error occurred');

// Quick picks
const item = await vscode.window.showQuickPick(['Option 1', 'Option 2']);

// Input boxes
const input = await vscode.window.showInputBox({ prompt: 'Enter value' });

// Active editor
const editor = vscode.window.activeTextEditor;
```

### workspace API

```typescript
// Read configuration
const config = vscode.workspace.getConfiguration('myExtension');
const value = config.get<boolean>('enabled');

// Watch files (VS Code managed watcher — integrates with disposables)
const watcher = vscode.workspace.createFileSystemWatcher('**/*.ts');
watcher.onDidChange(uri => { /* handle change */ });

// Open documents
const doc = await vscode.workspace.openTextDocument(uri);
```

### commands API

```typescript
// Register
const disposable = vscode.commands.registerCommand('ext.cmd', (arg) => {
  // Implementation
});

// Execute
await vscode.commands.executeCommand('ext.cmd', argument);
```

## WebView Development

### Security Requirements (Critical)

1. **Content Security Policy (CSP)** — Always implement strict CSP. Never allow `unsafe-eval` or wildcard sources:

```typescript
function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = getNonce();
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'style.css'));

  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="
      default-src 'none';
      style-src ${webview.cspSource};
      script-src 'nonce-${nonce}';
      img-src ${webview.cspSource} data:;
    ">
    <link href="${styleUri}" rel="stylesheet">
    <title>My Extension</title>
  </head>
  <body>
    <div id="app"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
  </html>`;
}
```

2. **Nonce generation** — Generate a fresh 32-character random nonce per page load:

```typescript
function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length))
  ).join('');
}
```

3. **Asset URIs** — Always convert extension assets to webview URIs; restrict `localResourceRoots` to required directories only:

```typescript
const panel = vscode.window.createWebviewPanel('myPanel', 'My Panel', vscode.ViewColumn.One, {
  enableScripts: true,
  localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
});
```

4. **Input Sanitization** — Sanitize all user-generated content before injecting into HTML:

```typescript
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
```

### Singleton Webview Pattern

For panels that should have only one instance, use a static factory with `createOrShow()`:

```typescript
export class MyPanel {
  public static currentPanel: MyPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // Reveal existing panel if it exists
    if (MyPanel.currentPanel) {
      MyPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'myPanel',
      'My Panel',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,  // Preserve JS state when panel is hidden
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
      }
    );

    MyPanel.currentPanel = new MyPanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._panel.webview.html = getWebviewContent(panel.webview, extensionUri);

    // Clean up when panel is closed
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Defer initial data load to allow webview JS to initialize
    setTimeout(() => this._postInitialData(), 100);
  }

  public dispose(): void {
    MyPanel.currentPanel = undefined;
    this._panel.dispose();
    // Pop-and-dispose pattern ensures full cleanup
    while (this._disposables.length) {
      this._disposables.pop()?.dispose();
    }
  }
}
```

**When to use `retainContextWhenHidden: true`**: Set this when your webview has significant client-side state (scroll position, rendered content, UI state) that is expensive to recreate. It trades memory for a seamless user experience when switching tabs.

### Message Passing Pattern

Define typed message contracts for both directions:

```typescript
// Shared types (or duplicate in extension and webview)
type ToWebview =
  | { type: 'update'; data: MyData }
  | { type: 'loadComplete' };

type FromWebview =
  | { type: 'refresh' }
  | { type: 'action'; payload: string };

// Extension → WebView
panel.webview.postMessage({ type: 'update', data: payload } satisfies ToWebview);

// WebView → Extension
panel.webview.onDidReceiveMessage((message: FromWebview) => {
  switch (message.type) {
    case 'refresh':
      handleRefresh();
      break;
    case 'action':
      handleAction(message.payload);
      break;
  }
}, null, this._disposables);

// In WebView JavaScript (IIFE pattern for scoping)
(function () {
  const vscode = acquireVsCodeApi();

  window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
      case 'update':
        render(message.data);
        break;
    }
  });

  document.getElementById('refresh-btn').addEventListener('click', () => {
    vscode.postMessage({ type: 'refresh' });
  });
})();
```

### Webview Visibility Management

Pause expensive operations (timers, file watchers) when the webview is hidden to save CPU:

```typescript
private _refreshTimer: NodeJS.Timeout | undefined;
private _fileWatcher: fs.FSWatcher | undefined;

private constructor(panel: vscode.WebviewPanel, ...) {
  // ...

  this._panel.onDidChangeViewState(e => {
    if (e.webviewPanel.visible) {
      this._startRefresh();
      this._resumeWatcher();
    } else {
      this._stopRefresh();
      this._pauseWatcher();
    }
  }, null, this._disposables);
}

private _startRefresh(): void {
  this._stopRefresh();
  this._refreshTimer = setInterval(() => this._refresh(), 30_000);
}

private _stopRefresh(): void {
  if (this._refreshTimer) {
    clearInterval(this._refreshTimer);
    this._refreshTimer = undefined;
  }
}
```

### File Watching with Debounce

Use `fs.watch()` for fine-grained file watching with debounce to avoid rapid re-reads:

```typescript
import * as fs from 'fs';

private _watcher: fs.FSWatcher | undefined;
private _debounceTimer: NodeJS.Timeout | undefined;
private _watchedPath: string | undefined;

private _watchFile(filePath: string): void {
  this._teardownWatcher();
  this._watchedPath = filePath;
  try {
    this._watcher = fs.watch(filePath, () => {
      if (this._debounceTimer) { clearTimeout(this._debounceTimer); }
      this._debounceTimer = setTimeout(() => this._onFileChanged(), 500);
    });
  } catch {
    // File may not exist yet; ignore
  }
}

private _teardownWatcher(): void {
  this._watcher?.close();
  this._watcher = undefined;
  if (this._debounceTimer) {
    clearTimeout(this._debounceTimer);
    this._debounceTimer = undefined;
  }
}
```

**`fs.watch()` vs `workspace.createFileSystemWatcher()`**: Use `fs.watch()` for a specific known file path (e.g., tailing a log). Use `vscode.workspace.createFileSystemWatcher()` for glob patterns across the workspace — it integrates with disposables automatically.

### State Persistence Strategies

Choose the right persistence layer for your state:

| Layer | API | Scope | Survives |
|-------|-----|-------|---------|
| In-memory | class fields | Panel instance | Panel hide/show (with `retainContextWhenHidden`) |
| Webview state | `vscode.getState()` / `vscode.setState()` | Webview JS | Panel hide/show (without retain); lost on restart |
| Workspace state | `context.workspaceState` | Workspace | VS Code restart; per-workspace |
| Global state | `context.globalState` | All workspaces | VS Code restart; shared across workspaces |
| Secret storage | `context.secrets` | All workspaces | VS Code restart; encrypted |

```typescript
// Extension-side: persist settings across restarts (global)
context.globalState.update('myExtension.settings', settings);
const saved = context.globalState.get<MySettings>('myExtension.settings') ?? defaultSettings;

// Webview-side: persist UI state across hide/show cycles
const state = vscode.getState() || { filter: '', selected: null };
vscode.setState({ ...state, filter: newFilter });

// Never store secrets in globalState — use SecretStorage
await context.secrets.store('apiKey', value);
const apiKey = await context.secrets.get('apiKey');
```

### Vendoring Third-Party Libraries

For webview client code, vendor (inline) third-party libraries rather than bundling when:
- The library has a stable, minified standalone build
- You want zero build-time dependencies
- The extension has no other bundling needs

Place vendored files in `media/` and load them with a nonce:

```html
<script nonce="${nonce}" src="${vendoredLibUri}"></script>
<script nonce="${nonce}" src="${mainScriptUri}"></script>
```

This avoids introducing a bundler just for webview assets. For extensions targeting VS Code Web or with many dependencies, prefer esbuild bundling instead.

### No-Bundler Development (tsc Only)

For simple extensions with no runtime dependencies, skip the bundler:

```json
// tsconfig.json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2021",
    "outDir": "./out",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["ES2021"]
  },
  "exclude": ["node_modules", ".vscode-test"]
}
```

```json
// package.json scripts
{
  "scripts": {
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./"
  }
}
```

```json
// .vscode/tasks.json — compile before launch
{
  "version": "2.0.0",
  "tasks": [{
    "type": "npm",
    "script": "watch",
    "problemMatcher": "$tsc-watch",
    "isBackground": true,
    "presentation": { "reveal": "never" },
    "group": { "kind": "build", "isDefault": true }
  }]
}
```

**When to add esbuild**: If you need to target VS Code Web, have transitive npm dependencies to bundle, or want tree-shaking and minification for a published extension.

## Language Server Protocol (LSP)

### Architecture

```
┌─────────────────────┐     ┌─────────────────────┐
│  Language Client    │────│  Language Server    │
│  (VS Code Extension)│ LSP │  (Separate Process) │
│  vscode-languageclient    │  vscode-languageserver
└─────────────────────┘     └─────────────────────┘
```

### Client Implementation

```typescript
import { LanguageClient, LanguageClientOptions, ServerOptions } from 'vscode-languageclient/node';

const serverOptions: ServerOptions = {
  run: { module: serverPath, transport: TransportKind.ipc },
  debug: { module: serverPath, transport: TransportKind.ipc }
};

const clientOptions: LanguageClientOptions = {
  documentSelector: [{ scheme: 'file', language: 'mylang' }],
  synchronize: {
    fileEvents: vscode.workspace.createFileSystemWatcher('**/*.mylang')
  }
};

const client = new LanguageClient('mylang', 'My Language', serverOptions, clientOptions);
client.start();
```

### Server Implementation

```typescript
import { createConnection, TextDocuments, ProposedFeatures } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

connection.onInitialize((params) => {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: { resolveProvider: true },
      hoverProvider: true
    }
  };
});

connection.onCompletion((params) => {
  return [
    { label: 'suggestion1', kind: CompletionItemKind.Text }
  ];
});

documents.listen(connection);
connection.listen();
```

## Tree View Implementation

```typescript
class MyTreeDataProvider implements vscode.TreeDataProvider<MyItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<MyItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: MyItem): vscode.TreeItem {
    return {
      label: element.name,
      collapsibleState: element.children ?
        vscode.TreeItemCollapsibleState.Collapsed :
        vscode.TreeItemCollapsibleState.None,
      command: {
        command: 'ext.selectItem',
        title: 'Select',
        arguments: [element]
      }
    };
  }

  getChildren(element?: MyItem): Thenable<MyItem[]> {
    if (!element) {
      return Promise.resolve(this.getRootItems());
    }
    return Promise.resolve(element.children || []);
  }
}

// Register
const provider = new MyTreeDataProvider();
vscode.window.registerTreeDataProvider('myTreeView', provider);
```

## Performance Best Practices

### Lazy Loading

```typescript
// Delay expensive imports
let heavyModule: typeof import('./heavyModule') | undefined;

async function getHeavyModule() {
  if (!heavyModule) {
    heavyModule = await import('./heavyModule');
  }
  return heavyModule;
}
```

### Bundling (Required for VS Code Web)

Use esbuild for fast bundling:

```javascript
// esbuild.config.js
const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['./src/extension.ts'],
  bundle: true,
  outfile: './out/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  minify: process.env.NODE_ENV === 'production',
  sourcemap: true
});
```

### Resource Cleanup

Use the pop-and-dispose pattern for panels that manage their own disposables array:

```typescript
// In extension activate() — simple case, push to context.subscriptions
export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand(...),
    vscode.window.registerTreeDataProvider(...),
    watcher,
    client
  );
}

// In panel dispose() — pop-and-dispose for owned disposables
public dispose(): void {
  MyPanel.currentPanel = undefined;
  this._panel.dispose();
  while (this._disposables.length) {
    this._disposables.pop()?.dispose();
  }
}

export function deactivate() {
  // Explicit cleanup for async resources
  return client?.stop();
}
```

### Synchronous vs Async File I/O

Use synchronous `fs.readFileSync` when:
- Files are small (< a few hundred KB)
- Reads are infrequent (not in a hot path)
- Simplicity is more important than concurrency

Use async (`fs.promises.readFile`) when:
- Files may be large
- Reading many files in parallel
- Called from an `async` function already

## Testing Strategy

### Integration Tests with @vscode/test-cli

```typescript
// .vscode-test.js
const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig({
  files: 'out/test/**/*.test.js',
  version: 'stable',
  workspaceFolder: './test-fixtures',
  mocha: {
    timeout: 20000  // Note: @vscode/test-cli uses Mocha for VS Code extension host tests
  }
});
```

### Test Structure

```typescript
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
  vscode.window.showInformationMessage('Start tests.');

  test('Command registration', async () => {
    const commands = await vscode.commands.getCommands();
    assert.ok(commands.includes('ext.myCommand'));
  });

  test('Configuration access', () => {
    const config = vscode.workspace.getConfiguration('myExtension');
    assert.strictEqual(config.get('enabled'), true);
  });
});
```

## Common Pitfalls and Solutions

### Extension Not Activating

**Cause**: Activation events don't match user actions
**Solution**: Verify `activationEvents` in package.json match actual triggers

### WebView Security Errors

**Cause**: Missing or incorrect CSP
**Solution**: Always include strict Content-Security-Policy meta tag with nonce

### Memory Leaks

**Cause**: Untracked event listeners or disposables
**Solution**: Add all disposables to `context.subscriptions` or the panel's `_disposables` array; use the pop-and-dispose pattern in panel cleanup

### Slow Startup

**Cause**: Synchronous heavy operations in `activate()`
**Solution**: Use lazy loading and defer non-critical initialization; use `onStartupFinished` instead of `*`

### Commands Not in Palette

**Cause**: Missing `contributes.commands` declaration
**Solution**: Ensure command is declared in package.json AND registered with `registerCommand`

### Webview JS Not Initialized When First Message Arrives

**Cause**: Extension posts initial data before webview JS has loaded and registered its message listener
**Solution**: Defer the first `postMessage` call by ~100ms after setting `panel.webview.html`

```typescript
this._panel.webview.html = getWebviewContent(panel.webview, extensionUri);
setTimeout(() => this._postUpdate(), 100);
```

### Panel State Lost on Tab Switch

**Cause**: `retainContextWhenHidden` not set; webview is destroyed and recreated on each reveal
**Solution**: Set `retainContextWhenHidden: true` in `WebviewOptions`; or restore state from webview `getState()` on re-render

### File Watcher Firing Continuously

**Cause**: No debounce on file change callback
**Solution**: Add a debounce timer (300–500ms) before acting on file changes

## Security Checklist

- [ ] Implement strict Content Security Policy for WebViews (no `unsafe-eval`, no wildcard sources)
- [ ] Generate a fresh nonce per page load (32+ chars)
- [ ] Sanitize all user input before rendering in HTML
- [ ] Use HTTPS for any external resources (or restrict to `'none'`)
- [ ] Validate all messages from WebViews before acting on them
- [ ] Restrict `localResourceRoots` to only required directories
- [ ] Use `webview.asWebviewUri()` for all asset references — never use raw file paths
- [ ] Don't store secrets in `globalState` or settings (use `SecretStorage`)
- [ ] Validate `event.origin` if using web messaging beyond the VS Code webview

## Publishing Checklist

- [ ] Unique name and publisher combination
- [ ] PNG icon (128x128 minimum)
- [ ] Complete README.md with features and screenshots
- [ ] CHANGELOG.md with version history
- [ ] LICENSE file
- [ ] Semantic versioning
- [ ] .vscodeignore excluding dev files, `src/`, `node_modules/`, `*.map`
- [ ] Test on Windows, macOS, and Linux
- [ ] Bundle for web compatibility if needed

## Resources

For detailed reference documentation, see:
- `references/api-reference.md` - Complete VS Code API documentation
- `references/webview-security.md` - WebView security guidelines
- `references/lsp-guide.md` - Language Server Protocol implementation guide

For working examples, reference the official samples:
- https://github.com/microsoft/vscode-extension-samples
