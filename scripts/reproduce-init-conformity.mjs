/** Replay paid answers from private copies; an optional, clearly labelled synthetic repair has no model. */
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
const args = process.argv.slice(2);
const syntheticRepair = args.includes('--synthetic-repair');
if (syntheticRepair) args.splice(args.indexOf('--synthetic-repair'), 1);
const cacheOption = args.indexOf('--cache-db');
const cacheDatabase = cacheOption >= 0 ? resolve(args.splice(cacheOption, 2)[1]) : undefined;
assert.ok(!(syntheticRepair && cacheDatabase), 'Synthetic and observed repair metadata are separate evidence modes.');
const database = resolve(args[0] ?? '/tmp/capivara-init-before-20261028/project.sqlite');
const baseline = args[1] ?? '6f6a728';
const output = resolve(root, args[2] ?? `docs/rc2-evidence/init-conformity${syntheticRepair ? '-fixture' : ''}.json`);
const temporary = await mkdtemp(join(tmpdir(), 'capivara-init-conformity-'));
const sha = value => createHash('sha256').update(value).digest('hex');
function command(binary, args, options = {}) {
  const result = spawnSync(binary, args, { cwd: root, maxBuffer: 32 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`${binary}: ${String(result.stderr)}`);
  return result.stdout;
}
async function api(source, label) {
  const entry = join(temporary, `${label}-entry.mjs`), file = join(temporary, `${label}.mjs`);
  await writeFile(entry, `export {runWorkflow} from ${JSON.stringify(join(source, 'packages/core/src/app/workflow.ts'))};\nexport {ProjectStore} from ${JSON.stringify(join(source, 'packages/core/src/app/store.ts'))};\n`);
  await build({ entryPoints: [entry], outfile: file, bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external', logLevel: 'silent' });
  return import(pathToFileURL(file).href);
}

try {
  const databaseBytes = await readFile(database), databaseHash = sha(databaseBytes);
  const db = new DatabaseSync(database, { readOnly: true }); let project, rows;
  try {
    db.exec('BEGIN');
    project = JSON.parse(db.prepare('SELECT body FROM project WHERE id=1').get().body);
    rows = db.prepare('SELECT id,at,type,body FROM events ORDER BY id').all();
    db.exec('ROLLBACK');
  } finally { db.close(); }
  const calls = Object.entries(project.domainCalls ?? {});
  assert.equal(calls.length, 1); const [callKey, call] = calls[0];
  assert.equal(call.operation, 'discover'); assert.equal(call.status, 'complete');
  const discovery = JSON.parse(call.result);
  const stackIndex = discovery.requirements.findIndex(requirement => requirement.kind === 'stack');
  assert.ok(stackIndex >= 0);
  let cachedProject, cacheHash, cachedEvents;
  if (cacheDatabase) {
    cacheHash = sha(await readFile(cacheDatabase));
    const cache = new DatabaseSync(cacheDatabase, { readOnly: true });
    try {
      cachedProject = JSON.parse(cache.prepare('SELECT body FROM project WHERE id=1').get().body);
      cachedEvents = cache.prepare('SELECT id,at,type,body FROM events ORDER BY id').all();
    }
    finally { cache.close(); }
    assert.equal(cachedProject.request, project.request);
    assert.deepEqual(cachedProject.config, project.config);
    assert.equal(cachedProject.domainCalls?.[callKey]?.result, call.result);
    assert.ok(Object.values(cachedProject.domainCalls).some(record => record.operation === 'repair' && record.status === 'complete'));
  }
  const sourceBefore = join(temporary, 'before'); await mkdir(sourceBefore);
  command('tar', ['-x', '-C', sourceBefore], { input: command('git', ['archive', baseline, 'packages/core/src']) });
  const index = await readFile(join(dirname(database), 'input-index.json'));
  const results = {};
  for (const [label, source] of [['before', sourceBefore], ['after', root]]) {
    const engine = await api(source, label), workspace = join(temporary, `${label}-workspace`);
    await mkdir(join(workspace, '.capivara-next'), { recursive: true, mode: 0o700 });
    await writeFile(join(workspace, '.capivara-next/project.sqlite'), databaseBytes, { mode: 0o600 });
    await mkdir(join(workspace, '.project-inputs'), { mode: 0o700 });
    await writeFile(join(workspace, '.project-inputs/index.json'), index, { mode: 0o600 });
    if (label === 'after' && cachedProject) {
      const seed = new engine.ProjectStore(workspace);
      try { seed.update({ domainCalls: cachedProject.domainCalls }); }
      finally { seed.close(); }
    }
    let modelRequests = 0, interviewRequests = 0;
    const result = await engine.runWorkflow({
      workspace, stage: 'init', request: project.request, documents: project.dataCenter?.documents ?? [], config: project.config,
      signal: AbortSignal.timeout(5000),
      agent: async request => {
        modelRequests++;
        if (!syntheticRepair || label !== 'after' || modelRequests !== 1 || request.role !== 'planner' || !request.readOnly) throw new Error('New inference is forbidden in this reproduction.');
        // Synthetic metadata exercises the engine; it is not a saved paid response or proof of live recovery.
        return { status: 'complete', text: JSON.stringify({ requirements: [{ index: stackIndex, quote: discovery.requirements[stackIndex].quote, bindings: [
          { capability: 'runtime', kind: 'runtime', provider: 'Node.js' },
          { capability: 'compiler', kind: 'sdk', provider: 'TypeScript' },
          { capability: 'ui-library', kind: 'library', provider: 'React' },
          { capability: 'build-tool', kind: 'sdk', provider: 'Vite' },
          { capability: 'database', kind: 'library', provider: 'SQLite' },
        ] }] }), commands: [], changedFiles: [] };
      },
      ask: async () => { interviewRequests++; throw new Error('The recorded discovery contains no pending product question.'); },
    });
    const store = new engine.ProjectStore(workspace); let saved, newEvents;
    try { saved = store.read(); newEvents = store.eventsAfter(rows.at(-1).id).map(row => ({ ...row, detail: JSON.parse(row.body) })); }
    finally { store.close(); }
    const reuses = newEvents.filter(event => event.type === 'reuse');
    assert.equal(modelRequests, syntheticRepair && label === 'after' ? 1 : 0); assert.equal(interviewRequests, 0);
    assert.ok(reuses.some(event => event.detail.detail.key === callKey));
    assert.equal(!!saved.execution, false);
    results[label] = { status: result.status, brief: result.brief, lastFailure: saved.lastFailure, modelRequests, interviewRequests, reusedCallKey: callKey, reusedCalls: reuses.map(event => event.detail.detail.key), hasExecution: !!saved.execution };
  }
  assert.equal(results.before.status, 'waiting'); assert.match(results.before.lastFailure.message, /init-conformity/);
  assert.equal(results.after.status, 'complete'); assert.equal(results.after.brief.status, 'ready');
  const brief = results.after.brief;
  const semanticOutcomes = discovery.requirements.filter(requirement => requirement.kind !== 'stack');
  const acceptedOutcomes = [...brief.requirements, ...brief.constraints];
  assert.ok(discovery.requirements.every(original => acceptedOutcomes.some(requirement => requirement.statement === original.statement)), 'A discovery outcome was silently discarded.');
  assert.ok(brief.requirements.every(requirement => project.request.includes(requirement.source.text)), 'A requirement has no literal source.');
  const stack = brief.requirements.filter(requirement => requirement.kind === 'stack');
  const bindings = stack.flatMap(requirement => [...(requirement.bindings ?? []), ...(requirement.binding ? [requirement.binding] : [])].map(binding => ({ requirementId: requirement.id, ...binding })));
  for (const provider of ['Node.js', 'TypeScript', 'React', 'Vite', 'SQLite']) assert.ok(bindings.some(binding => binding.provider.includes(provider)), `Mandatory technology lost: ${provider}`);
  const started = rows.find(row => row.type === 'agent.start'), completed = rows.find(row => row.type === 'agent.result');
  const usage = JSON.parse(completed.body).detail.usage;
  const sourceFiles = ['domain/init.ts', 'domain/literal-source.ts', 'domain/authority.ts', 'domain/types.ts', 'domain/plan.ts', 'domain/reconcile.ts', 'app/workflow.ts', 'app/store.ts'];
  const sources = await Promise.all(sourceFiles.map(async path => ({ path: `packages/core/src/${path}`, sha256: sha(await readFile(join(root, 'packages/core/src', path))) })));
  assert.equal(sha(await readFile(database)), databaseHash);
  if (cacheDatabase) assert.equal(sha(await readFile(cacheDatabase)), cacheHash);
  const recordedRepairs = cachedProject ? Object.entries(cachedProject.domainCalls).filter(([, record]) => record.operation === 'repair' && record.status === 'complete').map(([key, record]) => {
    const response = JSON.parse(record.result);
    const rawBindings = (response.requirements ?? []).flatMap(requirement => requirement.bindings ?? (requirement.binding ? [requirement.binding] : []));
    const groups = new Map();
    for (const binding of rawBindings) {
      const identity = JSON.stringify([binding.provider.toLowerCase(), binding.kind]);
      const grouped = groups.get(identity) ?? []; grouped.push(binding); groups.set(identity, grouped);
    }
    const start = cachedEvents.find(row => row.type === 'agent.start' && JSON.parse(row.body).detail?.id === record.invocationId);
    const end = cachedEvents.find(row => row.type === 'agent.result' && JSON.parse(row.body).detail?.id === record.invocationId);
    return {
      key, resultSHA256: sha(record.result), rawBindingCount: rawBindings.length, providerKindCount: groups.size,
      duplicateProviderKinds: [...groups.values()].filter(group => group.length > 1).map(group => ({ provider: group[0].provider, kind: group[0].kind, capabilityLabels: group.map(binding => binding.capability) })),
      ...(start && end ? { observedCost: { start: start.at, end: end.at, elapsedMs: Date.parse(end.at) - Date.parse(start.at), ...JSON.parse(end.body).detail.usage, financialCostReported: false } } : {}),
    };
  }) : [];
  const report = {
    schema: 'capivara/init-conformity-comparison/1', generatedAt: new Date().toISOString(),
    mode: syntheticRepair ? 'synthetic metadata fixture; no claim of zero-call live recovery' : 'only previously recorded model responses; all new inference forbidden',
    input: { databaseSHA256: databaseHash, eventCount: rows.length, status: project.status, stage: project.stage, recordedCalls: calls.length, completeCalls: 1, rawRequirements: discovery.requirements.length, rawLiteralQuotes: discovery.requirements.filter(requirement => project.request.includes(requirement.quote ?? '')).length, rawStackHasBinding: discovery.requirements.some(requirement => requirement.kind === 'stack' && !!requirement.binding), pendingQuestions: discovery.questions?.length ?? 0 },
    observedCost: { start: started.at, end: completed.at, elapsedMs: Date.parse(completed.at) - Date.parse(started.at), ...usage, financialCostReported: false },
    baseline: { commit: command('git', ['rev-parse', baseline], { encoding: 'utf8' }).trim(), status: results.before.status, failure: results.before.lastFailure.message, newModelRequests: 0, reusedCallKey: callKey },
    after: { sourceSHA256: sha(JSON.stringify(sources)), sources, status: results.after.status, briefStatus: brief.status, requirements: brief.requirements.length, originalOutcomesPreserved: discovery.requirements.length, semanticOutcomesPreserved: semanticOutcomes.length, literalSourcesVerified: true, bindings, modelAdapterRequests: results.after.modelRequests, syntheticRepairRequests: syntheticRepair ? results.after.modelRequests : 0, interviewRequests: 0, reusedCalls: results.after.reusedCalls, hasExecution: false },
    ...(cacheDatabase ? { recordedRepairCache: { databaseSHA256: cacheHash, snapshotRequirements: cachedProject.brief?.requirements.length, completeRepairResponses: recordedRepairs.length, responses: recordedRepairs } } : {}),
    safety: { reproductionPaidInferenceCalls: 0, productCommands: 0, realProjectWrites: 0, databaseUnchanged: true, writesRestrictedToTemporaryWorkspacesAndReport: true, planOrBuildExecuted: false, liveRecoveryDemonstrated: false },
  };
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output, mode: report.mode, before: results.before.status, after: results.after.status, requirements: brief.requirements.length, semanticOutcomesPreserved: semanticOutcomes.length, bindings, modelAdapterRequests: results.after.modelRequests, reusedCalls: results.after.reusedCalls, realProjectWrites: 0, buildExecuted: false }));
} finally { await rm(temporary, { recursive: true, force: true }); }
