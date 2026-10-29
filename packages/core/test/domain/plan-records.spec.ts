import { expect, it } from 'vitest';
import { rehydratePlanRecords } from '../../src/domain/plan-records.js';
import { normalizeChecks } from '../../src/domain/plan.js';
import type { DevelopmentPlan, ProductBrief } from '../../src/domain/types.js';

const brief: ProductBrief = { schema: 'capivara/product/1', id: 'product', revision: 1, status: 'ready', name: 'App', summary: 'App', request: 'Use Node.js runtime.', modes: ['api'], targets: [], gaps: [], decisions: [], constraints: [], requirements: [{ id: 'runtime', statement: 'Use Node.js runtime.', source: { kind: 'request', reference: 'request', text: 'Use Node.js runtime.' }, mode: 'shared', kind: 'stack', binding: { provider: 'Node.js', kind: 'runtime', capability: 'runtime' } }] };
const raw = { id: 'native', command: 'node', args: ['server/app.ts'], cwd: '.', kind: 'runtime', level: 'behavior', expected: 'Product operation passed.', assertion: { type: 'contains', source: 'stdout', value: 'passed' }, requirementId: 'runtime', capability: 'runtime', provider: 'Node.js', productInputs: ['server/app.ts'], inputs: ['server/app.ts', 'server/other.ts'] };
function fixture(): DevelopmentPlan {
  const check = normalizeChecks([raw], brief)[0]!;
  delete check.conformance; check.requirementIds = [];
  return { schema: 'capivara/plan/1', status: 'planning', revision: 1, briefId: brief.id, briefRevision: brief.revision, environment: [{ id: 'node', name: 'Node', kind: 'runtime', dependsOn: [], targets: [], reason: 'Run', identity: { provider: 'Node.js', kind: 'runtime', capability: 'runtime' }, check: { command: 'node', args: ['--version'] }, prepare: [] }], contracts: [], tasks: [], acceptance: [check] };
}
const response = (value: unknown) => ({ operation: 'repair', result: JSON.stringify(value) });

it('restores metadata lost by an older normalizer from the identical paid flat response', () => {
  const original = fixture(), before = structuredClone(original.acceptance![0]!);
  const result = rehydratePlanRecords(brief, original, [response({ acceptance: [raw] })], normalizeChecks);
  expect(result.restored).toHaveLength(1); expect(result.ambiguous).toEqual([]);
  expect(result.plan.acceptance![0]).toMatchObject({ requirementIds: ['runtime'], conformance: { requirementId: 'runtime', provider: 'Node.js', kind: 'runtime', productInputs: ['server/app.ts'] } });
  expect(original.acceptance![0]).toEqual(before);
  const { requirementIds: _ids, conformance: _claim, ...unchanged } = result.plan.acceptance![0]!;
  const { requirementIds: _oldIds, conformance: _oldClaim, ...originalRecipe } = before;
  expect(unchanged).toEqual(originalRecipe);
});

it('never changes a command or material predicate to match a historical response', () => {
  for (const changed of [{ ...raw, command: 'other-node' }, { ...raw, expected: 'A different product criterion.' }, { ...raw, assertion: { type: 'contains', source: 'stdout', value: 'a different outcome' } }]) {
    const original = fixture(); const result = rehydratePlanRecords(brief, original, [response({ acceptance: [changed] })], normalizeChecks);
    expect(result.restored).toEqual([]); expect(result.plan).toEqual(original);
  }
});

it('keeps contradictory saved metadata unresolved rather than selecting the latest answer', () => {
  const original = fixture();
  const result = rehydratePlanRecords(brief, original, [response({ acceptance: [raw] }), response({ acceptance: [{ ...raw, productInputs: ['server/other.ts'] }] })], normalizeChecks);
  expect(result.restored).toEqual([]); expect(result.ambiguous).toHaveLength(1); expect(result.plan).toEqual(original);
});

it('rejects the wrong literal provider and does not borrow metadata from another check owner', () => {
  for (const body of [{ acceptance: [{ ...raw, provider: 'Different provider' }] }, { tasks: [{ id: 'task', checks: [raw] }] }]) {
    const original = fixture(); const result = rehydratePlanRecords(brief, original, [response(body)], normalizeChecks);
    expect(result.restored).toEqual([]); expect(result.plan).toEqual(original);
  }
});

it('does not overwrite conflicting existing metadata', () => {
  const original = fixture(); original.acceptance![0]!.requirementIds = ['other-requirement'];
  const result = rehydratePlanRecords(brief, original, [response({ acceptance: [raw] })], normalizeChecks);
  expect(result.restored).toEqual([]); expect(result.ambiguous).toHaveLength(1); expect(result.plan).toEqual(original);
});
