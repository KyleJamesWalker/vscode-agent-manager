import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  try {
    // Extension root (where package.json lives) — 3 levels up from out/test/integration/
    const extensionDevelopmentPath = path.resolve(__dirname, '../../../');
    // Compiled suite entry — out/test/integration/suite/index.js
    const extensionTestsPath = path.resolve(__dirname, './suite/index');
    await runTests({ extensionDevelopmentPath, extensionTestsPath });
  } catch (err) {
    console.error('Failed to run integration tests:', err);
    process.exit(1);
  }
}

main();
