import { expect, it } from 'vitest';
import { normalizeChecks, runPlan } from '../../src/domain/plan.js';
import { validatePlan } from '../../src/domain/reconcile.js';
import { validateConformance } from '../../src/execution/conformance.js';
import { emptyOperationalEnvironment } from '../../src/execution/environment.js';
import type { DevelopmentPlan, DomainAgentRequest, ProductBrief, Verification, WorkUnit } from '../../src/domain/types.js';

function fixture() {
  const brief: ProductBrief = { schema: 'capivara/product/1', id: 'p', status: 'ready', revision: 1, name: 'Records', summary: 'Records API', request: 'Crie uma API. Use runtime Deno.', modes: ['api'], targets: [], constraints: [], gaps: [], decisions: [], requirements: [
    { id: 'stack', statement: 'Use runtime Deno.', source: { kind: 'request', reference: 'request', text: 'Use runtime Deno.' }, mode: 'shared', kind: 'stack', binding: { capability: 'app-runtime', kind: 'runtime', provider: 'Deno' } },
    { id: 'records', statement: 'Persist records.', source: { kind: 'request', reference: 'request', text: 'Persist records.' }, mode: 'api', kind: 'behavior' },
  ] };
  const task: WorkUnit = { id: 'work', title: 'Records API', goal: 'Persist validated records.', instructions: 'Implement the requested record API.', requirementIds: ['stack', 'records'], dependsOn: [], environmentIds: ['runtime'], contractIds: [], files: ['src/app.ts'], criteria: ['Valid records persist.', 'Invalid input is rejected.'], checks: [{ id: 'api', kind: 'command', command: 'deno', args: ['test'], assertion: { type: 'contains', value: 'API passed' }, requirementIds: ['records'], requiredCapabilities: [], level: 'behavior' }], risk: 'normal', blockedBy: [] };
  const plan: DevelopmentPlan = { schema: 'capivara/plan/1', status: 'ready', revision: 1, briefId: brief.id, briefRevision: 1, environment: [{ id: 'runtime', name: 'Runtime', kind: 'runtime', identity: { ...brief.requirements[0]!.binding! }, dependsOn: [], targets: [], reason: 'Execute product', check: { command: 'deno', args: ['--version'] }, prepare: [] }], contracts: [], tasks: [task] };
  const proof: Verification = { id: 'provider-use', kind: 'command', command: 'deno', args: ['run', 'src/app.ts'], level: 'behavior', expected: 'The actual product responds.', assertion: { type: 'contains', source: 'stdout', value: 'records served' }, expectedExitCode: 0, requirementIds: ['stack'], requiredCapabilities: [], inputs: ['src/app.ts'], conformance: { ...brief.requirements[0]!.binding!, requirementId: 'stack', productInputs: ['src/app.ts'] } };
  return { brief, plan, task, proof };
}

const missingContract={id:'records-contract',name:'Records',description:'The repository accepts validated records.',inputs:['Record'],outputs:['StoredRecord'],requirementIds:['records']};
function structuralFixture(){
  const result=fixture();result.task.contractIds=[missingContract.id];
  return result;
}

it('preserves explicitly flat and nested conformance metadata without manufacturing a missing claim', () => {
  const { brief, proof } = fixture(), { conformance, ...recipe } = proof;
  const flat = normalizeChecks([{ ...recipe, ...conformance, requirementIds: [] }], brief)[0]!;
  expect(flat.conformance).toEqual(conformance); expect(flat.requirementIds).toEqual(['stack']);
  const nested = normalizeChecks([{ ...recipe, acceptance: { conformance } }], brief)[0]!;
  expect(nested.conformance).toEqual(conformance); expect(nested.assertion).toEqual(proof.assertion);
  expect(normalizeChecks([recipe], brief)[0]!.conformance).toBeUndefined();
});

it('adopts environment and task-owned proof repairs together without replacing product criteria', async () => {
  const { brief, plan, task, proof } = fixture(), provider = structuredClone(plan.environment[0]!);
  delete plan.environment[0]!.identity;
  let calls = 0;
  const result = await runPlan({ brief, existing: plan, agent: async () => { calls++; return JSON.stringify({ environment: [provider], tasks: [{ id: task.id, goal: 'Only record the report.', files: ['README.md'], criteria: ['A log exists.'], environmentIds: ['runtime'], checks: [proof] }] }); } });
  expect(calls).toBe(1); expect(validatePlan(brief, result)).toEqual([]);
  const updated = result.tasks[0]!;
  expect(updated.goal).toBe(task.goal); expect(updated.criteria).toEqual(task.criteria); expect(updated.files).toEqual(task.files);
  expect(updated.checks.map(check => check.id)).toEqual(['api', proof.id]);
  expect(result.acceptance ?? []).toEqual([]);
});

it('patches retained unpublished recipe data after escalating a sterile proposal', async () => {
  const { brief, plan, task, proof } = structuralFixture(), { conformance, ...partial } = proof;
  const calls: DomainAgentRequest[] = [], published: DevelopmentPlan[] = [];
  const result = await runPlan({ brief, existing: plan, save: async patch => { if (patch.plan) published.push(structuredClone(patch.plan)); }, agent: async call => {
    calls.push(call);
    return JSON.stringify(calls.length === 1 ? { taskUpdates: [{ id: task.id, checks: [partial] }] } : { contracts:[missingContract],verificationUpdates: [{ owner: task.id, check: { id: proof.id, conformance } }] });
  } });
  expect(calls).toHaveLength(2); expect(calls[0]!.prompt).toContain('scoped-definitions'); expect(calls[1]!.prompt).toContain('minimal-patches');
  expect(result.tasks[0]!.checks.find(check => check.id === proof.id)).toMatchObject({ command: proof.command, args: proof.args, assertion: proof.assertion, conformance });
  expect(published.some(candidate => candidate.tasks[0]!.checks.some(check => check.id === proof.id && !check.conformance))).toBe(false);
  expect(validatePlan(brief, result)).toEqual([]);
});

it('retains incorrect claim metadata as explicit debt rather than buying a planning repair or approving execution', async () => {
  const { brief, plan, task, proof } = fixture();
  plan.tasks[0]!.checks.push({ ...proof, conformance: { ...proof.conformance!, provider: 'OtherRuntime' } });
  let calls=0;
  const result = await runPlan({ brief, existing: plan, agent: async () => {calls++;throw new Error('A missing usage recipe is BUILD debt.');} });
  const repaired = result.tasks[0]!.checks.find(check => check.id === proof.id)!;
  expect(calls).toBe(0);expect(repaired.conformance?.provider).toBe('OtherRuntime'); expect(repaired.command).toBe(proof.command); expect(repaired.assertion).toEqual(proof.assertion);
  expect(result.tasks[0]!.environmentIds).toEqual(['runtime']); expect(validatePlan(brief, result)).toEqual([]);
  expect(result.obligations).toContainEqual(expect.objectContaining({requirementId:'stack',recipeStatus:'pending',verification:'required-in-build'}));
  expect((await validateConformance(brief,result,emptyOperationalEnvironment(process.cwd()),[],process.cwd())).length).toBeGreaterThan(0);
});

it('rejects a newly introduced dependency defect atomically before adopting a corrected proof patch', async () => {
  const { brief, plan, task, proof } = structuralFixture(), published: DevelopmentPlan[] = [];
  let calls = 0;
  const result = await runPlan({ brief, existing: plan, save: async patch => { if (patch.plan) published.push(structuredClone(patch.plan)); }, agent: async () => {
    calls++;
    return JSON.stringify(calls === 1 ? { contracts:[missingContract],environment: [{ ...plan.environment[0]!, dependsOn: ['missing-provider'] }], tasks: [{ id: task.id, checks: [proof] }] } : { contracts:[missingContract],verificationUpdates: [{ owner: task.id, check: proof }] });
  } });
  expect(calls).toBe(2); expect(validatePlan(brief, result)).toEqual([]);
  expect(published.every(candidate => candidate.environment.every(node => !node.dependsOn.includes('missing-provider')))).toBe(true);
});

it('does not buy more repair calls with wording or clocks and never publishes that churn', async () => {
  const { brief, plan, task } = structuralFixture(), published: DevelopmentPlan[] = [], calls: DomainAgentRequest[] = [];
  await expect(runPlan({ brief, existing: plan, save: async patch => { if (patch.plan) published.push(structuredClone(patch.plan)); }, agent: async call => {
    calls.push(call);
    return JSON.stringify({ reason: `Cosmetic ${Date.now()}`, tasks: [{ ...task, title: `New label ${calls.length}`, criteria: ['Only log the report.'] }], environment: [{ ...plan.environment[0]!, reason: `New prose ${calls.length}` }] });
  } })).rejects.toMatchObject({ name: 'PlanningFailure', code: 'no-progress' });
  expect(calls).toHaveLength(2); expect(calls[1]!.prompt).toContain('minimal-patches');
  expect(published.every(candidate => candidate.tasks[0]!.criteria.includes('Invalid input is rejected.'))).toBe(true);
  expect(published.every(candidate => !candidate.environment[0]!.reason.startsWith('New prose'))).toBe(true);
});

it('records a unique operational SDK interpretation without rewriting the original inferred runtime binding', async () => {
  const { brief, plan, proof } = fixture();
  brief.request = 'Crie uma CLI usando Rust.'; brief.modes = ['cli'];
  const requirement = brief.requirements[0]!;
  requirement.source.text = 'Rust'; requirement.statement = 'Usar Rust.';
  requirement.binding = { capability: 'language', kind: 'runtime', provider: 'Rust' };
  const original = structuredClone(requirement.binding);
  plan.environment[0]!.identity = { capability: 'compiler', kind: 'sdk', provider: 'Rust' }; plan.environment[0]!.kind = 'sdk'; plan.environment[0]!.check = { command: 'rustc', args: ['--version'] };
  plan.tasks[0]!.checks.push({ ...proof, level: 'build', outputs: ['dist/app'], conformance: { ...plan.environment[0]!.identity, requirementId: 'stack', productInputs: ['src/app.rs'], artifacts: ['dist/app'] } });
  const result = await runPlan({ brief, existing: plan, agent: async () => { throw new Error('An existing unique SDK contract needs no planning call.'); } });
  expect(validatePlan(brief, result)).toEqual([]); expect(requirement.binding).toEqual(original);
  expect(requirement.bindingTransformations?.[0]).toMatchObject({ from: original, to: plan.environment[0]!.identity, reason: 'inferred-operational-role' });
});
