import { expect, it } from 'vitest';
import { normalizeChecks } from '../../src/domain/plan.js';
import { verificationDeclaration } from '../../src/domain/verification-declarations.js';
import { verificationAssertionStatus } from '../../src/domain/assertions.js';
import { isPlannedProductRecipe } from '../../src/domain/verifications.js';
import { validatePlan } from '../../src/domain/reconcile.js';
import type { DevelopmentPlan, ProductBrief, WorkUnit } from '../../src/domain/types.js';

const brief: ProductBrief = { schema: 'capivara/product/1', id: 'b', revision: 1, status: 'ready', name: 'Web', summary: 'Interact in the browser', request: 'Create a web application.', modes: ['web'], targets: ['browser'], requirements: [{ id: 'ui', statement: 'Interact in the browser.', mode: 'web', kind: 'interface', source: { kind: 'request', reference: 'request', text: 'Create a web application.' } }], constraints: [], decisions: [], gaps: [] };

it('preserves explicit nested execution fields and a singular requirement reference without modifying its original declaration', () => {
  const declaration = { id: 'browser', kind: 'web', requirementId: 'ui', recipe: {
    command: 'node', args: ['verify-ui.mjs'], cwd: 'web', level: 'behavior', expected: 'The user sees saved content.',
    assertion: { type: 'contains', source: 'stdout', value: 'saved-content' }, requiredCapabilities: ['browser'],
    inputs: ['web/verify-ui.mjs'], outputs: ['web/report.json'], expectedExitCode: 0, timeoutMs: 4000,
    target: 'browser', dependsOn: ['build'], input: ['enter'], closeInput: '\u0003',
    conformance: { requirementId: 'ui', capability: 'runtime', kind: 'runtime', provider: 'Node.js', productInputs: ['web/app.mjs'] },
  } };
  const original = structuredClone(declaration), check = normalizeChecks([declaration], brief)[0]!;
  expect(check).toMatchObject({ id: 'browser', kind: 'web', requirementIds: ['ui'], ...declaration.recipe });
  expect(verificationAssertionStatus(check).status).toBe('ready'); expect(isPlannedProductRecipe(check)).toBe(true);
  expect(declaration).toEqual(original);
});

it('uses explicit outer fields over nested defaults and supports applying an explicit nested patch before merging', () => {
  const current = { id: 'proof', kind: 'web', command: 'old-runner', args: ['old.mjs'] };
  const update = { id: 'proof', recipe: { command: 'actual-runner', args: ['actual.mjs'], expected: 'actual observed criterion' } };
  expect(verificationDeclaration({ ...update, command: 'explicit-outer' }).command).toBe('explicit-outer');
  const check = normalizeChecks([{ ...current, ...verificationDeclaration(update) }], brief)[0]!;
  expect(check).toMatchObject({ command: 'actual-runner', args: ['actual.mjs'], expected: 'actual observed criterion' });
});

it('keeps a missing command pending and preserves malformed AST instead of inventing a browser executable', () => {
  const declaration = { id: 'browser', kind: 'web', level: 'behavior', requirementId: 'ui', recipe: {
    expected: 'Navigate actual pages.', requiredCapabilities: ['browser'], assertion: { type: 'all', checks: [{ type: 'contains', value: 'Tarefas' }] },
  } };
  const check = normalizeChecks([declaration], brief)[0]!;
  expect(check.requirementIds).toEqual(['ui']); expect(check.expected).toBe('Navigate actual pages.');
  expect(check.command).toBeUndefined(); expect(isPlannedProductRecipe(check)).toBe(false);
  expect(check.assertion).toBeUndefined(); expect(check.assertionIssue).toBeTruthy();
  expect(verificationAssertionStatus(check).status).toBe('invalid');
  expect(normalizeChecks([check], brief)[0]!.assertionIssue).toBe(check.assertionIssue);
});

it('does not turn DOM selector or prose expected fields into stdout assertions', () => {
  const check = normalizeChecks([{ id: 'dom', kind: 'web', requirementId: 'ui', recipe: { command: 'node', args: ['actual-browser.mjs'], level: 'behavior', assertion: { type: 'contains', target: 'sidebar', expected: 'Tarefas' } } }], brief)[0]!;
  expect(check.assertion).toBeUndefined(); expect(check.assertionIssue).toBeTruthy();
});

it('preserves an unknown explicit reference for validation instead of inventing or silently dropping its requirement', () => {
  const check = normalizeChecks([{ id: 'unknown', command: 'node', requirementId: 'nonexistent', recipe: { args: ['verify.mjs'], level: 'behavior' } }], brief)[0]!;
  expect(check.requirementIds).toEqual(['nonexistent']);
  const task: WorkUnit = { id: 'web', title: 'Web', goal: 'Deliver interaction.', instructions: 'Implement the web UI.', requirementIds: ['ui'], dependsOn: [], environmentIds: [], contractIds: [], files: [], criteria: ['The requested interaction works.'], checks: [check], risk: 'normal', blockedBy: [] };
  const plan: DevelopmentPlan = { schema: 'capivara/plan/1', status: 'planning', revision: 1, briefId: brief.id, briefRevision: brief.revision, environment: [], tasks: [task], contracts: [] };
  expect(validatePlan(brief, plan).some(issue => issue.code === 'unknown-proof-requirement')).toBe(true);
  expect(brief.requirements.map(requirement => requirement.id)).toEqual(['ui']);
});
