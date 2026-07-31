import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { validateInputObject } from './validate-inputs.mjs';

const REQUEST_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,79}$/;
const ALLOWED_KEYS = Object.freeze([
  'requestId',
  'privateExactSha',
  'expectedBaseSha',
  'expectedChangedFileCount',
  'expectedMigrationCount',
  'validationProfile',
]);

export function parseValidationRequestObject(input) {
  const object = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const unknownKeys = Object.keys(object).filter((key) => !ALLOWED_KEYS.includes(key));
  const requestId = String(object.requestId ?? '').trim();
  const validation = validateInputObject(object);
  const failures = [];

  if (!REQUEST_ID_PATTERN.test(requestId)) failures.push('REQUEST_ID_INVALID');
  if (unknownKeys.length > 0) failures.push('UNKNOWN_REQUEST_FIELD');
  if (validation.status !== 'PASS') failures.push(validation.failureCategory);

  return Object.freeze({
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    failureCategory: failures[0] ?? 'NONE',
    values: Object.freeze({
      requestId,
      ...validation.values,
    }),
  });
}

function appendOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, 'utf8');
}

function main() {
  let parsed;
  try {
    const raw = readFileSync('validation-requests/current.json', 'utf8');
    parsed = parseValidationRequestObject(JSON.parse(raw));
  } catch {
    parsed = Object.freeze({
      status: 'FAIL',
      failureCategory: 'REQUEST_FILE_INVALID',
      values: Object.freeze({}),
    });
  }

  appendOutput('status', parsed.status);
  appendOutput('failure_category', parsed.failureCategory);
  for (const [name, value] of Object.entries(parsed.values)) appendOutput(name, String(value));
  console.log(`PMAI_VALIDATION_REQUEST status=${parsed.status} category=${parsed.failureCategory} request=${parsed.values.requestId ?? 'INVALID'} profile=${parsed.values.validationProfile ?? 'INVALID'}`);
  process.exitCode = parsed.status === 'PASS' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
