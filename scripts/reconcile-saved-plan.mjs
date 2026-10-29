/** Restore an unexecuted engineering plan through the current engine, retaining
 * the current product and repaired environment. No inference is permitted. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const [source, project, mode] = process.argv.slice(2);
if (!source || !project || mode && mode !== '--apply') throw new Error('Usage: node scripts/reconcile-saved-plan.mjs SOURCE.sqlite PROJECT [--apply]');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = resolve(project), database = join(workspace, '.capivara-next', 'project.sqlite');
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function read(path) {
  const db = new DatabaseSync(resolve(path), { readOnly: true });
  try { return JSON.parse(db.prepare('SELECT body FROM project WHERE id=1').get().body); }
  finally { db.close(); }
}
const original = read(source), current = read(database);
assert.ok(!original.execution && !current.execution, 'A saved plan cannot replace implementation work.');
assert.equal(original.brief.id, current.brief.id, 'The product identity must remain unchanged.');
assert.equal(original.request, current.request, 'A different request needs reconciliation, not restoration.');
const draft = structuredClone(original.plan);
draft.environment = draft.environment.map(node => current.plan.environment.find(candidate => candidate.id === node.id) ?? node);
draft.status = 'planning'; delete draft.planning;
const temporary = await mkdtemp(join(tmpdir(), 'capivara-reconcile-saved-'));
try {
  const api = join(temporary, 'engine.mjs');
  await build({ stdin: { contents: `export {runPlan} from ${JSON.stringify(join(root, 'packages/core/src/domain/plan.ts'))}; export {ProjectStore} from ${JSON.stringify(join(root, 'packages/core/src/app/store.ts'))};`, resolveDir: root }, outfile: api, bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external', logLevel: 'silent' });
  const { runPlan, ProjectStore } = await import(pathToFileURL(api));
  const brief = structuredClone(current.brief); let requests = 0;
  const capacities = [current.config, current.reviewer ?? current.config].map(config => {
    if (!config?.contextTokens) return 24_000;
    const output = config.maxOutputTokens ?? Math.min(4096, Math.floor(config.contextTokens / 4));
    return Math.max(2000, Math.floor((config.contextTokens - output - 1000) * 2));
  });
  const plan = await runPlan({ brief, existing: draft, contextChars: Math.min(24_000, ...capacities),
    agent: async request => { requests++; throw new Error(`Reconciliation requires unresolved engineering work (${request.operation}); no inference is authorized by this script.`); } });
  assert.equal(requests, 0); assert.equal(plan.status, 'ready');
  const covered = new Set(plan.tasks.flatMap(task => task.requirementIds));
  assert.ok(brief.requirements.every(requirement => covered.has(requirement.id)), 'Every current outcome must remain covered.');
  for (const task of original.plan.tasks) {
    const restored = plan.tasks.find(item => item.id === task.id);
    assert.ok(restored, `Lost engineering responsibility: ${task.id}`);
    assert.deepEqual(restored.criteria, task.criteria, 'Restoration must preserve complete acceptance criteria.');
    assert.deepEqual(restored.checks, task.checks, 'Restoration must preserve original executable recipes.');
    assert.deepEqual(restored.files, task.files, 'Restoration must preserve owned outputs.');
  }
  const receipt = { schema: 'capivara/saved-plan-reconciliation/1', originalPlanSHA256: sha(original.plan), previousPlanSHA256: sha(current.plan), planSHA256: sha(plan),
    previousTasks: current.plan.tasks.length, restoredTasks: plan.tasks.length, requirements: brief.requirements.length, newAgentRequests: requests, applied: mode === '--apply', productFilesChanged: false, evidenceCreated: false };
  if (mode === '--apply') {
    const store = new ProjectStore(workspace);
    try {
      assert.ok(store.claim(), 'Another execution owns this project.');
      assert.equal(sha(store.read()), sha(current), 'The project changed while the plan was being reconciled.');
      store.event('plan.recovery', { type: 'plan.recovery', at: new Date().toISOString(), message: 'Responsabilidades originais reconciliadas com a partição atual dos requisitos; ambiente corrigido e ledger preservados, sem repetir inferência ou criar provas.', detail: receipt });
      store.update({ brief, plan, status: 'complete', stage: 'plan', lastFailure: null });
    } finally { store.close(); }
  }
  console.log(JSON.stringify(receipt));
} finally { await rm(temporary, { recursive: true, force: true }); }
