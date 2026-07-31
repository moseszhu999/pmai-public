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
  '.env.example',
  '.github/workflows/engineering-director-ci.yml',
  'app/api/integrations/agents/mcp/route.ts',
  'docs/agent-native/v1/pmai-mcp-gateway-v1.md',
  'lib/pmai-agent-gateway/client.ts',
  'lib/pmai-agent-gateway/context.ts',
  'lib/pmai-agent-gateway/http.ts',
  'lib/pmai-agent-gateway/mcp-server.ts',
  'tests/pmai-mcp-gateway.test.ts',
]);

async function runContractChecks() {
  const violations = [];
  const changedFiles = git(['diff', '--name-only', baseSha, exactSha])
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();

  if (JSON.stringify(changedFiles) !== JSON.stringify([...expectedFiles].sort())) {
    violations.push('EXACT_MCP_GATEWAY_SCOPE_MISMATCH');
  }
  for (const relativePath of expectedFiles) {
    if (!existsSync(path.join(repo, relativePath))) violations.push('REQUIRED_FILE_MISSING');
  }

  const route = await readFile(path.join(repo, 'app/api/integrations/agents/mcp/route.ts'), 'utf8');
  const context = await readFile(path.join(repo, 'lib/pmai-agent-gateway/context.ts'), 'utf8');
  const http = await readFile(path.join(repo, 'lib/pmai-agent-gateway/http.ts'), 'utf8');
  const server = await readFile(path.join(repo, 'lib/pmai-agent-gateway/mcp-server.ts'), 'utf8');
  const test = await readFile(path.join(repo, 'tests/pmai-mcp-gateway.test.ts'), 'utf8');
  const workflow = await readFile(path.join(repo, '.github/workflows/engineering-director-ci.yml'), 'utf8');
  const combined = [route, context, http, server, test].join('\n');

  if (!route.includes('export async function POST')) violations.push('MCP_POST_ROUTE_MISSING');
  if (!route.includes('export async function OPTIONS')) violations.push('MCP_OPTIONS_ROUTE_MISSING');
  if (!context.includes('timingSafeEqual')) violations.push('TIMING_SAFE_TOKEN_COMPARE_MISSING');
  if (/supplied\s*===\s*configuration\.agentToken/.test(context)) violations.push('PLAIN_TOKEN_COMPARE_PRESENT');
  if (!server.includes('readOnlyHint: true')) violations.push('READ_ONLY_ANNOTATION_MISSING');
  if (!server.includes('destructiveHint: false')) violations.push('NON_DESTRUCTIVE_ANNOTATION_MISSING');
  for (const name of ['get_my_identity', 'get_portfolio_status', 'inspect_project', 'list_attention_items']) {
    if (!server.includes(`name: "${name}"`)) violations.push('REQUIRED_READ_TOOL_MISSING');
  }
  if (!server.includes('formalApplicationEnabled: false')) violations.push('FORMAL_APPLICATION_GUARD_MISSING');
  if (!server.includes('productionDeploymentEnabled: false')) violations.push('PRODUCTION_DEPLOYMENT_GUARD_MISSING');
  if (!http.includes('DEPLOY_PRIME_URL')) violations.push('NETLIFY_ORIGIN_SUPPORT_MISSING');
  if (http.includes('VERCEL_URL') || http.includes('VERCEL_BRANCH_URL')) violations.push('VERCEL_ACTIVE_SCOPE_PRESENT');
  if (!workflow.includes('LEGACY_DIAGNOSTIC')) violations.push('PRIVATE_CI_CLASSIFICATION_MISSING');
  if (!test.includes('rejects unknown write tools')) violations.push('WRITE_TOOL_DENIAL_TEST_MISSING');

  const forbidden = [
    /PMAI_WRITE_TOKEN/,
    /SUPABASE_SERVICE_ROLE_KEY/,
    /child_process/,
    /\bgh\s+pr\s+merge\b/i,
    /\bpsql\b/i,
    /\bsupabase\s+db\b/i,
    /netlify\s+deploy\s+--prod/i,
    /vercel\s+(?:deploy\s+)?--prod/i,
  ];
  if (forbidden.some((pattern) => pattern.test(combined))) violations.push('FORMAL_OR_RAW_EXECUTION_SURFACE_PRESENT');

  writeFileSync(path.join(rawDir, 'mcp-gateway-contracts.raw'), violations.join('\n'), {
    encoding: 'utf8',
    mode: 0o600,
  });
  return { status: violations.length === 0 ? 'PASS' : 'FAIL', count: violations.length };
}

let contract = { status: 'FAIL', count: 1 };
try {
  contract = await runContractChecks();
} catch {
  writeFileSync(path.join(rawDir, 'mcp-gateway-contracts.raw'), 'CONTRACT_CHECK_EXCEPTION', {
    encoding: 'utf8',
    mode: 0o600,
  });
}

const dependencyStatus = contract.status === 'PASS'
  ? runStage('dependency-install', 'npm', ['install', '--no-audit', '--no-fund'])
  : 'NOT_RUN';
const testStatus = dependencyStatus === 'PASS'
  ? runStage('focused-test', 'npx', ['vitest', 'run', 'tests/pmai-mcp-gateway.test.ts'])
  : 'NOT_RUN';
const lintStatus = dependencyStatus === 'PASS'
  ? runStage('target-lint', 'npx', [
      'eslint',
      'lib/pmai-agent-gateway',
      'app/api/integrations/agents/mcp',
      'tests/pmai-mcp-gateway.test.ts',
    ])
  : 'NOT_RUN';
const typecheckStatus = dependencyStatus === 'PASS'
  ? runStage('typecheck', 'npx', ['tsc', '--noEmit', '--incremental', 'false'])
  : 'NOT_RUN';
const buildStatus = dependencyStatus === 'PASS'
  ? runStage('production-build', 'npm', ['run', 'build'])
  : 'NOT_RUN';

const statuses = [contract.status, dependencyStatus, testStatus, lintStatus, typecheckStatus, buildStatus];
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
console.log(`PMAI_MCP_GATEWAY_READONLY status=${overall} category=${failureCategory}`);
process.exitCode = overall === 'PASS' ? 0 : 1;
