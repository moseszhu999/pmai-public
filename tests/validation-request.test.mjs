import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parseValidationRequestObject } from '../scripts/read-validation-request.mjs';

const request = Object.freeze({
  requestId: 'pmai-pr24-platform-mcp-dev-v1',
  privateExactSha: '192048cdfe7a12fee82cc3c62df221e9891c5fa8',
  expectedBaseSha: '7423edd3525ef2172729db8f0c0150faf8984d5c',
  expectedChangedFileCount: '6',
  expectedMigrationCount: '0',
  validationProfile: 'platform-mcp-dev',
});

test('accepts the fixed platform MCP validation request', () => {
  const parsed = parseValidationRequestObject(request);
  assert.equal(parsed.status, 'PASS');
  assert.equal(parsed.values.requestId, request.requestId);
});

test('rejects unknown fields, arbitrary profiles and invalid request ids', () => {
  assert.equal(parseValidationRequestObject({ ...request, command: 'npm test' }).status, 'FAIL');
  assert.equal(parseValidationRequestObject({ ...request, validationProfile: 'arbitrary-shell' }).status, 'FAIL');
  assert.equal(parseValidationRequestObject({ ...request, requestId: '../../unsafe' }).status, 'FAIL');
});

test('request carrier is main-only, fixed-path and delegates to the reusable controller', async () => {
  const workflow = await readFile('.github/workflows/pmai-validation-request.yml', 'utf8');
  assert.match(workflow, /branches:\s*\n\s*- main/);
  assert.match(workflow, /validation-requests\/current\.json/);
  assert.match(workflow, /uses: \.\/\.github\/workflows\/pmai-exact-head-controller\.yml/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /pull_request_target/);
  assert.doesNotMatch(workflow, /command:/);
  assert.doesNotMatch(workflow, /shellCommand/);
  assert.doesNotMatch(workflow, /actions\/upload-artifact/);
});
