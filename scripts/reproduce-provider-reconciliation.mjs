/** Read an interrupted plan copy; compare validation and recover it in memory without any agent call. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const database = resolve(process.argv[2] ?? '/tmp/capivara-plan-provider-before-20261028/project.sqlite');
const baseline = process.argv[3] ?? 'fc5f1da';
const output = resolve(root, process.argv[4] ?? 'docs/rc2-evidence/provider-reconciliation.json');
const sha = value => createHash('sha256').update(value).digest('hex');
const temporary = await mkdtemp(join(tmpdir(), 'capivara-provider-reconciliation-'));
const canonical = value => value.normalize('NFKD').toLowerCase().trim();
const sameBinding = (left, right) => left && right && ['capability', 'kind', 'provider'].every(key => canonical(left[key]) === canonical(right[key]));
function command(binary, args, options = {}) {
  const result = spawnSync(binary, args, { cwd: root, maxBuffer: 32 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`${binary}: ${String(result.stderr)}`);
  return result.stdout;
}
async function api(source, label) {
  const file = join(temporary, `${label}.mjs`);
  await build({ entryPoints: [join(source, 'packages/core/src/domain/index.ts')], outfile: file, bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external', logLevel: 'silent' });
  return import(pathToFileURL(file).href);
}

try {
  const databaseHash = sha(await readFile(database));
  const db = new DatabaseSync(database, { readOnly: true });
  let project, eventCount;
  try {
    db.exec('BEGIN');
    project = JSON.parse(db.prepare('SELECT body FROM project WHERE id=1').get().body);
    eventCount = db.prepare('SELECT count(*) AS count FROM events').get().count;
    db.exec('ROLLBACK');
  } finally { db.close(); }
  assert.ok(project.brief && project.plan, 'The read-only copy must contain a brief and a partial plan.');
  assert.equal(!!project.execution, false, 'This fixture concerns planning, before task execution.');
  const sourceBefore = join(temporary, 'before'); await mkdir(sourceBefore);
  command('tar', ['-x', '-C', sourceBefore], { input: command('git', ['archive', baseline, 'packages/core/src']) });
  const before = await api(sourceBefore, 'before'), after = await api(root, 'after');
  const initialIssues = before.validatePlan(project.brief, project.plan);
  assert.ok(initialIssues.some(issue => issue.code === 'unused-mandatory-provider'), 'The original provider linkage failure must reproduce.');

  const requests = [], saved = [];
  const ready = await after.runPlan({
    brief: structuredClone(project.brief), existing: structuredClone(project.plan), contextChars: 24_000,
    agent: async request => { requests.push({ operation: request.operation, promptSHA256: sha(request.prompt) }); throw new Error('No agent request is allowed in this deterministic provider reconciliation.'); },
    save: async patch => { if (patch.plan) saved.push({ status: patch.plan.status, tasks: patch.plan.tasks.length, environment: patch.plan.environment.length }); },
  });
  assert.equal(requests.length, 0); assert.equal(ready.status, 'ready'); assert.equal(ready.tasks.length, 7);
  assert.deepEqual(after.validatePlan(project.brief, ready), []);
  const covered = [...new Set(ready.tasks.flatMap(task => task.requirementIds))];
  assert.equal(covered.length, project.brief.requirements.length); assert.equal(covered.length, 11);
  assert.deepEqual([...ready.tasks.map(task => task.id)].sort(), [...project.plan.tasks.map(task => task.id)].sort());
  for (const original of project.plan.tasks) {
    const task = ready.tasks.find(candidate => candidate.id === original.id);
    for (const field of ['goal', 'instructions', 'requirementIds', 'dependsOn', 'contractIds', 'files', 'criteria']) assert.deepEqual(task[field], original[field], `Product contract changed: ${original.id}.${field}`);
  }
  const environmentIds = new Set(ready.environment.map(node => node.id));
  assert.equal(environmentIds.size, ready.environment.length);
  assert.ok(ready.tasks.every(task => task.environmentIds.every(id => environmentIds.has(id))));
  assert.ok(ready.environment.every(node => node.dependsOn.every(id => environmentIds.has(id))));
  const bindings = project.brief.requirements.filter(requirement => requirement.binding).map(requirement => {
    const boundBefore = project.plan.environment.filter(node => sameBinding(node.identity, requirement.binding));
    const oldConsumers = project.plan.environment.filter(node => !node.identity && project.plan.tasks.some(task => task.environmentIds.includes(node.id)) && boundBefore.some(bound => bound.kind === node.kind && canonical(bound.name) === canonical(node.name) && JSON.stringify(bound.check) === JSON.stringify(node.check)));
    assert.equal(oldConsumers.length, 1, 'This fixture requires an unambiguous already-consumed provider.');
    const matches = ready.environment.filter(node => sameBinding(node.identity, requirement.binding));
    assert.equal(matches.length, 1); assert.equal(matches[0].id, oldConsumers[0].id);
    assert.ok(ready.tasks.some(task => task.environmentIds.includes(matches[0].id)));
    return { requirementId: requirement.id, provider: requirement.binding.provider, stableId: matches[0].id, previousDuplicateIds: boundBefore.map(node => node.id), matchingProvidersAfter: matches.length, consumed: true };
  });
  const mandatoryBefore = (project.plan.acceptance ?? []).filter(check => check.conformance);
  for (const original of mandatoryBefore) {
    const check = ready.acceptance?.find(candidate => candidate.id === original.id);
    assert.ok(check, `Mandatory acceptance disappeared: ${original.id}`);
    for (const field of ['command', 'args', 'conformance', 'requirementIds', 'level']) assert.deepEqual(check[field], original[field]);
    assert.deepEqual(after.verificationAssertionStatus(check), after.verificationAssertionStatus(original));
  }
  assert.ok(mandatoryBefore.length > 0);
  assert.equal(sha(await readFile(database)), databaseHash, 'The input database changed.');
  const sources = await Promise.all(['domain/plan.ts', 'domain/reconcile.ts', 'domain/types.ts', 'app/workflow.ts', 'app/store.ts'].map(async path => ({ path: `packages/core/src/${path}`, sha256: sha(await readFile(join(root, 'packages/core/src', path))) })));
  const calls = Object.values(project.domainCalls ?? {});
  const report = {
    schema: 'capivara/provider-reconciliation-comparison/1', generatedAt: new Date().toISOString(),
    input: { databaseSHA256: databaseHash, eventCount, status: project.status, stage: project.stage, hasExecution: !!project.execution, recordedCalls: calls.length, completedCalls: calls.filter(call => call.status === 'complete').length, tasks: project.plan.tasks.length, requirements: project.brief.requirements.length, environmentNodes: project.plan.environment.length },
    baseline: { commit: command('git', ['rev-parse', baseline], { encoding: 'utf8' }).trim(), issues: initialIssues, scope: 'Validation of the saved plan; the baseline planner would re-extract the plan.' },
    after: { sourceSHA256: sha(JSON.stringify(sources)), sources, status: ready.status, taskIds: ready.tasks.map(task => task.id), tasks: ready.tasks.length, coveredRequirements: covered.length, environmentNodes: ready.environment.length, bindings, issues: [], productContractsPreserved: true, mandatoryAcceptanceIds: mandatoryBefore.map(check => check.id), mandatoryAcceptancePreserved: true, environmentReferencesValid: true, checkpoints: saved },
    safety: { paidInferenceCalls: 0, agentRequests: requests.length, productCommands: 0, projectWrites: 0, databaseUnchanged: true, realExecutionResumed: false },
  };
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output, baselineIssue: 'unused-mandatory-provider', status: ready.status, tasks: ready.tasks.length, requirements: covered.length, bindings, agentRequests: requests.length, databaseUnchanged: true, productExecuted: false }));
} finally { await rm(temporary, { recursive: true, force: true }); }
