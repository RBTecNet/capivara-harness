import { createHash } from 'node:crypto';
import { jsonObject, object } from '../domain/json.js';
import type { CommandResult } from '../runtime/types.js';

export type ReviewFailureKind = 'product' | 'instrument' | 'environment' | 'transport' | 'planning';
export interface ReviewFinding {
  id: string;
  kind: ReviewFailureKind;
  observed: string;
  expected?: string;
  file?: string;
  evidence?: string;
  fix?: string;
  evidenceType?: 'source' | 'verification' | 'inspection-command';
  reproduction?: Record<string, unknown>;
  /** A nonmaterial label is never allowed to erase behavioral evidence. */
  disposition: 'defect' | 'advisory';
  text: string;
  original: unknown;
}
export interface ReviewTransformation {
  path: string;
  operation: 'normalize' | 'classify' | 'unresolved';
  reason: string;
  original?: unknown;
}
export interface ReviewAssessment {
  decision: 'approved' | 'rejected' | 'unresolved';
  approved: boolean;
  /** Every meaningful finding remains visible, including explicitly advisory comments. */
  findings: ReviewFinding[];
  actionableFindings: ReviewFinding[];
  advisories: ReviewFinding[];
  original: string;
  transformations: ReviewTransformation[];
  readable: boolean;
}

const firstText = (...values: unknown[]): string => values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim() ?? '';
const identity = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 20);
const failureKinds = new Set<ReviewFailureKind>(['product', 'instrument', 'environment', 'transport', 'planning']);

export function reviewFindingText(finding: ReviewFinding): string {
  return `${finding.file ? `${finding.file}: ` : ''}${finding.observed}${finding.expected ? ` Expected: ${finding.expected}` : ''}${finding.evidence ? ` Evidence: ${finding.evidence}` : ''}${finding.fix ? ` Suggested repair: ${finding.fix}` : ''}`;
}

/** Decoding preserves the full verdict and every transformation; it never deletes defects by keywords. */
export function interpretReview(original: string): ReviewAssessment {
  const transformations: ReviewTransformation[] = [];
  const findings: ReviewFinding[] = [];
  const value = jsonObject(original);
  const fenced = original.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)?.[1];
  let wholeEnvelope = false;
  try { wholeEnvelope = object(JSON.parse(fenced ?? original.trim())); } catch { /* An extracted object can preserve findings, but cannot authorize an approval. */ }
  let explicitApproval = false, explicitRejection = false;
  if (value) {
    if (!wholeEnvelope) transformations.push({ path: '$', operation: 'unresolved', reason: 'A verdict was extracted from an ambiguous envelope. An explicit whole verdict is needed before approval; extracted findings remain preserved.' });
    const status = firstText(value.status, value.verdict).toLowerCase();
    explicitApproval = value.approved === true || value.complete === true || ['approved', 'complete', 'correct', 'pass', 'ok', 'aprovado', 'correto'].includes(status);
    explicitRejection = value.approved === false || value.complete === false || ['rejected', 'incomplete', 'fail', 'reprovado', 'incompleto'].includes(status);
    const keys = ['findings', 'issues', 'defects'].filter(key => Array.isArray(value[key]));
    // A verdict may contain more than one collection. None silently replaces another.
    for (const key of keys) {
      const collection = value[key] as unknown[];
      for (const [index, raw] of collection.entries()) {
        const path = `${key}[${index}]`;
        if (typeof raw !== 'string' && !object(raw)) {
          transformations.push({ path, operation: 'unresolved', reason: 'Finding has no interpretable observation.', original: raw });
          continue;
        }
        const item = typeof raw === 'string' ? {} : raw;
        const observed = typeof raw === 'string' ? raw.trim() : firstText(item.observed, item.problem, item.message, item.cause, item.description);
        if (!observed) {
          transformations.push({ path, operation: 'unresolved', reason: 'Finding has no observed defect or advisory text.', original: raw });
          continue;
        }
        const expected = firstText(item.expected);
        const evidence = firstText(item.evidence);
        const file = firstText(item.file, item.location);
        const fix = firstText(item.fix, item.action, item.guidance);
        const evidenceType = ['source','verification','inspection-command'].includes(firstText(item.evidenceType)) ? firstText(item.evidenceType) as NonNullable<ReviewFinding['evidenceType']> : undefined;
        const reproduction = object(item.verification) ? item.verification : object(item.reproduction) ? item.reproduction : undefined;
        const declaredKind = firstText(item.kind, item.category);
        const kind = failureKinds.has(declaredKind as ReviewFailureKind) ? declaredKind as ReviewFailureKind : 'product';
        const explicitlyAdvisory = item.material === false || ['suggestion', 'style', 'info', 'advisory'].includes(firstText(item.severity).toLowerCase());
        // Classification relies on explicit structure, never on words such as tests, coverage or EROFS.
        const explicitDefect = item.material === true || declaredKind === 'product' || Boolean(firstText(item.observed,item.problem));
        const disposition = explicitlyAdvisory && !explicitDefect && !expected && !evidence ? 'advisory' : 'defect';
        if (explicitlyAdvisory) transformations.push({ path, operation: 'classify', reason: disposition === 'defect' ? 'Behavioral evidence or an expected/observed contrast is preserved despite the advisory label.' : 'Explicitly advisory finding without behavioral evidence; retained for an explicit verdict resolution.', original: raw });
        if (declaredKind && declaredKind !== kind) transformations.push({ path: `${path}.kind`, operation: 'normalize', reason: `Unknown failure category ${declaredKind}; observation retained as a product claim, pending diagnosis.`, original: declaredKind });
        const finding: ReviewFinding = { id: identity({ path, raw }), kind, observed, disposition, text: '', original: raw, ...(expected ? { expected } : {}), ...(evidence ? { evidence } : {}), ...(file ? { file } : {}), ...(fix ? { fix } : {}), ...(evidenceType ? {evidenceType} : {}), ...(reproduction ? {reproduction:structuredClone(reproduction)} : {}) };
        finding.text = reviewFindingText(finding);
        findings.push(finding);
      }
    }
    if (keys.some(key => key !== 'findings')) transformations.push({ path: 'findings', operation: 'normalize', reason: 'Alternative finding collections were normalized without discarding the original collections.' });
  } else {
    const text = original.trim();
    explicitApproval = /^(?:approved|complete|correct|aprovado|correto|no material defects(?: found)?|no defects found|nenhum defeito material|sem defeitos materiais)\s*[.!]?$/i.test(text);
    if (!explicitApproval) transformations.push({ path: '$', operation: 'unresolved', reason: 'The response has no explicit usable verdict. Its original text is preserved for a bounded clarification.' });
  }
  const actionableFindings = findings.filter(finding => finding.disposition === 'defect');
  const advisories = findings.filter(finding => finding.disposition === 'advisory');
  let decision: ReviewAssessment['decision'] = 'unresolved';
  if (actionableFindings.length) {
    decision = 'rejected';
    if (explicitApproval) transformations.push({ path: '$', operation: 'classify', reason: 'An approval accompanied by a defect is inconsistent; the defect remains actionable.' });
  } else if (explicitApproval && !explicitRejection && !transformations.some(change => change.operation === 'unresolved')) decision = 'approved';
  else if (explicitRejection) transformations.push({ path: '$', operation: 'unresolved', reason: 'rejection-without-actionable-findings: an explicit resolution is required; this is neither approval nor a request to edit code.' });
  return { decision, approved: decision === 'approved', findings, actionableFindings, advisories, original, transformations, readable: value !== null && (explicitApproval || explicitRejection || findings.length > 0) || explicitApproval };
}

export interface ReviewFailureContext {
  purpose: 'inspection' | 'verification';
  writeScope: 'read-only' | 'workspace' | 'isolated-workspace';
  /** True only when the runtime actually applied filesystem isolation. */
  sandboxApplied?: boolean;
}

/** EROFS in a product log is not sufficient to blame the instrument. Policy and origin matter. */
export function classifyReviewFailure(result: Pick<CommandResult, 'exitCode' | 'stdout' | 'stderr' | 'issue' | 'cancelled' | 'timedOut'>, context: ReviewFailureContext): ReviewFailureKind | null {
  if (result.cancelled || result.timedOut || ['transport', 'authentication', 'rate-limit', 'capacity'].includes(result.issue?.kind ?? '')) return 'transport';
  if (result.issue?.kind === 'instrument') return 'instrument';
  if (result.exitCode === 0 && !result.issue) return null;
  const permissionDenied = /\b(?:EROFS|EACCES|EPERM)\b|read.only file system|permission denied|operation not permitted/i.test(`${result.stderr}\n${result.stdout}`);
  if (permissionDenied && (context.writeScope === 'read-only' || context.sandboxApplied === true)) return 'instrument';
  if (result.issue?.kind === 'configuration') return 'environment';
  return 'product';
}
