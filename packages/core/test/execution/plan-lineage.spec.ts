import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DevelopmentPlan, ProductBrief, WorkUnit } from '../../src/domain/types.js';
import type { BuildState, TaskProgress } from '../../src/execution/types.js';
import { normalizeTasks } from '../../src/domain/plan.js';
import { digest } from '../../src/execution/files.js';
import { collectTaskDefinitions, recoverPlanLineage } from '../../src/execution/plan-lineage.js';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const brief: ProductBrief = { schema: 'capivara/product/1', status: 'ready', id: 'b', revision: 1, name: 'fixture', summary: 'fixture', request: 'Implement records', modes: ['api'], targets: [], requirements: [{ id: 'r', statement: 'CRUD records', mode: 'api', source: { kind: 'request', reference: 'request', text: 'CRUD records' } }], constraints: [], gaps: [], decisions: [] };
const task = (id: string, files: string[]): WorkUnit => ({ id, title: id, goal: `Deliver ${id}`, instructions: `Implement ${id}`, requirementIds: ['r'], dependsOn: [], environmentIds: [], contractIds: [], files, inputs: [], criteria: [`${id} fulfills CRUD`], checks: [], risk: 'normal', blockedBy: [] });
const progress = (): TaskProgress => ({ status: 'waiting', revision: '', attempts: 1, changedFiles: [], findings: [], strategy: 'revalidate-only' });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'capivara-lineage-')); temporary.push(root);
  const original = normalizeTasks([task('records', ['src/records.js', 'test/records.js'])], brief, [], [])[0]!;
  const replacement = task('records-proof', ['test/records.js']); replacement.checks = [{ id: 'record-proof', kind: 'command', command: 'node', args: ['test/records.js'], requirementIds: ['r'], requiredCapabilities: [], expected: 'contains:verified' }]; replacement.inputs = ['src/**'];
  const consumer = task('ui', ['src/ui.js']); consumer.dependsOn = [replacement.id];
  const plan: DevelopmentPlan = { schema: 'capivara/plan/1', status: 'ready', revision: 3, briefId: 'b', briefRevision: 1, environment: [], contracts: [], tasks: [replacement, consumer] };
  const state: BuildState = { schema: 'capivara/build/1', planRevision: 3, tasks: { records: progress(), 'records-proof': progress(), ui: progress() }, environment: {}, evidence: [], incidents: [], updatedAt: new Date().toISOString() };
  const oldArea = join(root, 'old'), newArea = join(root, 'new'); await mkdir(oldArea); await mkdir(newArea);
  await writeFile(join(oldArea, 'records.js'), 'implemented CRUD'); await writeFile(join(newArea, 'proposal.js'), 'extra verification proposal'); await writeFile(join(root, 'canonical.js'), 'unrelated canonical source');
  state.tasks.records!.checkpoint = { directory: oldArea, base: {}, phase: 'checking', taskHash: digest(JSON.stringify(original)) };
  state.tasks['records-proof']!.checkpoint = { directory: newArea, base: {}, phase: 'checking', taskHash: digest(JSON.stringify(replacement)) };
  const calls = { original: { status: 'complete', result: JSON.stringify({ tasks: [original] }) } };
  return { root, original, replacement, plan, state, calls, oldArea, newArea };
}

it('restores an exact orphaned delivery, moves only proof configuration and reuses its existing private source', async () => {
  const f = await fixture(), oldHash = f.state.tasks.records!.checkpoint!.taskHash;
  const result = recoverPlanLineage(brief, f.plan, f.state, f.calls), restored = result.plan.tasks[0]!;
  expect(result.restored).toHaveLength(1); expect(result.restored[0]).toMatchObject({ previousTaskId: 'records', replacementTaskId: 'records-proof', previousDefinitionHash: oldHash, source: 'domain-call' });
  for (const key of ['id', 'goal', 'instructions', 'criteria', 'files', 'dependsOn'] as const) expect(restored[key]).toEqual(f.original[key]);
  expect(restored.checks).toEqual(f.replacement.checks); expect(restored.inputs).toEqual(['src/**']);
  expect(result.plan.tasks[1]!.dependsOn).toEqual(['records']);
  expect(f.state.tasks.records!.checkpoint).toMatchObject({ directory: f.oldArea, phase: 'checking', taskHash: digest(JSON.stringify(restored)) });
  expect(f.state.tasks.records!.proposals).toContain(f.newArea); expect(f.state.tasks['records-proof']!.checkpoint).toBeUndefined();
  expect(await readFile(join(f.oldArea, 'records.js'), 'utf8')).toBe('implemented CRUD');
  expect(await readFile(join(f.newArea, 'proposal.js'), 'utf8')).toBe('extra verification proposal');
  expect(await readFile(join(f.root, 'canonical.js'), 'utf8')).toBe('unrelated canonical source');
});

it('refuses reconstruction without an exact hash, a usable proposal or the completed implementation phase', async () => {
  for (const invalid of ['hash', 'missing-directory', 'editing', 'complete']) {
    const f = await fixture(), old = f.state.tasks.records!;
    if (invalid === 'hash') old.checkpoint!.taskHash = digest('unknown original');
    if (invalid === 'missing-directory') old.checkpoint!.directory = join(f.root, 'missing');
    if (invalid === 'editing') old.checkpoint!.phase = 'editing';
    if (invalid === 'complete') old.status = 'complete';
    expect(recoverPlanLineage(brief, f.plan, f.state, f.calls).restored).toEqual([]);
  }
});

it('refuses ambiguous replacements and different requirement ownership', async () => {
  const f = await fixture(); f.plan.tasks.push({ ...f.replacement, id: 'other-proof' });
  expect(recoverPlanLineage(brief, f.plan, f.state, f.calls).restored).toEqual([]);
  f.plan.tasks.pop(); f.replacement.requirementIds = ['other'];
  expect(recoverPlanLineage(brief, f.plan, f.state, f.calls).restored).toEqual([]);
});

it('persists effective definitions and prevents inverse restoration after a restart', async () => {
  const f = await fixture(); f.state.taskDefinitions = { records: f.original };
  expect(collectTaskDefinitions(brief, f.plan, f.state).some(item => item.hash === f.state.tasks.records!.checkpoint!.taskHash)).toBe(true);
  const first = recoverPlanLineage(brief, f.plan, f.state);
  const durable = JSON.parse(JSON.stringify(f.state)) as BuildState;
  expect(durable.taskDefinitions?.records).toEqual(first.plan.tasks[0]);
  expect(durable.tasks.records!.checkpoint!.taskHash).toBe(digest(JSON.stringify(durable.taskDefinitions!.records)));
  const second = recoverPlanLineage(brief, first.plan, durable, f.calls);
  expect(second.restored).toEqual([]); expect(second.plan).toEqual(first.plan);
});

it('keeps a reconciled plan stable when its retired successor also has an approved exact definition', async () => {
  const f = await fixture();
  f.state.taskDefinitions = { records: f.original, 'records-proof': f.replacement };
  const retired = f.state.tasks['records-proof']!;
  retired.status = 'complete'; retired.definitionHash = digest(JSON.stringify(f.replacement));
  const first = recoverPlanLineage(brief, f.plan, f.state);
  expect(first.restored[0]?.replacementDefinitionHash).toBe(retired.definitionHash);
  f.state.planLineage = first.restored;
  f.state.tasks.records!.status = 'complete';
  f.state.tasks.records!.definitionHash = digest(JSON.stringify(first.plan.tasks[0]));
  delete f.state.tasks.records!.checkpoint;
  let plan = first.plan;
  for (let restart = 0; restart < 3; restart++) {
    const result = recoverPlanLineage(brief, plan, JSON.parse(JSON.stringify(f.state)) as BuildState);
    expect(result.restored).toEqual([]); expect(result.plan).toEqual(first.plan);
    plan = result.plan;
  }
});

it('recognizes an exact legacy retirement even after an old controller changed its strategy', async () => {
  const f = await fixture();
  f.state.taskDefinitions = { records: f.original, 'records-proof': f.replacement };
  const first = recoverPlanLineage(brief, f.plan, f.state);
  f.state.planLineage = first.restored.map(({ replacementDefinitionHash: _, ...legacy }) => legacy);
  const retired = f.state.tasks['records-proof']!;
  retired.status = 'complete'; retired.strategy = 'verified';
  retired.definitionHash = digest(JSON.stringify(f.replacement));
  const successor = { ...first.plan.tasks[0]!, id: 'records-delivery' };
  const current = { ...first.plan, tasks: [successor, { ...first.plan.tasks[1]!, dependsOn: [successor.id] }] };
  f.state.tasks.records!.status = 'complete'; f.state.tasks.records!.strategy = 'superseded-plan-lineage';
  f.state.tasks.records!.definitionHash = digest(JSON.stringify(first.plan.tasks[0]));
  delete f.state.tasks.records!.checkpoint;
  const result = recoverPlanLineage(brief, current, f.state);
  expect(result.restored).toEqual([]); expect(result.plan).toEqual(current);
});

it('preserves a genuinely new orphaned proposal after retirement of the same task ID', async () => {
  for (const changedContract of [false, true]) {
    const f = await fixture();
    f.state.taskDefinitions = { records: f.original, 'records-proof': f.replacement };
    const first = recoverPlanLineage(brief, f.plan, f.state);
    f.state.planLineage = first.restored;
    const definition = structuredClone(f.replacement);
    if (changedContract) definition.criteria.push('New concrete delivery obligation');
    const directory = join(f.root, 'new-private-proposal'); await mkdir(directory);
    await writeFile(join(directory, 'records.js'), 'new unintegrated work');
    f.state.taskDefinitions['records-proof'] = definition;
    f.state.tasks['records-proof']!.status = 'checking';
    f.state.tasks['records-proof']!.checkpoint = { directory, base: {}, phase: 'checking', taskHash: digest(JSON.stringify(definition)) };
    const result = recoverPlanLineage(brief, first.plan, f.state);
    expect(result.restored).toHaveLength(1);
    expect(result.restored[0]).toMatchObject({ previousTaskId: 'records-proof', checkpointDirectory: directory });
    expect(await readFile(join(directory, 'records.js'), 'utf8')).toBe('new unintegrated work');
  }
});

it('does not replace a completed successor or introduce a missing original dependency', async () => {
  const f = await fixture(); f.state.tasks['records-proof']!.status = 'complete';
  f.state.evidence.push({id:'proved-successor',taskId:'records-proof',checkId:'record-proof',inputHash:'current',passed:true,command:'node test/records.js',output:'verified',terminal:false,level:'behavior',checkedAt:new Date().toISOString()});
  expect(recoverPlanLineage(brief, f.plan, f.state, f.calls).restored).toEqual([]);
  f.state.tasks['records-proof']!.status = 'waiting'; f.original.dependsOn = ['missing-foundation'];
  f.state.taskDefinitions = { records: f.original }; f.state.tasks.records!.checkpoint!.taskHash = digest(JSON.stringify(f.original));
  expect(recoverPlanLineage(brief, f.plan, f.state).restored).toEqual([]);
});

it('restores a product delivery when a completed administrative replacement has no behavior proof',async()=>{
  const f=await fixture();
  f.original.checks=[{id:'crud',kind:'command',command:'node',args:['test/records.js'],expected:'contains:verified',level:'behavior',requirementIds:['r'],requiredCapabilities:[]}];
  f.original=normalizeTasks([f.original],brief,[],[])[0]!;
  f.state.tasks.records!.checkpoint!.taskHash=digest(JSON.stringify(f.original));
  f.calls.original.result=JSON.stringify({tasks:[f.original]});
  f.plan.tasks[0]!.checks=[];f.state.tasks['records-proof']!.status='complete';
  const result=recoverPlanLineage(brief,f.plan,f.state,f.calls);
  expect(result.restored).toHaveLength(1);expect(result.plan.tasks[0]!.goal).toBe(f.original.goal);
  expect(result.plan.tasks[0]!.checks).toEqual(f.original.checks);expect(f.state.tasks.records!.status).toBe('checking');
});

it('retains an approved delivery contract across an administrative plan replacement without inventing another source proposal',async()=>{
  const f=await fixture();const approved=f.state.tasks.records!;approved.status='complete';approved.definitionHash=digest(JSON.stringify(f.original));delete approved.checkpoint;
  f.state.taskDefinitions={records:f.original};f.plan.tasks[0]!.checks=[];f.state.tasks['records-proof']!.status='complete';
  const result=recoverPlanLineage(brief,f.plan,f.state,f.calls);
  expect(result.restored).toHaveLength(1);expect(result.plan.tasks[0]!.id).toBe('records');
  expect(approved.status).toBe('checking');expect(approved.checkpoint).toBeUndefined();expect(result.restored[0]!.checkpointDirectory).toBeUndefined();
  expect(await readFile(join(f.root,'canonical.js'),'utf8')).toBe('unrelated canonical source');
});
