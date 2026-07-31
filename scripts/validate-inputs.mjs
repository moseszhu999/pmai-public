import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const COUNT_PATTERN = /^(0|[1-9][0-9]*)$/;
export const VALIDATION_PROFILES = Object.freeze([
  'canonical-baseline',
  'platform-mcp-dev',
  'mcp-gateway-readonly',
]);

export function validateInputObject(input) {
  const privateExactSha = String(input.privateExactSha ?? '').trim();
  const expectedBaseSha = String(input.expectedBaseSha ?? '').trim();
  const validationProfile = String(input.validationProfile ?? '').trim();
  const expectedChangedFileCount = String(input.expectedChangedFileCount ?? '').trim();
  const expectedMigrationCount = String(input.expectedMigrationCount ?? '').trim();

  const failures = [];
  if (!SHA_PATTERN.test(privateExactSha)) failures.push('PRIVATE_EXACT_SHA_INVALID');
  if (!SHA_PATTERN.test(expectedBaseSha)) failures.push('EXPECTED_BASE_SHA_INVALID');
  if (!VALIDATION_PROFILES.includes(validationProfile)) failures.push('VALIDATION_PROFILE_INVALID');
  if (!COUNT_PATTERN.test(expectedChangedFileCount)) failures.push('EXPECTED_CHANGED_FILE_COUNT_INVALID');
  if (!COUNT_PATTERN.test(expectedMigrationCount)) failures.push('EXPECTED_MIGRATION_COUNT_INVALID');

  if (validationProfile === 'platform-mcp-dev') {
    if (expectedChangedFileCount !== '6') failures.push('PLATFORM_MCP_CHANGED_FILE_COUNT_INVALID');
    if (expectedMigrationCount !== '0') failures.push('PLATFORM_MCP_MIGRATION_COUNT_INVALID');
  }

  if (validationProfile === 'mcp-gateway-readonly') {
    if (expectedChangedFileCount !== '9') failures.push('MCP_GATEWAY_CHANGED_FILE_COUNT_INVALID');
    if (expectedMigrationCount !== '0') failures.push('MCP_GATEWAY_MIGRATION_COUNT_INVALID');
  }

  return Object.freeze({
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    failureCategory: failures[0] ?? 'NONE',
    values: Object.freeze({
      privateExactSha,
      expectedBaseSha,
      validationProfile,
      expectedChangedFileCount,
      expectedMigrationCount,
    }),
  });
}

function appendOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, 'utf8');
}

function main() {
  const result = validateInputObject({
    privateExactSha: process.env.PRIVATE_EXACT_SHA,
    expectedBaseSha: process.env.EXPECTED_BASE_SHA,
    validationProfile: process.env.VALIDATION_PROFILE,
    expectedChangedFileCount: process.env.EXPECTED_CHANGED_FILE_COUNT,
    expectedMigrationCount: process.env.EXPECTED_MIGRATION_COUNT,
  });

  appendOutput('status', result.status);
  appendOutput('failure_category', result.failureCategory);
  console.log(`PMAI_INPUT_VALIDATION status=${result.status} category=${result.failureCategory}`);
  process.exitCode = result.status === 'PASS' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
