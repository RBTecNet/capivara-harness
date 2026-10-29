import { createHash } from 'node:crypto';
import { isAbsolute, matchesGlob } from 'node:path';
import { verificationAssertionStatus } from './assertions.js';
import { matchesOperationalClaim } from './bindings.js';
import { jsonObject } from './json.js';
import type { DevelopmentPlan, ProductBrief, Verification } from './types.js';

interface CompletedResponse { operation: string; result: string; }
interface RestoredMetadata { taskId: string; checkId: string; fields: ('requirementIds' | 'conformance')[]; resultSHA256: string; }
interface AmbiguousMetadata { taskId: string; checkId: string; reason: string; candidates: number; }
export interface RehydratedPlanRecords { plan: DevelopmentPlan; restored: RestoredMetadata[]; ambiguous: AmbiguousMetadata[]; }
const stable = (value: unknown): string => JSON.stringify(value, (_, item: unknown) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const records = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item)) : [];
const sameIds = (left: string[], right: string[]): boolean => stable([...new Set(left)].sort()) === stable([...new Set(right)].sort());
function invocation(check: Verification): string {
  const { id: _id, expected: _prose, requirementIds: _requirements, conformance: _conformance, assertion: _assertion, assertionIssue: _issue, ...recipe } = check;
  return stable({ ...recipe, args: check.args ?? [], cwd: check.cwd ?? '.' });
}
function sameRecipe(left: Verification, right: Verification): boolean {
  if (left.id !== right.id || left.expected !== right.expected || invocation(left) !== invocation(right)) return false;
  const a = verificationAssertionStatus(left), b = verificationAssertionStatus(right);
  if (a.status === 'ready' && b.status === 'ready') return stable(a.assertion) === stable(b.assertion);
  return stable(left.assertion) === stable(right.assertion) && left.assertionIssue === right.assertionIssue && left.expected === right.expected;
}
function validPath(path: string): boolean { return !!path && !path.includes('\0') && !isAbsolute(path) && !/^[a-z]:/i.test(path) && !path.replaceAll('\\', '/').split('/').includes('..'); }
function covered(path: string, selectors: string[]): boolean {
  const value = path.replaceAll('\\', '/');
  return selectors.some(selector => { const scope = selector.replaceAll('\\', '/').replace(/\/$/, ''); return scope === '.' || value === scope || value.startsWith(`${scope}/`) || matchesGlob(value, scope); });
}

/** Only restores missing metadata of an unchanged existing recipe, from its original saved owner. */
export function rehydratePlanRecords(
  brief: ProductBrief,
  original: DevelopmentPlan,
  responses: readonly CompletedResponse[],
  normalize: (value: unknown, brief: ProductBrief) => Verification[],
): RehydratedPlanRecords {
  const plan = structuredClone(original), restored: RestoredMetadata[] = [], ambiguous: AmbiguousMetadata[] = [];
  const candidates: { taskId: string; check: Verification; resultSHA256: string }[] = [];
  for (const response of responses) {
    if (!['outline', 'repair'].includes(response.operation)) continue;
    const body = jsonObject(response.result);
    if (!body) continue;
    const resultSHA256 = createHash('sha256').update(response.result).digest('hex');
    try {
      for (const check of normalize(body.acceptance, brief)) candidates.push({ taskId: '$acceptance', check, resultSHA256 });
      for (const task of records(body.tasks)) if (typeof task.id === 'string') for (const check of normalize(task.checks, brief)) candidates.push({ taskId: task.id, check, resultSHA256 });
    } catch { /* Unreadable historical data cannot change an active contract. */ }
  }
  const targets = [...plan.tasks.flatMap(task => task.checks.map(check => ({ taskId: task.id, check, files: task.files }))), ...(plan.acceptance ?? []).map(check => ({ taskId: '$acceptance', check, files: [] as string[] }))];
  const active = new Set(brief.requirements.map(requirement => requirement.id));
  for (const target of targets) {
    const qualified = candidates.filter(candidate => {
      if (candidate.taskId !== target.taskId || !sameRecipe(target.check, candidate.check)) return false;
      const claim = candidate.check.conformance;
      if (!claim || !candidate.check.requirementIds.length || !candidate.check.requirementIds.every(id => active.has(id)) || !candidate.check.requirementIds.includes(claim.requirementId)) return false;
      const requirement = brief.requirements.find(item => item.id === claim.requirementId);
      if (!requirement || !plan.environment.some(node => matchesOperationalClaim(requirement, claim, node.identity))) return false;
      const inputs = [...(target.check.inputs ?? []), ...target.files];
      return claim.productInputs.length > 0 && claim.productInputs.every(path => validPath(path) && covered(path, inputs));
    });
    if (!qualified.length) continue;
    const metadata = new Map(qualified.map(candidate => [stable({ requirementIds: [...candidate.check.requirementIds].sort(), conformance: candidate.check.conformance }), candidate]));
    if (metadata.size > 1) {
      ambiguous.push({ taskId: target.taskId, checkId: target.check.id, reason: 'Saved matching recipes declare contradictory metadata.', candidates: metadata.size });
      continue;
    }
    const candidate = [...metadata.values()][0]!;
    if (target.check.requirementIds.length && !sameIds(target.check.requirementIds, candidate.check.requirementIds) || target.check.conformance && stable(target.check.conformance) !== stable(candidate.check.conformance)) {
      ambiguous.push({ taskId: target.taskId, checkId: target.check.id, reason: 'Existing metadata conflicts with the recorded response; no field was replaced.', candidates: 1 });
      continue;
    }
    const fields: RestoredMetadata['fields'] = [];
    if (!target.check.requirementIds.length) { target.check.requirementIds = [...candidate.check.requirementIds]; fields.push('requirementIds'); }
    if (!target.check.conformance) { target.check.conformance = structuredClone(candidate.check.conformance!); fields.push('conformance'); }
    if (fields.length) restored.push({ taskId: target.taskId, checkId: target.check.id, fields, resultSHA256: candidate.resultSHA256 });
  }
  return { plan, restored, ambiguous };
}
