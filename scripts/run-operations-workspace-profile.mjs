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
  console.log('PMAI_OPERATIONS_WORKSPACE status=FAIL category=PROFILE_ENVIRONMENT_INVALID');
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
  'public/workspace/index.html',
  'public/workspace/operations-remediation-v1.css',
  'public/workspace/operations-remediation-v1.js',
  'tests/operations-remediation-v1.test.ts',
]);

async function runContractChecks() {
  const violations = [];
  const changedFiles = git(['diff', '--name-only', baseSha, exactSha])
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();

  if (JSON.stringify(changedFiles) !== JSON.stringify([...expectedFiles].sort())) {
    violations.push('EXACT_OPERATIONS_SCOPE_MISMATCH');
  }
  for (const relativePath of expectedFiles) {
    if (!existsSync(path.join(repo, relativePath))) violations.push('REQUIRED_FILE_MISSING');
  }

  const html = await readFile(path.join(repo, 'public/workspace/index.html'), 'utf8');
  const script = await readFile(path.join(repo, 'public/workspace/operations-remediation-v1.js'), 'utf8');
  const css = await readFile(path.join(repo, 'public/workspace/operations-remediation-v1.css'), 'utf8');
  const test = await readFile(path.join(repo, 'tests/operations-remediation-v1.test.ts'), 'utf8');

  if (!html.includes('Human + Agent Operations')) violations.push('OPERATIONS_POSITIONING_MISSING');
  if (!html.includes('operations-remediation-v1.css')) violations.push('OPERATIONS_CSS_NOT_MOUNTED');
  if (!html.includes('operations-remediation-v1.js')) violations.push('OPERATIONS_SCRIPT_NOT_MOUNTED');
  if (!(html.indexOf('app-v2.js') < html.indexOf('operations-remediation-v1.js'))) {
    violations.push('TRUTH_RENDERER_ORDER_INVALID');
  }
  if (!script.includes('draft_only · formalBusinessWritePerformed=false')) {
    violations.push('DRAFT_ONLY_BOUNDARY_MISSING');
  }
  if (!script.includes('不会创建 Work Item、Decision、Approval、Execution Authorization')) {
    violations.push('FORMAL_OWNER_BOUNDARY_MISSING');
  }
  if (!script.includes('不会启动 Codex、合并 PR、部署或写数据库')) {
    violations.push('EXECUTION_BOUNDARY_MISSING');
  }
  if (/fetch\s*\(|XMLHttpRequest|WebSocket/.test(script)) violations.push('NETWORK_SURFACE_EXPOSED');
  if (/service[_-]?role|SUPABASE_SERVICE_ROLE_KEY/i.test([html, script, css, test].join('\n'))) {
    violations.push('PRIVILEGED_CREDENTIAL_SURFACE_EXPOSED');
  }
  if (/gh\s+pr\s+merge|vercel\s+--prod|netlify\s+deploy\s+--prod|supabase\s+db\s+push/i.test(script)) {
    violations.push('FORMAL_EXECUTION_COMMAND_EXPOSED');
  }
  if (!css.includes('.pmai-ops-drawer')) violations.push('OPERATIONS_DRAWER_STYLE_MISSING');
  if (!test.includes('keeps Ask PMAI proposal-only')) violations.push('PROPOSAL_ONLY_TEST_MISSING');

  writeFileSync(path.join(rawDir, 'operations-workspace-contracts.raw'), violations.join('\n'), {
    encoding: 'utf8',
    mode: 0o600,
  });
  return { status: violations.length === 0 ? 'PASS' : 'FAIL', count: violations.length };
}

let contract = { status: 'FAIL', count: 1 };
try {
  contract = await runContractChecks();
} catch {
  writeFileSync(path.join(rawDir, 'operations-workspace-contracts.raw'), 'CONTRACT_CHECK_EXCEPTION', {
    encoding: 'utf8',
    mode: 0o600,
  });
}

const dependencyStatus = contract.status === 'PASS'
  ? runStage('dependency-install', 'npm', ['install', '--no-audit', '--no-fund'])
  : 'NOT_RUN';
const testStatus = dependencyStatus === 'PASS'
  ? runStage('focused-tests', 'npx', [
      'vitest', 'run',
      'tests/operations-remediation-v1.test.ts',
      'tests/workspace-chatgpt-truth-cutover.test.ts',
      'tests/workspace-interactions.test.ts',
      'tests/workspace-static-javascript-syntax.test.ts',
    ])
  : 'NOT_RUN';
const lintStatus = dependencyStatus === 'PASS'
  ? runStage('repository-lint', 'npm', ['run', 'lint'])
  : 'NOT_RUN';
const typecheckStatus = dependencyStatus === 'PASS'
  ? runStage('strict-typecheck', 'npx', ['tsc', '--noEmit'])
  : 'NOT_RUN';
const buildStatus = dependencyStatus === 'PASS'
  ? runStage('production-build', 'npm', ['run', 'build'])
  : 'NOT_RUN';

const statuses = [
  contract.status,
  dependencyStatus,
  testStatus,
  lintStatus,
  typecheckStatus,
  buildStatus,
];
const overall = statuses.every((status) => status === 'PASS') ? 'PASS' : 'FAIL';
const failureCategory = contract.status === 'FAIL'
  ? 'CONTRACT_FAILED'
  : dependencyStatus === 'FAIL'
    ? 'DEPENDENCY_INSTALL_FAILED'
    : testStatus === 'FAIL'
      ? 'TEST_FAILED'
      : lintStatus === 'FAIL'
        ? 'LINT_FAILED'
        : typecheckStatus === 'FAIL'
          ? 'TYPECHECK_FAILED'
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
appendOutput('typecheck_status', typecheckStatus);
appendOutput('build_status', buildStatus);
console.log(`PMAI_OPERATIONS_WORKSPACE status=${overall} category=${failureCategory} contract=${contract.status} dependencies=${dependencyStatus} test=${testStatus} lint=${lintStatus} typecheck=${typecheckStatus} build=${buildStatus}`);
process.exitCode = overall === 'PASS' ? 0 : 1;
