import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension activation', () => {
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension('kyle-walker.vscode-agent-manager');
    assert.ok(ext, 'Extension kyle-walker.vscode-agent-manager was not found in the test host');
    if (!ext.isActive) {
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
    let hasWebview = false;
    for (let i = 0; i < 40; i++) {
      const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs);
      hasWebview = tabs.some(
        (t) => t.input instanceof vscode.TabInputWebview &&
               t.input.viewType.includes('claudeAgentManager')
      );
      if (hasWebview) break;
      await new Promise<void>((r) => setTimeout(r, 50));
    }
    assert.ok(hasWebview, 'Expected a claudeAgentManager webview tab to be open after executing the command');
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });
});
