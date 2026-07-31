import { appendFileSync, closeSync, existsSync, openSync, writeFileSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function appendOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, 'utf8');
}

const repo = process.env.PRIVATE_REPO_PATH ?? '';
const runnerTemp = process.env.RUNNER_TEMP ?? '';
const exactSha = process.env.PRIVATE_EXACT_SHA ?? '';
const baseSha = process.env.EXPECTED_BASE_SHA ?? '';

if (!repo || !runnerTemp || !/^[0-9a-f]{40}$/.test(exactSha) || !/^[0-9a-f]{40}$/.test(baseSha)) {
  appendOutput('status', 'FAIL');
  appendOutput('failure_category', 'PROFILE_ENVIRONMENT_INVALID');
  console.log('PMAI_NETLIFY_MCP_DEV status=FAIL category=PROFILE_ENVIRONMENT_INVALID');
  process.exit(1);
}

const rawDir = path.join(runnerTemp, 'pmai-private-raw');
await mkdir(rawDir, { recursive: true, mode: 0o700 });

function runStage(name, executable, args) {
  const rawPath = path.join(rawDir, `${name}.raw`);
  const fd = openSync(rawPath, 'w', 0o600);
  const result = spawnSync(executable, args, {
    cwd: repo,
    env: { ...process.env, CI: 'true' },
    stdio: ['ignore', fd, fd],
  });
  closeSync(fd);
  return result.status === 0 ? 'PASS' : 'FAIL';
}

function git(args) {
  const result = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error('GIT_COMMAND_FAILED');
  return result.stdout.trim();
}

const expectedFiles = Object.freeze([
  '.gitignore',
  'docs/agent-native/v1/platform-mcp-development-v1.md',
  'lib/deployment-evidence/types.ts',
  'scripts/link-pmai-netlify-dev.sh',
  'scripts/setup-codex-platform-mcp.sh',
  'tests/deployment-evidence.test.ts',
]);

async function runContractChecks() {
  const violations = [];
  const changedFiles = git(['diff', '--name-only', baseSha, exactSha])
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();

  if (JSON.stringify(changedFiles) !== JSON.stringify([...expectedFiles].sort())) {
    violations.push('EXACT_PLATFORM_SCOPE_MISMATCH');
  }

  for (const relativePath of expectedFiles) {
    if (!existsSync(path.join(repo, relativePath))) violations.push('REQUIRED_FILE_MISSING');
  }

  const setup = await readFile(path.join(repo, 'scripts/setup-codex-platform-mcp.sh'), 'utf8');
  const linker = await readFile(path.join(repo, 'scripts/link-pmai-netlify-dev.sh'), 'utf8');
  const evidence = await readFile(path.join(repo, 'lib/deployment-evidence/types.ts'), 'utf8');
  const test = await readFile(path.join(repo, 'tests/deployment-evidence.test.ts'), 'utf8');
  const ignore = await readFile(path.join(repo, '.gitignore'), 'utf8');
  const docs = await readFile(path.join(repo, 'docs/agent-native/v1/platform-mcp-development-v1.md'), 'utf8');
  const combined = [setup, linker, evidence, test, docs].join('\n');

  if (!setup.includes('https://netlify-mcp.netlify.app/mcp')) violations.push('NETLIFY_MCP_ENDPOINT_MISSING');
  if (setup.includes('https://mcp.vercel.com')) violations.push('VERCEL_MCP_ENDPOINT_ACTIVE');
  if (!setup.includes('Vercel integration is explicitly deferred')) violations.push('VERCEL_DEFERRAL_MISSING');
  if (!docs.includes('Netlify is the only active deployment and preview platform')) violations.push('NETLIFY_ONLY_SCOPE_MISSING');
  if (!docs.includes('Vercel integration is explicitly deferred')) violations.push('VERCEL_DOC_DEFERRAL_MISSING');
  if (!linker.includes('151d27a2-80b8-4d6a-be6c-794c08a73f9f')) violations.push('NETLIFY_SITE_BINDING_MISSING');
  if (!ignore.split(/\r?\n/).includes('.netlify/')) violations.push('NETLIFY_STATE_NOT_IGNORED');
  if (!evidence.includes('sourceCommitSha')) violations.push('EXACT_SHA_EVIDENCE_MISSING');
  if (!evidence.includes('PMAI_DEV_MCP_PRODUCTION_EVIDENCE_FORBIDDEN')) violations.push('PRODUCTION_EVIDENCE_GUARD_MISSING');
  if (!test.includes('STALE')) violations.push('STALE_EVIDENCE_TEST_MISSING');
  if (!docs.includes('WORKER_REPORTED_EVIDENCE')) violations.push('EVIDENCE_CLASSIFICATION_MISSING');
  if (!docs.includes('HOSTED_VERIFIED_EVIDENCE')) violations.push('HOSTED_EVIDENCE_CLASSIFICATION_MISSING');
  if (!docs.includes('DEPLOYMENT_PLATFORM_EVIDENCE')) violations.push('PLATFORM_EVIDENCE_CLASSIFICATION_MISSING');

  const forbidden = [
    /vercel\s+(?:deploy\s+)?--prod/i,
    /vercel\s+promote/i,
    /vercel\s+rollback/i,
    /netlify\s+deploy\s+--prod/i,
    /netlify\s+env:(?:set|unset)/i,
    /supabase\s+functions\s+deploy/i,
    /gh\s+pr\s+merge/i,
  ];
  if (forbidden.some((pattern) => pattern.test(combined))) violations.push('FORMAL_PLATFORM_ACTION_EXPOSED');

  writeFileSync(path.join(rawDir, 'platform-contracts.raw'), violations.join('\n'), {
    encoding: 'utf8',
    mode: 0o600,
  });
  return { status: violations.length === 0 ? 'PASS' : 'FAIL', count: violations.length };
}

let contract = { status: 'FAIL', count: 1 };
try {
  contract = await runContractChecks();
} catch {
  writeFileSync(path.join(rawDir, 'platform-contracts.raw'), 'CONTRACT_CHECK_EXCEPTION', {
    encoding: 'utf8',
    mode: 0o600,
  });
}

const dependencyStatus = contract.status === 'PASS'
  ? runStage('dependency-install', 'npm', ['install', '--no-audit', '--no-fund'])
  : 'NOT_RUN';
const scriptStatus = contract.status === 'PASS'
  ? runStage('script-syntax', 'bash', ['-n', 'scripts/setup-codex-platform-mcp.sh'])
  : 'NOT_RUN';
const linkerStatus = contract.status === 'PASS'
  ? runStage('linker-syntax', 'bash', ['-n', 'scripts/link-pmai-netlify-dev.sh'])
  : 'NOT_RUN';
const testStatus = dependencyStatus === 'PASS' && scriptStatus === 'PASS' && linkerStatus === 'PASS'
  ? runStage('focused-test', 'npx', ['vitest', 'run', 'tests/deployment-evidence.test.ts'])
  : 'NOT_RUN';
const lintStatus = dependencyStatus === 'PASS'
  ? runStage('target-lint', 'npx', ['eslint', 'lib/deployment-evidence/types.ts', 'tests/deployment-evidence.test.ts'])
  : 'NOT_RUN';
const buildStatus = dependencyStatus === 'PASS'
  ? runStage('production-build', 'npm', ['run', 'build'])
  : 'NOT_RUN';

const statuses = [
  contract.status,
  dependencyStatus,
  scriptStatus,
  linkerStatus,
  testStatus,
  lintStatus,
  buildStatus,
];
const overall = statuses.every((status) => status === 'PASS') ? 'PASS' : 'FAIL';
const failureCategory = contract.status === 'FAIL'
  ? 'CONTRACT_FAILED'
  : dependencyStatus === 'FAIL'
    ? 'DEPENDENCY_INSTALL_FAILED'
    : scriptStatus === 'FAIL' || linkerStatus === 'FAIL'
      ? 'SCRIPT_SYNTAX_FAILED'
      : testStatus === 'FAIL'
        ? 'TEST_FAILED'
        : lintStatus === 'FAIL'
          ? 'LINT_FAILED'
          : buildStatus === 'FAIL'
            ? 'BUILD_FAILED'
            : 'NONE';

appendOutput('status', overall);
appendOutput('failure_category', failureCategory);
appendOutput('contract_status', contract.status);
appendOutput('contract_violation_count', String(contract.count));
appendOutput('dependency_status', dependencyStatus);
appendOutput('test_status', testStatus);
appendOutput('lint_status', lintStatus);
appendOutput('build_status', buildStatus);
console.log(`PMAI_NETLIFY_MCP_DEV status=${overall} category=${failureCategory} contract=${contract.status} dependencies=${dependencyStatus} test=${testStatus} lint=${lintStatus} build=${buildStatus}`);
process.exitCode = overall === 'PASS' ? 0 : 1;
