import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { validateInputObject } from '../scripts/validate-inputs.mjs';

const validSha = '0123456789abcdef0123456789abcdef01234567';
const validBase = '89abcdef0123456789abcdef0123456789abcdef';

function validInput(overrides = {}) {
  return {
    privateExactSha: validSha,
    expectedBaseSha: validBase,
    expectedChangedFileCount: '6',
    expectedMigrationCount: '0',
    validationProfile: 'canonical-baseline',
    ...overrides,
  };
}

test('accepts the fixed canonical exact-head input contract', () => {
  assert.equal(validateInputObject(validInput()).status, 'PASS');
});

test('accepts only the fixed six-file zero-migration platform MCP profile', () => {
  assert.equal(validateInputObject(validInput({ validationProfile: 'platform-mcp-dev' })).status, 'PASS');
  assert.equal(validateInputObject(validInput({
    validationProfile: 'platform-mcp-dev',
    expectedChangedFileCount: '5',
  })).status, 'FAIL');
  assert.equal(validateInputObject(validInput({
    validationProfile: 'platform-mcp-dev',
    expectedMigrationCount: '1',
  })).status, 'FAIL');
});

test('accepts only the fixed nine-file zero-migration read-only MCP Gateway profile', () => {
  assert.equal(validateInputObject(validInput({
    validationProfile: 'mcp-gateway-readonly',
    expectedChangedFileCount: '9',
  })).status, 'PASS');
  assert.equal(validateInputObject(validInput({
    validationProfile: 'mcp-gateway-readonly',
    expectedChangedFileCount: '8',
  })).status, 'FAIL');
  assert.equal(validateInputObject(validInput({
    validationProfile: 'mcp-gateway-readonly',
    expectedChangedFileCount: '9',
    expectedMigrationCount: '1',
  })).status, 'FAIL');
});

test('rejects refs, short SHAs, uppercase SHAs and unknown profiles', () => {
  assert.equal(validateInputObject(validInput({ privateExactSha: 'main' })).status, 'FAIL');
  assert.equal(validateInputObject(validInput({ privateExactSha: validSha.slice(0, 12) })).status, 'FAIL');
  assert.equal(validateInputObject(validInput({ privateExactSha: validSha.toUpperCase() })).status, 'FAIL');
  assert.equal(validateInputObject(validInput({ validationProfile: 'arbitrary-shell' })).status, 'FAIL');
});

test('rejects negative, empty and non-integer counts', () => {
  for (const value of ['', '-1', '1.5', 'latest']) {
    assert.equal(validateInputObject(validInput({ expectedChangedFileCount: value })).status, 'FAIL');
    assert.equal(validateInputObject(validInput({ expectedMigrationCount: value })).status, 'FAIL');
  }
});

test('controller keeps the private checkout read-only and public-safe', async () => {
  const workflow = await readFile('.github/workflows/pmai-exact-head-controller.yml', 'utf8');
  assert.match(workflow, /repository: moseszhu999\/pmai/);
  assert.match(workflow, /ref: \$\{\{ inputs\.privateExactSha \}\}/);
  assert.ok((workflow.match(/persist-credentials: false/g) ?? []).length >= 2);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /run-mcp-gateway-readonly-profile\.mjs/);
  assert.doesNotMatch(workflow, /actions\/upload-artifact/);
  assert.doesNotMatch(workflow, /pull_request_target/);
  assert.doesNotMatch(workflow, /gh\s+pr\s+merge/i);
  assert.doesNotMatch(workflow, /supabase\s+functions\s+deploy/i);
  assert.doesNotMatch(workflow, /vercel\s+--prod/i);
  assert.match(workflow, /rm -rf private-repo/);
});

test('dispatch exposes only fixed profiles and no arbitrary command input', async () => {
  const workflow = await readFile('.github/workflows/pmai-validation-dispatch.yml', 'utf8');
  assert.match(workflow, /canonical-baseline/);
  assert.match(workflow, /platform-mcp-dev/);
  assert.match(workflow, /mcp-gateway-readonly/);
  assert.doesNotMatch(workflow, /command:/);
  assert.doesNotMatch(workflow, /script:/);
  assert.doesNotMatch(workflow, /shellCommand/);
});

test('private baseline profile seals raw output and scans Agent authority boundaries', async () => {
  const runner = await readFile('scripts/run-canonical-baseline.mjs', 'utf8');
  assert.match(runner, /pmai-private-raw/);
  assert.match(runner, /mode: 0o700/);
  assert.match(runner, /0o600/);
  assert.match(runner, /AGENT_WRITE_TOKEN_FALLBACK/);
  assert.match(runner, /DIRECT_SERVICE_ROLE_REFERENCE/);
  assert.match(runner, /RAW_EXECUTION_TOOL/);
  assert.match(runner, /FORMAL_EXECUTION_COMMAND/);
});

test('platform MCP profile is fixed-scope, sealed and Netlify-only', async () => {
  const runner = await readFile('scripts/run-platform-mcp-dev-profile.mjs', 'utf8');
  assert.match(runner, /pmai-private-raw/);
  assert.match(runner, /platform-mcp-development-v1\.md/);
  assert.match(runner, /deployment-evidence\.test\.ts/);
  assert.match(runner, /setup-codex-platform-mcp\.sh/);
  assert.match(runner, /link-pmai-netlify-dev\.sh/);
  assert.match(runner, /https:\/\/netlify-mcp\.netlify\.app\/mcp/);
  assert.match(runner, /VERCEL_MCP_ENDPOINT_ACTIVE/);
  assert.match(runner, /Vercel integration is explicitly deferred/);
  assert.doesNotMatch(runner, /VERCEL_MCP_ENDPOINT_MISSING/);
  assert.match(runner, /FORMAL_PLATFORM_ACTION_EXPOSED/);
  assert.doesNotMatch(runner, /actions\/upload-artifact/);
});

test('read-only MCP Gateway profile is fixed-scope, sealed and authority bounded', async () => {
  const runner = await readFile('scripts/run-mcp-gateway-readonly-profile.mjs', 'utf8');
  assert.match(runner, /pmai-private-raw/);
  assert.match(runner, /mode: 0o700/);
  assert.match(runner, /0o600/);
  assert.match(runner, /EXACT_MCP_GATEWAY_SCOPE_MISMATCH/);
  assert.match(runner, /TIMING_SAFE_TOKEN_COMPARE_MISSING/);
  assert.match(runner, /READ_ONLY_ANNOTATION_MISSING/);
  assert.match(runner, /FORMAL_APPLICATION_GUARD_MISSING/);
  assert.match(runner, /PRODUCTION_DEPLOYMENT_GUARD_MISSING/);
  assert.match(runner, /NETLIFY_ORIGIN_SUPPORT_MISSING/);
  assert.match(runner, /VERCEL_ACTIVE_SCOPE_PRESENT/);
  assert.match(runner, /LEGACY_DIAGNOSTIC/);
  assert.doesNotMatch(runner, /actions\/upload-artifact/);
});
