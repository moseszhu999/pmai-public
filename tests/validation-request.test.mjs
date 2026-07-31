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

test('sanitized evidence is published only to the fixed public ledger', async () => {
  const requestWorkflow = await readFile('.github/workflows/pmai-validation-request.yml', 'utf8');
  const controller = await readFile('.github/workflows/pmai-exact-head-controller.yml', 'utf8');

  assert.match(requestWorkflow, /issues: write/);
  assert.match(requestWorkflow, /issue_number: 5/);
  assert.match(requestWorkflow, /needs\.validate\.outputs\.verdict/);
  assert.match(requestWorkflow, /needs\.validate\.outputs\.failureStage/);
  assert.match(requestWorkflow, /No private source, changed-file names, raw output/);
  assert.doesNotMatch(requestWorkflow, /PRIVATE_TOKEN/);
  assert.doesNotMatch(requestWorkflow, /pmai-private-raw/);

  assert.match(controller, /failureStage:/);
  assert.match(controller, /failure_stage=PRIVATE_READ_CREDENTIAL/);
  assert.match(controller, /failure_stage=PRIVATE_CHECKOUT/);
  assert.match(controller, /failure_stage=PRIVATE_SCOPE/);
  assert.match(controller, /failure_stage=VALIDATION_PROFILE/);
});
