import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

function appendOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, 'utf8');
}

function git(repo, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) throw new Error('GIT_COMMAND_FAILED');
  return result;
}

function fail(category, safe = {}) {
  appendOutput('status', 'FAIL');
  appendOutput('failure_category', category);
  for (const [name, value] of Object.entries(safe)) appendOutput(name, value);
  console.log(`PMAI_SCOPE status=FAIL category=${category}`);
  process.exit(1);
}

const repo = process.env.PRIVATE_REPO_PATH ?? '';
const privateExactSha = process.env.PRIVATE_EXACT_SHA ?? '';
const expectedBaseSha = process.env.EXPECTED_BASE_SHA ?? '';
const expectedChangedFileCount = Number(process.env.EXPECTED_CHANGED_FILE_COUNT ?? '-1');
const expectedMigrationCount = Number(process.env.EXPECTED_MIGRATION_COUNT ?? '-1');

try {
  if (!repo) fail('PRIVATE_REPO_PATH_MISSING');

  const actualSha = git(repo, ['rev-parse', 'HEAD']).stdout.trim();
  if (actualSha !== privateExactSha) fail('EXACT_SHA_MISMATCH', { actual_sha: actualSha });

  const symbolicRef = git(repo, ['symbolic-ref', '-q', 'HEAD'], { allowFailure: true });
  if (symbolicRef.status === 0) fail('CHECKOUT_NOT_DETACHED', { actual_sha: actualSha });

  const origin = git(repo, ['remote', 'get-url', 'origin']).stdout.trim().replace(/\.git$/, '');
  if (origin !== 'https://github.com/moseszhu999/pmai') {
    fail('PRIVATE_ORIGIN_MISMATCH', { actual_sha: actualSha });
  }

  const persistedCredential = git(
    repo,
    ['config', '--local', '--get-regexp', '^http\\..*\\.extraheader$'],
    { allowFailure: true },
  );
  if (persistedCredential.status === 0 && persistedCredential.stdout.trim()) {
    fail('PERSISTED_CHECKOUT_CREDENTIAL', { actual_sha: actualSha });
  }

  const mergeBase = git(repo, ['merge-base', expectedBaseSha, privateExactSha]).stdout.trim();
  if (mergeBase !== expectedBaseSha) {
    fail('MERGE_BASE_MISMATCH', { actual_sha: actualSha, merge_base: mergeBase });
  }

  const changedOutput = git(repo, ['diff', '--name-only', expectedBaseSha, privateExactSha]).stdout;
  const changedFiles = changedOutput.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  const migrationCount = changedFiles.filter((name) => /^supabase\/migrations\/[0-9]{14}_.+\.sql$/.test(name)).length;

  if (changedFiles.length !== expectedChangedFileCount) {
    fail('CHANGED_FILE_COUNT_MISMATCH', {
      actual_sha: actualSha,
      merge_base: mergeBase,
      changed_file_count: String(changedFiles.length),
      migration_count: String(migrationCount),
    });
  }
  if (migrationCount !== expectedMigrationCount) {
    fail('MIGRATION_COUNT_MISMATCH', {
      actual_sha: actualSha,
      merge_base: mergeBase,
      changed_file_count: String(changedFiles.length),
      migration_count: String(migrationCount),
    });
  }

  appendOutput('status', 'PASS');
  appendOutput('failure_category', 'NONE');
  appendOutput('actual_sha', actualSha);
  appendOutput('merge_base', mergeBase);
  appendOutput('changed_file_count', String(changedFiles.length));
  appendOutput('migration_count', String(migrationCount));
  console.log(`PMAI_SCOPE status=PASS files=${changedFiles.length} migrations=${migrationCount}`);
} catch {
  fail('PRIVATE_SCOPE_VERIFICATION_FAILED');
}
