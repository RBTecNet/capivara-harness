import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { identity } from '../domain/authority.js';
import { criterionIdentity, preferredProofOwner, taskDependsOn } from '../domain/contribution.js';
import type { DevelopmentPlan, ProductBrief, Requirement, Source, WorkUnit } from '../domain/types.js';
import type { ReviewAssessment, ReviewFinding } from './review.js';

export interface ReviewScopeHandoff {
  id: string;
  fromTaskId: string;
  ownerTaskId: string;
  requirementId: string;
  source: Source;
  finding: ReviewFinding;
  status: 'pending';
}
export interface FindingDeferral {
  valid: boolean;
  reason: string;
  ownerTaskId?: string;
  requirementId?: string;
  source?: Source;
}
async function sourceIsCurrent(workspace: string, brief: ProductBrief, requirement: Requirement): Promise<boolean> {
  const source = requirement.source;
  if (!source.text.trim()) return false;
  if (source.kind === 'request') return source.reference === 'request' && brief.request.includes(source.text);
  if (source.kind === 'answer') return brief.decisions.some(decision => decision.questionId === source.reference && decision.answer.includes(source.text));
  const reference = brief.references?.find(item => item.reference === source.reference && item.localPath && item.localPath === source.localPath);
  if (!reference?.localPath) return false;
  try { return (await readFile(isAbsolute(reference.localPath) ? reference.localPath : resolve(workspace, reference.localPath), 'utf8')).includes(source.text); }
  catch { return false; }
}

/** Only an explicit integration claim with a real later owner can leave this
 * unit. Neither wording nor a filename decides that a defect is out of scope. */
export async function validateFindingDeferral(workspace: string, brief: ProductBrief, plan: DevelopmentPlan, task: WorkUnit, finding: ReviewFinding): Promise<FindingDeferral> {
  const reject = (reason: string): FindingDeferral => ({ valid: false, reason });
  if (finding.scope !== 'integration' || !finding.requirementId || !finding.deferToTaskId) return reject('A deferral needs an explicit integration scope, requirement and destination.');
  if (finding.criterionId && !task.criteria.some(statement => criterionIdentity(task.id, statement) === finding.criterionId)) return reject('The criterion reference is not a recognized local criterion; its origin is unresolved.');
  const requirement = brief.requirements.find(candidate => candidate.id === finding.requirementId);
  const owner = plan.tasks.find(candidate => candidate.id === finding.deferToTaskId);
  if (!requirement || !task.requirementIds.includes(requirement.id) || !owner?.requirementIds.includes(requirement.id)) return reject('The active requirement must be owned by both the current contribution and the destination.');
  if (owner.id === task.id || !taskDependsOn(plan, owner, task.id)) return reject('The destination must transitively depend on the current contribution.');
  if (preferredProofOwner(plan, requirement.id)?.id !== owner.id) return reject('The destination is not the current final proof owner of this requirement.');
  if (!await sourceIsCurrent(workspace, brief, requirement)) return reject('The requirement has no current literal source supporting this handoff.');
  return { valid: true, reason: 'The explicit integration finding belongs to the later final owner of this same literal requirement. A criterion reference identifies its origin; the local criterion remains unchanged and required in this unit.', ownerTaskId: owner.id, requirementId: requirement.id, source: structuredClone(requirement.source) };
}

/** Classification preserves the defect and its literal obligation in a durable
 * handoff. The coordinator must persist and discharge it with the owner's proof.
 * An original rejection never becomes approval simply because findings moved. */
export async function resolveReviewScope(workspace: string, brief: ProductBrief, plan: DevelopmentPlan, task: WorkUnit, input: ReviewAssessment): Promise<{ assessment: ReviewAssessment; handoffs: ReviewScopeHandoff[] }> {
  const assessment = structuredClone(input), handoffs: ReviewScopeHandoff[] = [];
  for (const finding of assessment.findings) {
    if (finding.disposition !== 'defect' || finding.scope !== 'integration') continue;
    const resolution = await validateFindingDeferral(workspace, brief, plan, task, finding);
    if (!resolution.valid) {
      assessment.transformations.push({ path: `findings.${finding.id}.scope`, operation: 'unresolved', reason: resolution.reason, original: structuredClone(finding.original) });
      continue;
    }
    finding.disposition = 'deferred';
    assessment.transformations.push({ path: `findings.${finding.id}.disposition`, operation: 'classify', reason: resolution.reason, original: structuredClone(finding.original) });
    handoffs.push({ id: identity('handoff', JSON.stringify({ fromTaskId: task.id, ownerTaskId: resolution.ownerTaskId, requirementId: resolution.requirementId, findingId: finding.id })), fromTaskId: task.id, ownerTaskId: resolution.ownerTaskId!, requirementId: resolution.requirementId!, source: resolution.source!, finding: structuredClone(finding), status: 'pending' });
  }
  if (!handoffs.length) return { assessment, handoffs };
  assessment.actionableFindings = assessment.findings.filter(finding => finding.disposition === 'defect');
  assessment.advisories = assessment.findings.filter(finding => finding.disposition === 'advisory');
  assessment.deferredFindings = assessment.findings.filter(finding => finding.disposition === 'deferred');
  if (assessment.actionableFindings.length) { assessment.decision = 'rejected'; assessment.approved = false; }
  else if (assessment.declaredApproval === true && !assessment.transformations.some(change => change.operation === 'unresolved')) { assessment.decision = 'approved'; assessment.approved = true; }
  else {
    assessment.decision = 'unresolved'; assessment.approved = false;
    assessment.transformations.push({ path: '$', operation: 'unresolved', reason: 'Integration findings remain pending with their final owner. The original rejection still requires explicit approval of this unit.' });
  }
  return { assessment, handoffs };
}
