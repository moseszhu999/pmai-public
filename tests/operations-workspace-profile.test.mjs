import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateInputObject } from '../scripts/validate-inputs.mjs';

const profile = readFileSync(new URL('../scripts/run-operations-workspace-profile.mjs', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/pmai-exact-head-controller.yml', import.meta.url), 'utf8');

const escaped = (value) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

test('operations workspace profile locks the four-file child scope', () => {
  for (const marker of [
    'public/workspace/index.html',
    'public/workspace/operations-remediation-v1.css',
    'public/workspace/operations-remediation-v1.js',
    'tests/operations-remediation-v1.test.ts',
    'EXACT_OPERATIONS_SCOPE_MISMATCH',
  ]) assert.match(profile, escaped(marker));
});

test('operations workspace profile preserves truth and execution boundaries', () => {
  for (const marker of [
    'TRUTH_RENDERER_ORDER_INVALID',
    'DRAFT_ONLY_BOUNDARY_MISSING',
    'FORMAL_OWNER_BOUNDARY_MISSING',
    'EXECUTION_BOUNDARY_MISSING',
    'NETWORK_SURFACE_EXPOSED',
    'PRIVILEGED_CREDENTIAL_SURFACE_EXPOSED',
    'FORMAL_EXECUTION_COMMAND_EXPOSED',
  ]) assert.match(profile, escaped(marker));
  assert.match(profile, /tests\/workspace-chatgpt-truth-cutover\.test\.ts/);
  assert.match(profile, /tests\/workspace-interactions\.test\.ts/);
  assert.match(profile, /tests\/workspace-static-javascript-syntax\.test\.ts/);
  assert.match(profile, /strict-typecheck/);
  assert.match(profile, /production-build/);
});

test('operations workspace lint is fixed to the owned JavaScript and TypeScript files', () => {
  assert.match(profile, /runStage\('target-lint', 'npx'/);
  assert.match(profile, /'eslint', '--max-warnings=0'/);
  assert.match(profile, /'public\/workspace\/operations-remediation-v1\.js'/);
  assert.match(profile, /'tests\/operations-remediation-v1\.test\.ts'/);
  assert.doesNotMatch(profile, /runStage\('repository-lint'/);
  assert.doesNotMatch(profile, /\['run', 'lint'\]/);
});

test('operations workspace is routed by the reusable public controller', () => {
  assert.match(workflow, /operations-workspace\)/);
  assert.match(workflow, /run-operations-workspace-profile\.mjs/);
});

test('operations workspace input contract fails closed', () => {
  const valid = {
    privateExactSha: 'a'.repeat(40),
    expectedBaseSha: 'b'.repeat(40),
    validationProfile: 'operations-workspace',
    expectedChangedFileCount: '4',
    expectedMigrationCount: '0',
  };
  assert.equal(validateInputObject(valid).status, 'PASS');
  assert.equal(validateInputObject({ ...valid, expectedChangedFileCount: '5' }).status, 'FAIL');
  assert.equal(validateInputObject({ ...valid, expectedMigrationCount: '1' }).status, 'FAIL');
  assert.equal(validateInputObject({ ...valid, validationProfile: 'operations-workspace-v2' }).status, 'FAIL');
});
