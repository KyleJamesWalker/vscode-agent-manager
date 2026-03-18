import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension activation', () => {
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension('kyle-walker.vscode-agent-manager');
    if (ext && !ext.isActive) {
      await ext.activate();
    }
  });

  test('command claudeAgentManager.openPanel is registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('claudeAgentManager.openPanel'),
      'Expected command claudeAgentManager.openPanel to be registered'
    );
  });

  test('executing the command opens a webview panel', async () => {
    await vscode.commands.executeCommand('claudeAgentManager.openPanel');
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs);
    const hasWebview = tabs.some((t) => t.input instanceof vscode.TabInputWebview);
    assert.ok(hasWebview, 'Expected a webview tab to be open after executing the command');
  });
});
