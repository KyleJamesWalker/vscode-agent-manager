import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { readClaudeProjects, readConversation } from './claudeReader';
import { ManagerSettings, ClaudeProject, ClaudeSession } from './types';
import { exportConversation } from './exporter';

const DEFAULT_SETTINGS: ManagerSettings = {
  soundEnabled: false,
  soundRepeatSec: 0,
  exportDestination: 'dialog',
  exportToolFormat: 'compact',
};

export class AgentManagerPanel {
  public static currentPanel: AgentManagerPanel | undefined;
  private static readonly viewType = 'claudeAgentManager';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _context: vscode.ExtensionContext;
  private _disposables: vscode.Disposable[] = [];
  private _refreshTimer: ReturnType<typeof setInterval> | undefined;
  private _projects: ClaudeProject[] = [];
  private _fileWatcher: fs.FSWatcher | undefined;
  private _watchDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  private _watchedProjectKey: string | undefined;
  private _watchedSessionId: string | undefined;
  private _watchedAgentId: string | undefined;

  public static createOrShow(context: vscode.ExtensionContext): void {
    const column =
      vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (AgentManagerPanel.currentPanel) {
      AgentManagerPanel.currentPanel._panel.reveal(column);
      AgentManagerPanel.currentPanel._sendUpdate();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      AgentManagerPanel.viewType,
      'Claude Agent Manager',
      column,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
        retainContextWhenHidden: true,
      }
    );

    AgentManagerPanel.currentPanel = new AgentManagerPanel(panel, context);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext
  ) {
    this._panel = panel;
    this._context = context;

    this._panel.webview.html = this._getHtml(this._panel.webview);

    // Send initial data after a tick so the webview JS has loaded
    setTimeout(() => this._sendUpdate(), 100);

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.onDidChangeViewState(
      (e) => {
        if (e.webviewPanel.visible) {
          this._sendUpdate();
          // Resume watcher if we had one paused
          const pk = this._watchedProjectKey;
          const sid = this._watchedSessionId;
          const aid = this._watchedAgentId;
          if (pk && sid) {
            this._setupFileWatcher(pk, sid, aid);
          }
        } else {
          // Pause watcher but keep IDs for resume
          this._pauseFileWatcher();
        }
      },
      null,
      this._disposables
    );

    this._panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case 'openFolder':
            if (message.path) {
              this._openFolder(message.path, message.newWindow ?? false);
            }
            break;
          case 'refresh':
            this._sendUpdate();
            break;
          case 'togglePin':
            if (message.key) { this._togglePin(message.key); }
            break;
          case 'updateSettings':
            if (message.settings) { this._updateSettings(message.settings); }
            break;
          case 'loadConversation':
            if (message.projectKey && message.sessionId) {
              const messages = readConversation(
                message.projectKey,
                message.sessionId,
                message.agentId
              );
              this._panel.webview.postMessage({
                command: 'conversation',
                messages,
                sessionId: message.sessionId,
                agentId: message.agentId,
              });
              this._setupFileWatcher(message.projectKey, message.sessionId, message.agentId);
            }
            break;
          case 'exportChat':
            if (message.projectKey && message.sessionId) {
              this._handleExportChat(message.projectKey, message.sessionId);
            }
            break;
        }
      },
      null,
      this._disposables
    );

    // Auto-refresh every 30 seconds when visible
    this._refreshTimer = setInterval(() => {
      if (this._panel.visible) { this._sendUpdate(); }
    }, 30000);
  }

  private _openFolder(folderPath: string, newWindow: boolean): void {
    vscode.commands.executeCommand(
      'vscode.openFolder',
      vscode.Uri.file(folderPath),
      { forceNewWindow: newWindow }
    );
  }

  private _getPinnedKeys(): string[] {
    return this._context.globalState.get<string[]>('pinnedProjectKeys', []);
  }

  private _getSettings(): ManagerSettings {
    return this._context.globalState.get<ManagerSettings>('managerSettings', DEFAULT_SETTINGS);
  }

  private _togglePin(key: string): void {
    const pinned = new Set(this._getPinnedKeys());
    if (pinned.has(key)) {
      pinned.delete(key);
    } else {
      pinned.add(key);
    }
    this._context.globalState.update('pinnedProjectKeys', [...pinned]);
    this._sendUpdate();
  }

  private _updateSettings(settings: ManagerSettings): void {
    this._context.globalState.update('managerSettings', settings);
  }

  private _sendUpdate(): void {
    const projects = readClaudeProjects();
    this._projects = projects;
    const pinnedKeys = this._getPinnedKeys();
    const settings = this._getSettings();
    this._panel.webview.postMessage({ command: 'update', projects, pinnedKeys, settings });
  }

  private _setupFileWatcher(projectKey: string, sessionId: string, agentId?: string): void {
    this._teardownFileWatcher();

    const projectsDir = path.join(os.homedir(), '.claude', 'projects');
    const filePath = agentId
      ? path.join(projectsDir, projectKey, sessionId, 'subagents', `agent-${agentId}.jsonl`)
      : path.join(projectsDir, projectKey, `${sessionId}.jsonl`);

    if (!fs.existsSync(filePath)) return;

    this._watchedProjectKey = projectKey;
    this._watchedSessionId = sessionId;
    this._watchedAgentId = agentId;

    try {
      this._fileWatcher = fs.watch(filePath, () => {
        if (this._watchDebounceTimer) { clearTimeout(this._watchDebounceTimer); }
        this._watchDebounceTimer = setTimeout(() => {
          this._sendConversationTail();
        }, 500);
      });
    } catch {
      // fs.watch unavailable — 30s poll is the fallback
    }
  }

  /** Close the watcher but preserve watched IDs (for pause/resume on visibility). */
  private _pauseFileWatcher(): void {
    if (this._fileWatcher) {
      this._fileWatcher.close();
      this._fileWatcher = undefined;
    }
    if (this._watchDebounceTimer) {
      clearTimeout(this._watchDebounceTimer);
      this._watchDebounceTimer = undefined;
    }
  }

  /** Close the watcher AND clear all watched IDs. */
  private _teardownFileWatcher(): void {
    this._pauseFileWatcher();
    this._watchedProjectKey = undefined;
    this._watchedSessionId = undefined;
    this._watchedAgentId = undefined;
  }

  private _sendConversationTail(): void {
    if (!this._watchedProjectKey || !this._watchedSessionId) return;
    const messages = readConversation(
      this._watchedProjectKey,
      this._watchedSessionId,
      this._watchedAgentId
    );
    this._panel.webview.postMessage({
      command: 'conversationTail',
      messages,
      sessionId: this._watchedSessionId,
      agentId: this._watchedAgentId,
    });

    // Targeted sidebar update for the watched session
    const projects = readClaudeProjects();
    this._projects = projects;
    const project = projects.find((p) => p.key === this._watchedProjectKey);
    if (project) {
      const session = project.sessions.find((s) => s.sessionId === this._watchedSessionId);
      if (session) {
        this._panel.webview.postMessage({
          command: 'sidebarRowUpdate',
          sessionId: session.sessionId,
          lastMessageRole: session.lastMessageRole,
          lastTimestamp: session.lastTimestamp,
          messageCount: session.messageCount,
        });
      }
    }
  }

  private async _handleExportChat(projectKey: string, sessionId: string): Promise<void> {
    try {
      const project = this._projects.find((p) => p.key === projectKey);
      if (!project) {
        vscode.window.showErrorMessage('Claude Agent Manager: Project not found.');
        this._panel.webview.postMessage({ command: 'exportDone' });
        return;
      }
      const session = project.sessions.find((s) => s.sessionId === sessionId);
      if (!session) {
        vscode.window.showErrorMessage('Claude Agent Manager: Session not found.');
        this._panel.webview.postMessage({ command: 'exportDone' });
        return;
      }

      const settings = this._getSettings();
      const outPath = await this._resolveExportPath(session, settings);
      if (!outPath) {
        // User cancelled dialog — silent abort
        this._panel.webview.postMessage({ command: 'exportDone' });
        return;
      }

      const result = exportConversation(
        { projectKey, sessionId, displayName: project.displayName, session, readConversation },
        settings,
        outPath,
      );

      let msg = `Exported to ${result.rootPath}`;
      if (result.skippedAgents > 0) {
        msg += ` (${result.skippedAgents} agent(s) could not be read)`;
      }
      vscode.window.showInformationMessage(msg);
    } catch (e: unknown) {
      vscode.window.showErrorMessage(
        `Claude Agent Manager: Export failed: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      this._panel.webview.postMessage({ command: 'exportDone' });
    }
  }

  private _exportFilename(session: ClaudeSession): string {
    const raw = session.firstPrompt ?? session.sessionId.slice(0, 8);
    const slug = raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);
    return `${slug}.md`;
  }

  private async _resolveExportPath(
    session: ClaudeSession,
    settings: ManagerSettings,
  ): Promise<string | undefined> {
    const filename = this._exportFilename(session);

    if (settings.exportDestination === 'dialog') {
      return this._showSaveDialog(filename);
    }

    if (settings.exportDestination === 'cwd') {
      if (!session.cwd) {
        return this._showSaveDialog(filename);
      }
      return path.join(session.cwd, filename);
    }

    // 'default'
    const dir = path.join(os.homedir(), 'Documents', 'claude-exports');
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e: unknown) {
      vscode.window.showErrorMessage(
        `Claude Agent Manager: Failed to create export directory: ${e instanceof Error ? e.message : String(e)}`
      );
      return undefined;
    }
    return path.join(dir, filename);
  }

  private async _showSaveDialog(filename: string): Promise<string | undefined> {
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(os.homedir(), 'Documents', filename)),
      filters: { 'Markdown': ['md'] },
    });
    return uri?.fsPath;
  }

  private _getHtml(webview: vscode.Webview): string {
    const markedUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, 'media', 'marked.min.js')
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, 'media', 'main.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, 'media', 'style.css')
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link href="${styleUri}" rel="stylesheet">
  <title>Agent Manager</title>
</head>
<body>
  <div id="app">
    <div id="icon-rail" class="icon-rail"></div>
    <!-- ── Left Sidebar ── -->
    <div id="sidebar">
      <div class="sidebar-header">
        <span class="sidebar-title" title="Keyboard: j/k to navigate, ? for help">Agent Manager</span>
        <div class="sidebar-actions">
          <span class="last-updated" id="last-updated"></span>
          <button class="icon-btn" id="refresh-btn" title="Refresh">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M13.5 2.5a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1 0-1h1.79A5.5 5.5 0 1 0 13.5 8a.5.5 0 0 1 1 0 6.5 6.5 0 1 1-2.035-4.715L13.5 2.5z"/></svg>
          </button>
          <div class="settings-wrap">
            <button class="icon-btn" id="settings-btn" title="Settings">
              <svg viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M6.562 1.94a1.5 1.5 0 0 1 2.876 0l.213.806a.5.5 0 0 0 .691.305l.763-.357a1.5 1.5 0 0 1 2.035 2.035l-.357.763a.5.5 0 0 0 .305.691l.806.213a1.5 1.5 0 0 1 0 2.876l-.806.213a.5.5 0 0 0-.305.691l.357.763a1.5 1.5 0 0 1-2.035 2.035l-.763-.357a.5.5 0 0 0-.691.305l-.213.806a1.5 1.5 0 0 1-2.876 0l-.213-.806a.5.5 0 0 0-.691-.305l-.763.357a1.5 1.5 0 0 1-2.035-2.035l.357-.763a.5.5 0 0 0-.305-.691l-.806-.213a1.5 1.5 0 0 1 0-2.876l.806-.213a.5.5 0 0 0 .305-.691l-.357-.763a1.5 1.5 0 0 1 2.035-2.035l.763.357a.5.5 0 0 0 .691-.305l.213-.806zM8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"/></svg>
            </button>
            <div class="settings-panel" id="settings-panel">
              <div class="settings-title">Notification Settings</div>
              <label class="settings-row">
                <input type="checkbox" id="sound-enabled" />
                <span>Sound when waiting for input</span>
              </label>
              <div class="settings-row repeat-row">
                <label for="sound-repeat">Repeat every</label>
                <select id="sound-repeat">
                  <option value="0">Never</option>
                  <option value="30">30s</option>
                  <option value="60">1 min</option>
                  <option value="120">2 min</option>
                  <option value="300">5 min</option>
                </select>
              </div>
              <button class="settings-test-btn" id="test-sound-btn">Test sound</button>
              <div class="settings-divider"></div>
              <div class="settings-title">Export Settings</div>
              <div class="settings-group-label">Destination</div>
              <label class="settings-radio-row">
                <input type="radio" name="export-dest" value="dialog" id="export-dest-dialog" />
                <span>Save As dialog</span>
              </label>
              <label class="settings-radio-row">
                <input type="radio" name="export-dest" value="default" id="export-dest-default" />
                <span>~/Documents/claude-exports/</span>
              </label>
              <label class="settings-radio-row">
                <input type="radio" name="export-dest" value="cwd" id="export-dest-cwd" />
                <span>Session working dir</span>
              </label>
              <div class="settings-group-label">Tool calls</div>
              <label class="settings-radio-row">
                <input type="radio" name="export-tool" value="compact" id="export-tool-compact" />
                <span>Compact</span>
              </label>
              <label class="settings-radio-row">
                <input type="radio" name="export-tool" value="expanded" id="export-tool-expanded" />
                <span>Expanded</span>
              </label>
              <label class="settings-radio-row">
                <input type="radio" name="export-tool" value="omit" id="export-tool-omit" />
                <span>Omit</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <div class="search-wrap">
        <svg class="search-icon" viewBox="0 0 16 16" fill="currentColor">
          <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
        </svg>
        <input type="text" id="search" placeholder="Filter projects…" autocomplete="off" spellcheck="false" />
        <button class="clear-btn" id="clear-search" title="Clear">&times;</button>
      </div>

      <div class="filter-bar" id="filter-bar">
        <button class="filter-chip selected" data-filter="all">All</button>
        <button class="filter-chip" data-filter="active">Active</button>
        <button class="filter-chip" data-filter="waiting">Waiting</button>
        <button class="filter-chip" data-filter="pinned">Pinned</button>
      </div>

      <div id="projects-container">
        <div class="loading">
          <div class="spinner"></div>
          Loading…
        </div>
      </div>
    </div>

    <!-- ── Main Conversation Panel ── -->
    <div id="main-panel">
      <div id="conversation-header">
        <span id="conv-breadcrumb">Select a session to view its conversation</span>
        <span id="live-indicator" class="live-indicator">
          <span class="live-dot"></span>
          LIVE
        </span>
        <button class="export-btn" id="export-btn" title="Export conversation">Export</button>
      </div>
      <div id="conversation-container" tabindex="0">
        <div class="conv-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="conv-empty-icon">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <p>Click on a session or agent in the sidebar to view the conversation.</p>
        </div>
      </div>
    </div>
  </div>
  <script nonce="${nonce}" src="${markedUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  public dispose(): void {
    AgentManagerPanel.currentPanel = undefined;
    if (this._refreshTimer) { clearInterval(this._refreshTimer); }
    this._teardownFileWatcher();
    this._panel.dispose();
    while (this._disposables.length) {
      this._disposables.pop()?.dispose();
    }
  }
}

function getNonce(): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length))
  ).join('');
}
