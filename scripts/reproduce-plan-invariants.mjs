/** Reconcile the saved failed plan in memory; no inference or product execution. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const database = resolve(process.argv[2] ?? '/tmp/capivara-plan-invariants-before-20261028/project.sqlite');
const baseline = process.argv[3] ?? '83cb4a0';
const output = resolve(root, process.argv[4] ?? 'docs/rc2-evidence/plan-invariants.json');
const temporary = await mkdtemp(join(tmpdir(), 'capivara-plan-invariants-'));
const sha = value => createHash('sha256').update(value).digest('hex');
const unique = values => [...new Set(values)];
const stable = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
function command(binary, args, options = {}) {
  const result = spawnSync(binary, args, { cwd: root, maxBuffer: 32 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`${binary}: ${String(result.stderr)}`);
  return result.stdout;
}
async function api(source, label, registry = false) {
  const file = join(temporary, `${label}.mjs`);
  const entry = `export * from ${JSON.stringify(join(source, 'packages/core/src/domain/index.ts'))};${registry ? `export * from ${JSON.stringify(join(source, 'packages/core/src/domain/verifications.ts'))};export * from ${JSON.stringify(join(source, 'packages/core/src/domain/plan-records.ts'))};export {validateConformance} from ${JSON.stringify(join(source, 'packages/core/src/execution/conformance.ts'))};` : ''}`;
  await build({ stdin: { contents: entry, resolveDir: root }, outfile: file, bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external', logLevel: 'silent' });
  return import(pathToFileURL(file).href);
}
function executable(check) {
  const { id: _id, expected: _prose, requirementIds: _consumers, constraintIds: _constraints, conformance: _metadata, ...recipe } = check;
  return stable(recipe);
}

try {
  const databaseHash = sha(await readFile(database));
  const db = new DatabaseSync(database, { readOnly: true }); let project, events;
  try {
    db.exec('BEGIN');
    project = JSON.parse(db.prepare('SELECT body FROM project WHERE id=1').get().body);
    events = db.prepare('SELECT id,at,type,body FROM events ORDER BY id').all().map(row => ({ ...row, detail: JSON.parse(row.body) }));
    db.exec('ROLLBACK');
  } finally { db.close(); }
  assert.equal(!!project.execution, false);
  const oldSource = join(temporary, 'before'); await mkdir(oldSource);
  command('tar', ['-x', '-C', oldSource], { input: command('git', ['archive', baseline, 'packages/core/src']) });
  const before = await api(oldSource, 'before'), after = await api(root, 'after', true);
  const beforeIssues = before.validatePlan(project.brief, project.plan);
  const originalRegistry = after.verificationRegistry(project.plan);
  const nodeIssue = beforeIssues.find(issue => issue.code === 'unproven-mandatory-provider' && originalRegistry.some(({ taskId, check }) => taskId !== '$acceptance' && check.conformance?.requirementId === issue.subject));
  assert.ok(nodeIssue, 'Baseline must reject the recorded complete task-local provider claim.');
  const originalClaim = originalRegistry.find(({ taskId, check }) => taskId !== '$acceptance' && check.conformance?.requirementId === nodeIssue.subject);
  assert.equal(after.verificationAssertionStatus(originalClaim.check).status, 'ready');
  assert.ok(originalClaim.check.conformance.productInputs.length);
  const responses = Object.values(project.domainCalls).filter(record => record.status === 'complete' && typeof record.result === 'string').map(record => ({ operation: record.operation, result: record.result }));
  const recovered = after.rehydratePlanRecords(project.brief, project.plan, responses, after.normalizeChecks);
  assert.equal(recovered.restored.length, 2); assert.deepEqual(recovered.ambiguous, []);
  assert.deepEqual(project.plan.acceptance.find(check => check.id === originalClaim.check.id)?.conformance, undefined);
  const brief = structuredClone(project.brief), requests = [];
  const ready = await after.runPlan({ brief, existing: structuredClone(project.plan), contextChars: 24_000,
    completedResponses: () => responses,
    agent: async request => { requests.push({ operation: request.operation, promptSHA256: sha(request.prompt) }); throw new Error('A new inference request is forbidden in this reproduction.'); },
    ask: async () => { throw new Error('No product gap authorizes an interview in this reproduction.'); },
  });
  assert.equal(requests.length, 0); assert.equal(ready.status, 'ready');
  assert.equal(ready.tasks.length, 5); assert.equal(brief.requirements.length, 14);
  const registry = after.verificationRegistry(ready);
  assert.equal(ready.tasks.flatMap(task => task.checks).length, 10);
  assert.deepEqual(after.validatePlan(brief, ready), []);
  const covered = unique(ready.tasks.flatMap(task => task.requirementIds));
  assert.ok(brief.requirements.every(requirement => covered.includes(requirement.id)));
  const oldCriteria = project.plan.tasks.flatMap(task => task.criteria), criteria = new Set(ready.tasks.flatMap(task => task.criteria));
  assert.ok(oldCriteria.every(criterion => criteria.has(criterion)));
  for (const field of ['files', 'inputs']) {
    const current = new Set(ready.tasks.flatMap(task => task[field] ?? []));
    assert.ok(project.plan.tasks.flatMap(task => task[field] ?? []).every(path => current.has(path)), `Lost task ${field}.`);
  }
  for (const { check } of originalRegistry) {
    const matching = registry.filter(entry => entry.check.id === check.id && executable(entry.check) === executable(check));
    assert.ok(matching.length, `Lost or altered executable recipe: ${check.id}`);
    assert.ok(check.requirementIds.every(id => matching.some(entry => entry.check.requirementIds.includes(id))));
    if (check.conformance) assert.ok(matching.some(entry => stable(entry.check.conformance) === stable(check.conformance)), `Replaced an existing conformance contract: ${check.id}`);
  }
  const selected = registry.find(({ taskId, check }) => taskId !== '$acceptance' && check.id === originalClaim.check.id && check.conformance?.requirementId === nodeIssue.subject);
  assert.ok(selected); assert.equal(selected.taskId, 'task-rest-api');
  const empty = originalRegistry.find(({ taskId, check }) => taskId === '$acceptance' && check.id === selected.check.id);
  assert.ok(empty); assert.equal(empty.check.requirementIds.length, 0); assert.equal(!!empty.check.conformance, false);
  const restoredGlobal = registry.find(({ taskId, check }) => taskId === '$acceptance' && check.id === selected.check.id);
  assert.ok(restoredGlobal?.check.conformance); assert.ok(restoredGlobal.check.requirementIds.includes(nodeIssue.subject));
  const nodeRestoration = recovered.restored.find(entry => entry.taskId === '$acceptance' && entry.checkId === selected.check.id);
  assert.ok(nodeRestoration); assert.ok(responses.some(response => sha(response.result) === nodeRestoration.resultSHA256));
  const removed = structuredClone(ready);
  removed.tasks.find(task => task.id === selected.taskId).checks = removed.tasks.find(task => task.id === selected.taskId).checks.filter(check => check.id !== selected.check.id);
  removed.acceptance = removed.acceptance.map(check => check.id === selected.check.id ? structuredClone(empty.check) : check);
  const missingClaim = after.reconcilePlan(brief, removed);
  assert.deepEqual(after.validatePlan(brief, missingClaim), []);
  const pendingDebt = missingClaim.obligations.find(obligation => obligation.kind === 'provider' && obligation.requirementId === nodeIssue.subject);
  assert.equal(pendingDebt.recipeStatus, 'pending', 'An empty same-ID acceptance entry cannot count as a planned usage recipe.');
  assert.equal(pendingDebt.verification, 'required-in-build');
  // Synthetic readiness isolates the negative proof check. It is not a claim
  // that any provider was prepared or executed by this read-only reproduction.
  const assumedReady = { root: temporary, revision: 'negative-control-only', env: {}, bindings: Object.fromEntries(ready.environment.filter(node => node.identity).map(node => [node.id, { ...node.identity, ready: true }])) };
  const withoutEvidence = await after.validateConformance(brief, ready, assumedReady, [], temporary);
  assert.ok(withoutEvidence.some(issue => issue.requirementId === nodeIssue.subject), 'A ready plan with recipe metadata cannot certify an unexecuted product.');
  const absentClaim = await after.validateConformance({ ...brief, requirements: brief.requirements.filter(requirement => requirement.id === nodeIssue.subject) }, missingClaim, assumedReady, [], temporary);
  assert.ok(absentClaim.some(issue => issue.requirementId === nodeIssue.subject && issue.code === 'missing-conformance'), 'Pending debt must still be rejected by final conformance.');

  const starts = new Map(events.filter(event => event.type === 'agent.start').map(event => [event.detail.detail.id, event]));
  const ends = new Map(events.filter(event => event.type === 'agent.result').map(event => [event.detail.detail.id, event]));
  const metrics = {}, timeline = [], repeated = {};
  for (const [key, record] of Object.entries(project.domainCalls).sort(([, left], [, right]) => left.at.localeCompare(right.at))) {
    const start = starts.get(record.invocationId), end = ends.get(record.invocationId);
    assert.ok(start && end);
    const prompt = await readFile(join(dirname(database), 'calls', `${record.invocationId}.input.txt`), 'utf8');
    let operation = record.operation, issue;
    if (prompt.includes('Operation: init-requirement-metadata.')) operation = 'repair:init-metadata';
    else if (prompt.includes('\nInvariant: ')) {
      issue = JSON.parse(prompt.split('\nInvariant: ', 2)[1].split('\n', 1)[0]); operation = 'repair:plan-invariants';
      const topic = `${issue.code}:${issue.subject}`; repeated[topic] = (repeated[topic] ?? 0) + 1;
    }
    const elapsedMs = Date.parse(end.at) - Date.parse(start.at), usage = end.detail.detail.usage;
    const aggregate = metrics[operation] ??= { calls: 0, elapsedMs: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
    aggregate.calls++; aggregate.elapsedMs += elapsedMs;
    for (const field of ['inputTokens', 'cachedInputTokens', 'outputTokens']) aggregate[field] += usage?.[field] ?? 0;
    timeline.push({ key, invocationId: record.invocationId, operation, status: record.status, start: start.at, end: end.at, elapsedMs, usage, ...(issue ? { issue: { code: issue.code, subject: issue.subject } } : {}) });
  }
  assert.equal(metrics['repair:plan-invariants'].calls, 10);
  const changed = unique([...String(command('git', ['diff', '--name-only', baseline, '--', 'packages/core/src'], { encoding: 'utf8' })).trim().split('\n'), ...String(command('git', ['ls-files', '--others', '--exclude-standard', 'packages/core/src'], { encoding: 'utf8' })).trim().split('\n')].filter(Boolean)).sort();
  const sources = await Promise.all(changed.map(async path => ({ path, sha256: sha(await readFile(join(root, path))) })));
  assert.equal(sha(await readFile(database)), databaseHash);
  const report = {
    schema: 'capivara/plan-invariants-comparison/1', generatedAt: new Date().toISOString(),
    input: { databaseSHA256: databaseHash, eventCount: events.length, status: project.status, stage: project.stage, calls: timeline.length, requirements: project.brief.requirements.length, tasks: project.plan.tasks.length, environmentNodes: project.plan.environment.length, hasExecution: false },
    baseline: { commit: String(command('git', ['rev-parse', baseline], { encoding: 'utf8' })).trim(), issues: beforeIssues, taskLocalClaim: { taskId: originalClaim.taskId, checkId: originalClaim.check.id, requirementId: nodeIssue.subject, typedAssertionValid: true, productInputPathsDeclared: true } },
    after: { sourceSHA256: sha(stable(sources)), sources, status: ready.status, tasks: ready.tasks.length, taskIds: ready.tasks.map(task => task.id), coveredRequirements: covered.length, taskChecks: ready.tasks.flatMap(task => task.checks).length, acceptanceRecipes: ready.acceptance.length, registryEntries: registry.length, obligations: ready.obligations, preservedCriteria: oldCriteria.length, allTaskInputsAndOutputsPreserved: true, executableRecipesPreserved: originalRegistry.length, nodeClaim: { taskId: selected.taskId, previousTaskId: originalClaim.taskId, checkId: selected.check.id }, metadataRestorations: recovered.restored, ambiguousRestorations: recovered.ambiguous, previouslyEmptyAcceptanceEntry: { taskId: '$acceptance', checkId: empty.check.id, originalRequirementIds: 0, originalConformance: false, restoredRequirementIds: restoredGlobal.check.requirementIds, restoredConformance: restoredGlobal.check.conformance, sourceResultSHA256: nodeRestoration.resultSHA256, sourceIsOriginalPaidResponse: true, originalOrphanCannotReplaceQualifiedClaims: true, definitionOnlyNotExecutedProof: true }, negativeControls: { removedClaimDebt: pendingDebt, readinessAssumedOnlyForNegativeControl: true, executionReceipts: 0, unexecutedProductRejected: withoutEvidence.length > 0, missingClaimRejectedAtBuild: true }, issues: [], newAgentRequests: requests.length },
    observed: { metrics, repeatedIssues: repeated, timeline, financialCostReported: false, durationBasis: 'agent.start to agent.result; cached input is included in input tokens' },
    safety: { reproductionPaidInferenceCalls: 0, productCommands: 0, projectWrites: 0, databaseUnchanged: true, realPlanApplied: false, buildExecuted: false },
  };
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output, baselineIssue: nodeIssue.code, status: ready.status, tasks: ready.tasks.length, requirements: covered.length, taskChecks: report.after.taskChecks, acceptanceRecipes: ready.acceptance.length, registryEntries: registry.length, newAgentRequests: requests.length, nodeOwner: selected.taskId, criteriaPreserved: oldCriteria.length, recipesPreserved: originalRegistry.length, buildExecuted: false }));
} finally { await rm(temporary, { recursive: true, force: true }); }
