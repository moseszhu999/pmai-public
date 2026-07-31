import { appendFileSync, closeSync, existsSync, openSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function appendOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, 'utf8');
}

const repo = process.env.PRIVATE_REPO_PATH ?? '';
const runnerTemp = process.env.RUNNER_TEMP ?? '';
if (!repo || !runnerTemp) {
  appendOutput('status', 'FAIL');
  appendOutput('failure_category', 'PROFILE_ENVIRONMENT_INVALID');
  console.log('PMAI_CANONICAL_BASELINE status=FAIL category=PROFILE_ENVIRONMENT_INVALID');
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

async function sourceFiles(root) {
  if (!existsSync(root)) return [];
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...await sourceFiles(candidate));
    else if (/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) output.push(candidate);
  }
  return output;
}

async function runBoundaryScan() {
  const roots = [
    'app/api/agent',
    'app/api/integrations/agents',
    'lib/pmai-agent-gateway',
    'supabase/functions/pmai-engineering-director-v1',
    'supabase/functions/pmai-engineering-director-gpt-v1',
  ];
  const violations = [];

  for (const relativeRoot of roots) {
    for (const absoluteFile of await sourceFiles(path.join(repo, relativeRoot))) {
      const relativeFile = path.relative(repo, absoluteFile).replaceAll('\\\\', '/');
      const content = await readFile(absoluteFile, 'utf8');
      const agentSurface = relativeFile.startsWith('app/api/agent/')
        || relativeFile.startsWith('app/api/integrations/agents/')
        || relativeFile.startsWith('lib/pmai-agent-gateway/');

      if (/PMAI_AGENT_TOKEN[\s\S]{0,180}\?\?[\s\S]{0,180}PMAI_WRITE_TOKEN/.test(content)) {
        violations.push(`${relativeFile}:AGENT_WRITE_TOKEN_FALLBACK`);
      }
      if (agentSurface && /SUPABASE_SERVICE_ROLE_KEY/.test(content)) {
        violations.push(`${relativeFile}:DIRECT_SERVICE_ROLE_REFERENCE`);
      }
      if (agentSurface && /PMAI_WRITE_TOKEN/.test(content)) {
        violations.push(`${relativeFile}:GENERIC_WRITE_TOKEN_REFERENCE`);
      }
      if (agentSurface && /\b(?:github_api|run_gh_cli|run_shell|execute_sql)\b/.test(content)) {
        violations.push(`${relativeFile}:RAW_EXECUTION_TOOL`);
      }
      if (agentSurface && /(?:gh\s+pr\s+merge|vercel\s+--prod|netlify\s+deploy\s+--prod|supabase\s+functions\s+deploy)/i.test(content)) {
        violations.push(`${relativeFile}:FORMAL_EXECUTION_COMMAND`);
      }
    }
  }

  const rawPath = path.join(rawDir, 'boundary-scan.raw');
  writeFileSync(rawPath, violations.join('\n'), { encoding: 'utf8', mode: 0o600 });
  return { status: violations.length === 0 ? 'PASS' : 'FAIL', count: violations.length };
}

const boundary = await runBoundaryScan();
const dependencyStatus = runStage('dependency-install', 'npm', ['install', '--no-audit', '--no-fund']);
const testStatus = dependencyStatus === 'PASS'
  ? runStage('test', 'npm', ['test'])
  : 'NOT_RUN';

const lintTargets = [
  'lib/env.ts',
  'lib/engineering-director',
  'app/api/agent/v1',
  'app/ai-engineering',
  'tests/engineering-director-*.test.ts',
].filter((target) => target.includes('*') || existsSync(path.join(repo, target)));
const lintStatus = dependencyStatus === 'PASS'
  ? runStage('lint', 'npx', ['eslint', ...lintTargets])
  : 'NOT_RUN';
const buildStatus = dependencyStatus === 'PASS'
  ? runStage('build', 'npm', ['run', 'build'])
  : 'NOT_RUN';

const statuses = [boundary.status, dependencyStatus, testStatus, lintStatus, buildStatus];
const overall = statuses.every((status) => status === 'PASS') ? 'PASS' : 'FAIL';
const failureCategory = boundary.status === 'FAIL'
  ? 'CONTRACT_FAILED'
  : dependencyStatus === 'FAIL'
    ? 'DEPENDENCY_INSTALL_FAILED'
    : testStatus === 'FAIL'
      ? 'TEST_FAILED'
      : lintStatus === 'FAIL'
        ? 'LINT_FAILED'
        : buildStatus === 'FAIL'
          ? 'BUILD_FAILED'
          : 'NONE';

appendOutput('status', overall);
appendOutput('failure_category', failureCategory);
appendOutput('contract_status', boundary.status);
appendOutput('contract_violation_count', String(boundary.count));
appendOutput('dependency_status', dependencyStatus);
appendOutput('test_status', testStatus);
appendOutput('lint_status', lintStatus);
appendOutput('build_status', buildStatus);
console.log(`PMAI_CANONICAL_BASELINE status=${overall} category=${failureCategory} contract=${boundary.status} dependencies=${dependencyStatus} test=${testStatus} lint=${lintStatus} build=${buildStatus}`);
process.exitCode = overall === 'PASS' ? 0 : 1;
