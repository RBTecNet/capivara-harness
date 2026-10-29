import { expect, it } from 'vitest';
import { contextForTask, packetText } from '../../src/domain/context.js';
import { criterionIdentity, scopeContribution } from '../../src/domain/contribution.js';
import type { DevelopmentPlan, ProductBrief, WorkUnit } from '../../src/domain/types.js';
import { interpretReview } from '../../src/execution/review.js';
import { resolveReviewScope, validateFindingDeferral } from '../../src/execution/source-finding-scope.js';

it('routes only an explicitly scoped integration finding to its real later owner, preserving the obligation and requiring explicit unit approval', async () => {
  const literal = 'Provide real CRUD through the API.';
  const brief: ProductBrief = { schema: 'capivara/product/1', id: 'b', revision: 1, status: 'ready', name: 'CRUD', summary: literal, request: `Create an API. ${literal}`, modes: ['api'], targets: ['portable'], requirements: [{ id: 'crud', statement: literal, kind: 'behavior', source: { kind: 'request', reference: 'request', text: literal }, mode: 'api' }], constraints: [], decisions: [], gaps: [] };
  const unit = (id: string, dependsOn: string[], criterion: string): WorkUnit => ({ id, title: id, goal: criterion, instructions: criterion, requirementIds: ['crud'], dependsOn, environmentIds: [], contractIds: [], files: [`src/${id}/`], criteria: [criterion], checks: [], risk: 'normal', blockedBy: [] });
  const foundation = unit('base', [], 'The server starts with the documented command.');
  const api = unit('api', ['base'], 'The API implements real CRUD.');
  const integration = unit('acceptance', ['api'], 'Prove integrated CRUD.');
  const parallel = unit('parallel', [], 'An independent consumer.');
  const plan: DevelopmentPlan = { schema: 'capivara/plan/1', status: 'ready', revision: 1, briefId: brief.id, briefRevision: 1, environment: [], contracts: [], tasks: [foundation, api, integration, parallel] };
  const contribution = scopeContribution(brief, plan, foundation);
  expect(contribution.requirements).toEqual([{ requirementId: 'crud', contribution: 'partial', finalOwnerTaskId: 'acceptance', downstreamTaskIds: ['api', 'acceptance'] }]);
  const context = packetText(contextForTask(brief, plan, foundation));
  expect(context).toContain(criterionIdentity(foundation.id, foundation.criteria[0]!));
  expect(context).toContain('"finalOwnerTaskId":"acceptance"');
  expect(context).not.toContain(parallel.instructions);
  const finding = { kind: 'product', observed: 'The integrated CRUD is not yet present.', expected: literal, scope: 'integration', requirementId: 'crud', deferToTaskId: 'acceptance', criterionId: criterionIdentity(foundation.id, foundation.criteria[0]!) };
  const original = JSON.stringify({ approved: true, findings: [finding] });
  const parsed = interpretReview(original);
  expect(parsed.decision).toBe('rejected'); expect(parsed.findings[0]!.disposition).toBe('defect');
  const resolved = await resolveReviewScope(process.cwd(), brief, plan, foundation, parsed);
  expect(resolved.assessment.decision).toBe('approved');
  expect(resolved.assessment.findings[0]).toMatchObject({ disposition: 'deferred', original: finding });
  expect(resolved.assessment.original).toBe(original); expect(parsed.decision).toBe('rejected');
  expect(resolved.handoffs).toEqual([expect.objectContaining({ fromTaskId: 'base', ownerTaskId: 'acceptance', requirementId: 'crud', source: brief.requirements[0]!.source, status: 'pending', finding: expect.objectContaining({ original: finding }) })]);
  expect(resolved.assessment.transformations.some(change => change.operation === 'classify')).toBe(true);
  const rejected = await resolveReviewScope(process.cwd(), brief, plan, foundation, interpretReview(JSON.stringify({ approved: false, findings: [finding] })));
  expect(rejected.assessment.decision).toBe('unresolved'); expect(rejected.assessment.approved).toBe(false); expect(rejected.handoffs).toHaveLength(1);
  const intermediate = await resolveReviewScope(process.cwd(), brief, plan, foundation, interpretReview(JSON.stringify({ approved: false, findings: [{ ...finding, deferToTaskId: 'api' }] })));
  expect(intermediate.handoffs).toEqual([expect.objectContaining({ ownerTaskId: 'api', requirementId: 'crud', status: 'pending' })]);
  expect(intermediate.assessment.decision).toBe('unresolved'); expect(intermediate.assessment.approved).toBe(false);
  for (const patch of [
    { deferToTaskId: 'parallel' }, { requirementId: 'invented' },
    { scope: 'unit' }, { criterionId: 'invented' },
  ]) {
    const assessment = interpretReview(JSON.stringify({ approved: true, findings: [{ ...finding, ...patch }] }));
    expect((await validateFindingDeferral(process.cwd(), brief, plan, foundation, assessment.findings[0]!)).valid).toBe(false);
    const result = await resolveReviewScope(process.cwd(), brief, plan, foundation, assessment);
    expect(result.handoffs).toEqual([]); expect(result.assessment.decision).toBe('rejected');
  }
  const stale = structuredClone(brief); stale.requirements[0]!.source.text = 'An invented literal source.';
  expect((await validateFindingDeferral(process.cwd(), stale, plan, foundation, parsed.findings[0]!)).valid).toBe(false);
  const unscoped = await resolveReviewScope(process.cwd(), brief, plan, foundation, interpretReview(JSON.stringify({ approved: true, findings: [{ observed: finding.observed, expected: literal }] })));
  expect(unscoped.handoffs).toEqual([]); expect(unscoped.assessment.decision).toBe('rejected');
  const localDefect = { kind: 'product', scope: 'unit', criterionId: finding.criterionId, observed: 'The documented server command exits before listening.', expected: foundation.criteria[0] };
  const mixed = await resolveReviewScope(process.cwd(), brief, plan, foundation, interpretReview(JSON.stringify({ approved: false, findings: [finding, localDefect] })));
  expect(mixed.handoffs).toHaveLength(1); expect(mixed.assessment.decision).toBe('rejected'); expect(mixed.assessment.approved).toBe(false);
  expect(mixed.assessment.actionableFindings).toEqual([expect.objectContaining({ scope: 'unit', disposition: 'defect', original: localDefect })]);
  expect(foundation.criteria).toEqual(['The server starts with the documented command.']);
});
