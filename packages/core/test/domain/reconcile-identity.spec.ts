import { expect, it } from 'vitest';
import { reconcileChecks, reconcilePlan, sameDelivery, validatePlan } from '../../src/domain/reconcile.js';
import { verificationAssertionStatus } from '../../src/domain/assertions.js';
import type { DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../../src/domain/types.js';

const brief: ProductBrief = { schema: 'capivara/product/1', id: 'product', revision: 1, status: 'ready', name: 'Records', summary: 'Persist records', request: 'Persist records and validate inputs', modes: ['api'], targets: [], requirements: ['crud', 'validation'].map(id => ({ id, statement: id, mode: 'api', source: { kind: 'request', reference: 'request', text: id } })), constraints: [], gaps: [], decisions: [] };
const task = (id: string, goal: string, files: string[]): WorkUnit => ({ id, title: goal, goal, instructions: 'Implement persistent record operations.', requirementIds: ['crud'], dependsOn: [], environmentIds: [], contractIds: [], files, criteria: ['Records survive a restart.'], checks: [], risk: 'normal', blockedBy: [] });
const plan = (tasks: WorkUnit[]): DevelopmentPlan => ({ schema: 'capivara/plan/1', status: 'planning', revision: 1, briefId: brief.id, briefRevision: brief.revision, environment: [], contracts: [], tasks });

it('merges translated slices of the same owned delivery without losing either contract or proof', () => {
  const original = task('records', 'Users can create, inspect, edit, and delete persisted records.', ['src/records/**', 'tests/records/**']);
  original.checks = [{ id: 'behavior', kind: 'command', command: 'node', args: ['tests/records/run.js'], expected: 'Original acceptance criterion', assertion: { type: 'contains', value: 'persisted' }, level: 'behavior', requirementIds: ['crud'], requiredCapabilities: [] }];
  const additional = task('records', 'Usuários criam, consultam, editam e excluem registros persistidos.', ['tests/records/**', 'src/records/**', 'docs/records.md']);
  additional.instructions = 'Reject invalid records and preserve their creation date.';
  additional.requirementIds = ['validation']; additional.dependsOn = ['foundation'];
  additional.criteria = ['Invalid input is rejected.']; additional.risk = 'high';
  additional.inputs = ['src/storage.js']; additional.resources = ['record-database']; additional.exclusiveContracts = ['records-contract'];
  additional.checks = [{ ...original.checks[0]!, expected: 'Additional acceptance criterion', assertion: { type: 'contains', value: 'validated' }, requirementIds: ['validation'] }];
  const foundation = task('foundation', 'Initialize storage.', ['src/storage.js']);
  const result = reconcilePlan(brief, plan([foundation, original, additional]));
  expect(result.tasks.map(item => item.id)).toEqual(['foundation', 'records']);
  const merged = result.tasks[1]!;
  expect(merged).toMatchObject({ requirementIds: ['crud', 'validation'], dependsOn: ['foundation'], files: ['src/records/**', 'tests/records/**', 'docs/records.md'], criteria: [...original.criteria, ...additional.criteria], inputs: additional.inputs, resources: additional.resources, exclusiveContracts: additional.exclusiveContracts, risk: 'high' });
  expect(merged.instructions).toContain(original.instructions); expect(merged.instructions).toContain(additional.instructions); expect(merged.instructions).toContain(additional.goal);
  expect(merged.checks.map(check => check.assertion)).toEqual([original.checks[0]!.assertion, additional.checks[0]!.assertion]);
  expect(new Set(merged.checks.map(check => check.id)).size).toBe(2);
  expect(reconcilePlan(brief, result, result)).toEqual(result);
});

it('recognizes explicit directory/glob refinements without comparing goal language', () => {
  const original = task('records', 'Deliver records.', ['src/records/**', 'tests/records']);
  const refinement = task('records', 'Entregar registros.', ['src/records/api.ts', 'tests/records/behavior.ts']);
  expect(sameDelivery(original, refinement)).toBe(true);
  expect(reconcilePlan(brief, plan([original, refinement])).tasks[0]!.files).toEqual([...original.files, ...refinement.files]);
});

it('keeps an already established alias stable when a later slice changes only its description', () => {
  const original = task('records', 'Deliver records.', ['src/records.ts']);
  const alias = { ...original, id: 'records-new' };
  const translated = { ...alias, goal: 'Entregar registros.', criteria: ['Additional mandatory behavior.'] };
  const result = reconcilePlan(brief, plan([original, alias, translated]));
  expect(result.tasks).toHaveLength(1); expect(result.tasks[0]!.id).toBe('records');
  expect(result.tasks[0]!.criteria).toContain('Additional mandatory behavior.');
});

it('rejects conflicting task identity despite equal generic prose or one incidental shared output', () => {
  for (const common of [[], ['package.json']]) {
    const left = task('records', 'Create a controller.', [...common, 'src/customers.ts']);
    const right = task('records', 'Create a controller.', [...common, 'src/orders.ts']);
    expect(sameDelivery(left, right)).toBe(false);
    expect(() => reconcilePlan(brief, plan([left, right]))).toThrow(/duas entregas diferentes/);
    const distinct = [{ ...left, id: 'customers' }, { ...right, id: 'orders' }];
    expect(reconcilePlan(brief, plan(distinct)).tasks.map(item => item.id)).toEqual(['customers', 'orders']);
  }
  const left = task('records', 'Configure delivery.', []), right = task('records', 'Configure delivery.', []);
  left.contractIds = ['customer-contract']; right.contractIds = ['order-contract'];
  expect(() => reconcilePlan(brief, plan([left, right]))).toThrow(/duas entregas diferentes/);
});

it('preserves distinct task IDs and self-dependency defects instead of merging away their obligations', () => {
  const first = task('records', 'Deliver records.', ['src/records.ts']);
  const other = task('different-step', 'Entregar registros.', ['src/records.ts']);
  expect(reconcilePlan(brief, plan([first, other])).tasks).toHaveLength(2);
  const additional = { ...first, goal: 'Entregar registros.', dependsOn: ['records'], criteria: ['Mandatory additional result.'] };
  const merged = reconcilePlan(brief, plan([first, additional]));
  expect(merged.tasks[0]!.criteria).toContain('Mandatory additional result.');
  expect(validatePlan(brief, merged).some(issue => issue.code === 'task-cycle')).toBe(true);
});

it('reconciles independent slices by complete contract identity and compatible ownership while preserving every obligation',()=>{
  const first=task('records','Persist the domain records.',['src/records/**']);first.contractIds=['records-api'];
  const second=task('resource-domain','Validar e armazenar os registros.',['src/records/model.ts']);second.contractIds=['records-api'];second.requirementIds=['validation'];second.criteria=['Reject invalid records.'];second.instructions='Implement validation and durable storage.';
  second.checks=[{id:'validation-proof',kind:'command',command:'node',args:['verify.mjs'],assertion:{type:'contains',value:'valid'},requirementIds:['validation'],requiredCapabilities:[]}];
  const consumer=task('consumer','Use the records.',['src/consumer.ts']);consumer.dependsOn=['resource-domain'];
  const original=plan([first,second,consumer]),unchanged=structuredClone(original),result=reconcilePlan(brief,original);
  expect(result.tasks.map(unit=>unit.id)).toEqual(['records','consumer']);
  expect(result.tasks[0]!.requirementIds).toEqual(['crud','validation']);expect(result.tasks[0]!.criteria).toEqual([...first.criteria,...second.criteria]);
  expect(result.tasks[0]!.checks).toEqual(second.checks);expect(result.tasks[0]!.instructions).toContain(second.instructions);
  expect(result.tasks[1]!.dependsOn).toEqual(['records']);expect(original).toEqual(unchanged);
});

it('preserves intentional direct and transitive stages even when ownership and contracts are identical',()=>{
  for(const indirect of [false,true]){
    const first=task('foundation','Prepare the records.',['src/records.ts']);first.contractIds=['records-api'];
    const later=task('migration','Refine the records.',['src/records.ts']);later.contractIds=['records-api'];later.dependsOn=[indirect?'middle':'foundation'];
    const middle=task('middle','Consume the first stage.',['src/intermediate.ts']);middle.dependsOn=['foundation'];
    const result=reconcilePlan(brief,plan(indirect?[first,middle,later]:[first,later]));
    expect(result.tasks).toHaveLength(indirect?3:2);expect(result.tasks.find(task=>task.id==='migration')!.dependsOn).toEqual(later.dependsOn);
  }
});

it('does not infer delivery identity from a shared manifest or incompatible contracts',()=>{
  const left=task('customers','Create a controller.',['package.json','src/customers.ts']);left.contractIds=['shared-api'];
  const right=task('orders','Create a controller.',['package.json','src/orders.ts']);right.contractIds=['shared-api'];
  expect(reconcilePlan(brief,plan([left,right])).tasks).toHaveLength(2);
  right.files=[...left.files];right.contractIds=['different-api'];
  expect(reconcilePlan(brief,plan([left,right])).tasks).toHaveLength(2);
});

it('rechecks ordering after each alias so individually plausible merges cannot create a cycle',()=>{
  const a=task('a','First X.',['src/x.ts']),d=task('d','Other X.',['src/x.ts']);a.contractIds=d.contractIds=['x-contract'];d.dependsOn=['c'];
  const b=task('b','First Y.',['src/y.ts']),c=task('c','Other Y.',['src/y.ts']);b.contractIds=c.contractIds=['y-contract'];b.dependsOn=['a'];
  const result=reconcilePlan(brief,plan([a,d,b,c]));
  expect(result.tasks).toHaveLength(3);expect(validatePlan(brief,result).some(issue=>issue.code==='task-cycle'||issue.code==='missing-task-dependency')).toBe(false);
});

const proof = (): Verification => ({ id: 'records-proof', kind: 'command', command: 'node', args: ['tests/records.js'], inputs: ['src/records/**'], level: 'behavior', assertion: { type: 'contains', source: 'stdout', value: 'records' }, expected: 'Record operations persist.', requirementIds: ['crud'], constraintIds: ['constraint-original'], requiredCapabilities: [] });
const unparsedProof = (): Verification => { const { assertion: _assertion, ...check } = proof(); return check; };

it('runs one effective predicate for translated descriptions while preserving every consumer and criterion', () => {
  const first = proof(), second = { ...proof(), id: 'translated-proof', expected: 'As operações de registros persistem.', assertion: { type: 'contains' as const, value: 'records' }, requirementIds: ['validation'], constraintIds: ['constraint-additional'] };
  const before = structuredClone([first, second]);
  const result = reconcileChecks([first, second]);
  expect(result).toHaveLength(1); expect(result[0]!.id).toBe(first.id);
  expect(result[0]!.requirementIds).toEqual(['crud', 'validation']);
  expect(result[0]!.constraintIds).toEqual(['constraint-original', 'constraint-additional']);
  expect(result[0]!.expected).toContain(first.expected); expect(result[0]!.expected).toContain(second.expected);
  expect(result[0]!.assertion).toEqual(first.assertion);
  expect([first, second]).toEqual(before);
  expect(reconcileChecks(result)).toEqual(result);
});

it('keeps genuinely different invocations, inputs, predicates, providers and unparsed behavior criteria separate', () => {
  const first = proof();
  const variants: Partial<Verification>[] = [
    { assertion: { type: 'contains', source: 'stdout', value: 'different' } },
    { assertion: { type: 'contains', source: 'stderr', value: 'records' } },
    { inputs: ['src/other/**'] }, { args: ['tests/other.js'] }, { expectedExitCode: 2 }, { dependsOn: ['artifact-producer'] },
    { conformance: { capability: 'runtime', kind: 'runtime', provider: 'RequiredRuntime', requirementId: 'crud', productInputs: ['src/records.js'] } },
  ];
  for (const variant of variants) expect(reconcileChecks([first, { ...proof(), ...variant }])).toHaveLength(2);
  for (const kind of ['command', 'web'] as const) {
    const missing = { ...unparsedProof(), kind };
    expect(reconcileChecks([missing, { ...missing, expected: 'Outro resultado ainda sem predicado.' }])).toHaveLength(2);
  }
  const invalid = { ...proof(), assertionIssue: 'Malformed predicate', level: 'build' as const };
  expect(reconcileChecks([invalid, { ...invalid, expected: 'Different unparsed criterion' }])).toHaveLength(2);
});

it('materializes a legacy predicate only when merging descriptions and preserves mechanical build semantics', () => {
  for (const expected of ['contains:records', 'regex:^records$']) {
    const legacy = { ...unparsedProof(), expected };
    expect(reconcileChecks([legacy])).toEqual([legacy]);
    const effective = verificationAssertionStatus(legacy).assertion!;
    const result = reconcileChecks([legacy, { ...legacy, id: 'typed', assertion: effective, expected: 'Descrição humana equivalente.' }]);
    expect(result).toHaveLength(1); expect(result[0]!.assertion).toEqual(effective);
    expect(result[0]!.expected).toContain(expected); expect(result[0]!.expected).toContain('Descrição humana equivalente.');
    expect(verificationAssertionStatus(result[0]!).status).toBe('ready');
  }
  for (const level of ['build', 'syntax'] as const) {
    const mechanical = { ...unparsedProof(), level };
    const result = reconcileChecks([mechanical, { ...mechanical, expected: 'Compilação ou sintaxe válida.' }]);
    expect(result).toHaveLength(1); expect(result[0]!.assertion).toBeUndefined();
    expect(result[0]!.expected).toContain(mechanical.expected); expect(result[0]!.expected).toContain('Compilação ou sintaxe válida.');
  }
});

it('remaps duplicate producer IDs while preserving before/after ordering and actual self dependencies', () => {
  const producer = proof();
  const consumer = { ...proof(), id: 'consumer', command: 'node', args: ['tests/use-artifact.js'], dependsOn: ['producer-alias'] };
  const result = reconcileChecks([consumer, producer, { ...producer, id: 'producer-alias', expected: 'Descrição equivalente.' }]);
  expect(result).toHaveLength(2); expect(result.find(check => check.id === consumer.id)!.dependsOn).toEqual([producer.id]);
  const ordered = reconcileChecks([producer, { ...producer, id: 'producer-after', dependsOn: [producer.id] }]);
  expect(ordered).toHaveLength(2); expect(ordered[1]!.dependsOn).toEqual([producer.id]);
  const cyclic = reconcileChecks([{ ...producer, dependsOn: [producer.id] }]);
  expect(cyclic[0]!.dependsOn).toEqual([producer.id]);
});

it('recognizes a mandatory provider through declared environment dependencies and diagnoses disconnected exact IDs', () => {
  const product = structuredClone(brief);
  product.requirements[0]!.binding = { capability: 'runtime', kind: 'runtime', provider: 'RequiredRuntime' };
  product.requirements[0]!.source.text='Use runtime RequiredRuntime.';
  const delivery = task('records', 'Deliver records.', ['src/records.js']);
  delivery.requirementIds = ['crud', 'validation']; delivery.environmentIds = ['driver'];
  const current = plan([delivery]);
  current.environment = [
    { id: 'bound-runtime', name: 'Runtime', kind: 'runtime', identity: { capability: 'runtime', kind: 'runtime', provider: 'RequiredRuntime' }, dependsOn: [], targets: [], reason: 'Product runtime', check: { command: 'runtime --version' }, prepare: [] },
    { id: 'driver', name: 'Driver', kind: 'package', dependsOn: ['bound-runtime'], targets: [], reason: 'Product driver', check: { command: 'driver-check' }, prepare: [] },
  ];
  current.acceptance = [{ ...proof(), constraintIds: [], conformance: { capability: 'runtime', kind: 'runtime', provider: 'RequiredRuntime', requirementId: 'crud', productInputs: ['src/records.js'] } }];
  expect(validatePlan(product, current)).toEqual([]);
  current.environment[1]!.dependsOn = [];
  expect(validatePlan(product, current)).toEqual([expect.objectContaining({ code: 'unused-mandatory-provider', subject: 'crud', environmentIds: ['bound-runtime'], taskIds: ['records'] })]);
  // A matching human label or availability command never supplies an identity
  // or an explicit dependency that the plan did not actually declare.
  const legacy = { ...current.environment[0]!, id: 'legacy-runtime' };
  delete legacy.identity;
  current.environment.push(legacy);
  current.tasks[0]!.environmentIds = ['legacy-runtime'];
  expect(validatePlan(product, current).map(issue => issue.code)).toEqual(['unused-mandatory-provider']);
});
