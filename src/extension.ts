import * as vscode from 'vscode';
import { AgentManagerPanel } from './agentManagerPanel';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeAgentManager.openPanel', () => {
      AgentManagerPanel.createOrShow(context);
    })
  );
}

export function deactivate(): void {}
