import * as vscode from 'vscode';
import * as os from 'os';
import * as fs from 'fs';
import { execSync } from 'child_process';

type PostMessageFn = (msg: unknown) => void;

export class TerminalManager {
  private _cwdToTerminal = new Map<string, vscode.Terminal>();
  private _prevHasTerminal = new Map<string, boolean>();
  private _currentCwd: string | undefined;
  private _scanInterval: ReturnType<typeof setInterval> | undefined;
  private readonly _postMessage: PostMessageFn;

  constructor(postMessage: PostMessageFn) {
    this._postMessage = postMessage;
    this._startScan();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  getTerminalForCwd(cwd: string): vscode.Terminal | undefined {
    return this._cwdToTerminal.get(cwd);
  }

  async resumeSession(sessionId: string, cwd: string): Promise<vscode.Terminal> {
    const terminal = vscode.window.createTerminal({
      name: `Claude: ${sessionId.slice(0, 8)}`,
      cwd,
    });
    terminal.sendText(`claude --resume ${sessionId}`);
    this._cwdToTerminal.set(cwd, terminal);
    // Allow Claude to reach its interactive prompt before callers send text
    await new Promise<void>((resolve) => setTimeout(resolve, 2000));
    return terminal;
  }

  async sendToSession(cwd: string, text: string): Promise<void> {
    const terminal = this._cwdToTerminal.get(cwd);
    if (!terminal) {
      throw new Error('No active terminal for this session');
    }
    terminal.sendText(text, true);
  }

  focusSession(cwd: string): void {
    const terminal = this._cwdToTerminal.get(cwd);
    if (terminal) {
      terminal.show();
    }
  }

  setCurrentCwd(cwd: string | undefined): void {
    this._currentCwd = cwd;
    if (cwd !== undefined) {
      // Immediately post current status so webview is accurate after session switch
      const hasTerminal = this._cwdToTerminal.has(cwd);
      this._postMessage({ command: 'terminalStatus', sessionId: cwd, hasTerminal });
    }
  }

  pauseScan(): void {
    if (this._scanInterval) {
      clearInterval(this._scanInterval);
      this._scanInterval = undefined;
    }
  }

  resumeScan(): void {
    if (!this._scanInterval) {
      this._startScan();
    }
  }

  dispose(): void {
    this.pauseScan();
  }

  // ── Private scan logic ─────────────────────────────────────────────────────

  private _startScan(): void {
    this._scanInterval = setInterval(() => { void this._scan(); }, 5000);
  }

  private async _scan(): Promise<void> {
    if (!this._currentCwd) return;
    if (os.platform() === 'win32') return; // No pgrep/lsof on Windows

    try {
      const pids = this._getClaudePids();
      if (pids.length === 0) {
        this._updateTerminalMap(new Map());
        return;
      }

      const terminalPids = await this._getTerminalPids();
      const newMap = new Map<string, vscode.Terminal>();

      for (const pid of pids) {
        const parentPid = this._getParentPid(pid);
        if (parentPid == null) continue;

        const terminal = terminalPids.get(parentPid);
        if (!terminal) continue;

        const cwd = this._getProcessCwd(pid);
        if (!cwd) continue;

        newMap.set(cwd, terminal);
      }

      this._updateTerminalMap(newMap);
    } catch {
      // Scan errors are silent — fallback is explicit tracking of created terminals
    }
  }

  private _updateTerminalMap(newMap: Map<string, vscode.Terminal>): void {
    this._cwdToTerminal = newMap;
    if (this._currentCwd) {
      const hasTerminal = newMap.has(this._currentCwd);
      const prev = this._prevHasTerminal.get(this._currentCwd);
      if (hasTerminal !== prev) {
        this._prevHasTerminal.set(this._currentCwd, hasTerminal);
        this._postMessage({ command: 'terminalStatus', sessionId: this._currentCwd, hasTerminal });
      }
    }
  }

  private _getClaudePids(): number[] {
    try {
      const out = execSync('pgrep -x claude', { encoding: 'utf-8', timeout: 3000 }).trim();
      if (!out) return [];
      return out.split('\n').map(Number).filter((n) => !isNaN(n) && n > 0);
    } catch {
      return [];
    }
  }

  private async _getTerminalPids(): Promise<Map<number, vscode.Terminal>> {
    const map = new Map<number, vscode.Terminal>();
    for (const terminal of vscode.window.terminals) {
      try {
        const pid = await terminal.processId;
        if (pid != null) map.set(pid, terminal);
      } catch {
        // Terminal may have been disposed
      }
    }
    return map;
  }

  private _getParentPid(pid: number): number | undefined {
    try {
      const out = execSync(`ps -p ${pid} -o ppid=`, { encoding: 'utf-8', timeout: 3000 }).trim();
      const ppid = parseInt(out, 10);
      return isNaN(ppid) ? undefined : ppid;
    } catch {
      return undefined;
    }
  }

  private _getProcessCwd(pid: number): string | undefined {
    try {
      if (os.platform() === 'linux') {
        return fs.readlinkSync(`/proc/${pid}/cwd`);
      }
      // macOS — use -d cwd to restrict lsof output to the CWD entry only
      const out = execSync(
        `lsof -p ${pid} -Fn -d cwd 2>/dev/null | grep '^n/'`,
        { encoding: 'utf-8', timeout: 3000 }
      ).trim();
      return out ? out.slice(1) : undefined; // strip leading 'n'
    } catch {
      return undefined;
    }
  }
}
