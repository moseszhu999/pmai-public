import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('MCP Gateway typecheck diagnostics expose only location and TS code', async () => {
  const runner = await readFile('scripts/run-mcp-gateway-readonly-profile.mjs', 'utf8');

  assert.match(runner, /--pretty', 'false'/);
  assert.match(runner, /PMAI_TYPECHECK_DIAGNOSTICS/);
  assert.match(runner, /file: relativePath/);
  assert.match(runner, /line: Number/);
  assert.match(runner, /column: Number/);
  assert.match(runner, /code: `TS/);
  assert.doesNotMatch(runner, /messageText/);
  assert.doesNotMatch(runner, /flattenDiagnosticMessageText/);
  assert.doesNotMatch(runner, /actions\/upload-artifact/);
});
