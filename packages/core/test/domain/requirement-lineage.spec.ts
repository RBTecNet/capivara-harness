import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { identity, normalize } from '../../src/domain/authority.js';
import { expandPartitionedRequirementIds } from '../../src/domain/requirement-lineage.js';
import { runInit } from '../../src/domain/init.js';
import { runPlan } from '../../src/domain/plan.js';
import { runBuild } from '../../src/execution/build.js';
import type { DevelopmentPlan, ProductBrief, Requirement, Verification, WorkUnit } from '../../src/domain/types.js';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function fixture() {
  const quote = 'Automated tests cover input and persistence.';
  const statement = 'Deliver tested command behavior.';
  const outcomes = [{ quote, statement: 'Verify actual invalid-input rejection.' }, { quote, statement: 'Verify actual file persistence.' }];
  const brief = await runInit({ request: `Create a CLI application. ${quote}`, agent: async call => JSON.stringify(call.operation === 'discover'
    ? { requirements: [{ statement, quote, kind: 'stack', mode: 'cli' }], questions: [] }
    : { requirements: [{ index: 0, quote, bindings: [], outcomes }] }) });
  brief.revision = 2;
  const parent = brief.requirements.find(requirement => requirement.statement === statement)!;
  const children = brief.requirements.filter(requirement => requirement.id !== parent.id);
  return { brief, parent, children };
}

it('expands only active INIT partitions with exact source and semantic identity, preserving existing references', async () => {
  const { brief, parent, children } = await fixture(), original = structuredClone(brief);
  expect(expandPartitionedRequirementIds(brief, ['unknown', parent.id, parent.id])).toEqual(['unknown', parent.id, ...parent.technicalClassification!.outcomes.map(outcome => outcome.requirementId!)]);
  expect(expandPartitionedRequirementIds(brief, [children[0]!.id])).toEqual([children[0]!.id]);
  expect(expandPartitionedRequirementIds(brief, expandPartitionedRequirementIds(brief, [parent.id]))).toEqual(expandPartitionedRequirementIds(brief, [parent.id]));
  expect(brief).toEqual(original);
});

it('does not inherit missing, forged, changed-source or changed-statement children', async () => {
  const { brief, parent, children } = await fixture();
  const variants: ((value: ProductBrief) => void)[] = [
    value => { value.requirements.find(item => item.id === parent.id)!.source.text += ' changed'; },
    value => { value.requirements.find(item => item.id === children[0]!.id)!.statement += ' changed'; },
    value => { value.requirements.find(item => item.id === children[0]!.id)!.source.reference = 'another-source'; },
    value => { const child = value.requirements.find(item => item.id === children[0]!.id)!; const classification = value.requirements.find(item => item.id === parent.id)!.technicalClassification!; const outcome = classification.outcomes.find(item => item.requirementId === child.id)!; child.id = outcome.requirementId = 'forged'; },
    value => { value.requirements = value.requirements.filter(item => item.id !== children[0]!.id); },
  ];
  for (const mutate of variants) {
    const changed = structuredClone(brief); mutate(changed);
    expect(expandPartitionedRequirementIds(changed, [parent.id])).not.toContain(children[0]!.id);
    expect(expandPartitionedRequirementIds(changed, [parent.id])).not.toContain('forged');
  }
});

it('recognizes a retained legacy generated identity only with its exact recorded interpretation', () => {
  const statement = 'Execute automated tests.', quote = 'Automated testing';
  const binding = { capability: 'automated testing', kind: 'cli' as const, provider: 'Automated testing' };
  const source = { kind: 'request' as const, reference: 'request', text: quote };
  const parentId = identity('req', `request:${normalize(statement)}`), childId = identity('req', `request:${normalize(statement)}:${JSON.stringify(binding)}`);
  const child: Requirement = { id: childId, statement: 'Execute actual automated tests.', source, kind: 'behavior', mode: 'cli' };
  const parent: Requirement = { id: parentId, statement, source, kind: 'behavior', mode: 'cli', technicalClassification: {
    schema: 'capivara/technical-choices/1', source, providers: [], outcomes: [{ quote, statement: child.statement, requirementId: childId }],
    previous: [{ requirementId: childId, statement: `${binding.provider}: ${binding.capability} (${binding.kind}).`, binding, source }],
  } };
  const brief: ProductBrief = { schema: 'capivara/product/1', status: 'ready', id: 'b', revision: 2, name: 'CLI', summary: statement, request: `Create a CLI. ${quote}`, modes: ['cli'], targets: ['portable'], requirements: [parent, child], constraints: [], decisions: [], gaps: [] };
  expect(expandPartitionedRequirementIds(brief, [parentId])).toEqual([parentId, childId]);
  parent.technicalClassification!.previous![0]!.statement = 'Unverified legacy interpretation';
  expect(expandPartitionedRequirementIds(brief, [parentId])).toEqual([parentId]);
});

it('resumes an existing delivery without outlining again, while requiring separate observed proofs for its partitioned outcomes', async () => {
  const { brief, parent, children } = await fixture();
  const check: Verification = { id: 'parent-behavior', kind: 'cli', level: 'behavior', command: process.execPath, args: ['product.mjs'], assertion: { type: 'contains', value: 'READY' }, inputs: ['product.mjs'], requirementIds: [parent.id], requiredCapabilities: [] };
  const task: WorkUnit = { id: 'command', title: 'Command', goal: parent.statement, instructions: 'Implement the requested command.', requirementIds: [parent.id], dependsOn: [], environmentIds: [], contractIds: [], files: ['product.mjs'], criteria: [parent.statement], checks: [check], risk: 'normal', blockedBy: [] };
  const existing: DevelopmentPlan = { schema: 'capivara/plan/1', status: 'ready', revision: 1, briefId: brief.id, briefRevision: 1, environment: [], tasks: [task], contracts: [], acceptance: [] };
  const planner = vi.fn(async () => { throw new Error('The existing delivery needs lineage, not another outline.'); });
  const plan = await runPlan({ brief, existing, agent: planner });
  expect(planner).not.toHaveBeenCalled(); expect(plan.tasks).toHaveLength(1);
  expect(plan.tasks[0]!.requirementIds).toEqual(expect.arrayContaining([parent.id, ...children.map(child => child.id)]));
  expect(plan.tasks[0]!.checks[0]!.requirementIds).toEqual([parent.id]); expect(existing.tasks[0]!.requirementIds).toEqual([parent.id]);
  const workspace = await mkdtemp(join(tmpdir(), 'capivara-lineage-build-')); temporary.push(workspace);
  const result = await runBuild({ workspace, brief, plan, signal: AbortSignal.timeout(10_000), agent: async request => {
    if (request.role === 'editor') await writeFile(join(request.workspace, 'product.mjs'), "console.log('READY');");
    return { status: 'complete', text: request.role === 'reviewer' ? '{"approved":true,"findings":[]}' : '', changedFiles: [], commands: [] };
  } });
  expect(result.status).toBe('waiting');
  expect(result.state.incidents.some(incident => children.some(child => child.id === incident.subject) && incident.message.includes('Mandatory requirement has no current proof')), JSON.stringify(result.state.incidents)).toBe(true);
  expect(result.state.evidence.every(evidence => evidence.checkId === check.id)).toBe(true);
});
