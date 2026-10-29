import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const output = mkdtempSync(join(tmpdir(), 'mini-2d-test-'));
try {
  const compiled = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--module', 'CommonJS', '--moduleResolution', 'Node', '--outDir', output], { stdio: 'inherit' });
  if (compiled.status !== 0) process.exitCode = compiled.status || 1;
  else {
    const tests = readdirSync('tests').filter(name => name.endsWith('.test.mjs')).map(name => join('tests', name));
    const tested = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit', env: { ...process.env, TEST_BUILD_DIR: output } });
    process.exitCode = tested.status || (tested.error ? 1 : 0);
  }
} finally {
  rmSync(output, { recursive: true, force: true });
}
