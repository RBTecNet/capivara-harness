import { isDeepStrictEqual } from 'node:util';
import { delimiter, resolve } from 'node:path';
import type { DevelopmentPlan, Verification } from '../domain/types.js';
import { literalInvocationArguments } from '../runtime/invocation.js';
import type { CommandRequest } from '../runtime/types.js';
import { interfaceEvidenceUsable, type VerificationOutcome } from './checks.js';
import { digest } from './files.js';
import type { VerificationEvidence } from './types.js';

export interface NarrowedWebRecipe {
  check: Verification;
  transformation: {
    schema: 'capivara/verification-interface-recovery/1';
    reason: 'successful-command-without-browser-interaction';
    sourceEvidenceId: string;
    original: Verification;
    selected: Verification;
    /** Narrowing the instrument does not discharge the product interface. */
    interfaceObligation: 'web-still-required';
    matchedDerivedBuildId?: string;
  };
}

function literalRecipe(check: Verification): { argv: string[]; cwd: string } | undefined {
  if (!check.command) return undefined;
  const parsed = literalInvocationArguments(check.command);
  if (!check.args) return parsed?.length ? { argv: parsed, cwd: check.cwd ?? '.' } : undefined;
  const duplicated = parsed && parsed.length > 1 && (check.args.length === 0 || parsed.length === check.args.length + 1 && check.args.every((arg, index) => arg === parsed[index + 1]));
  return { argv: duplicated ? parsed : [check.command, ...check.args], cwd: check.cwd ?? '.' };
}

/** Recover the scope of an observed command, never manufacture a browser
 * receipt. The returned declaration still needs its own execution and review. */
export function narrowUnobservedWebRecipe(check: Verification, outcome: Pick<VerificationOutcome, 'classification' | 'evidence' | 'result'>, derivedChecks: readonly Verification[] = []): NarrowedWebRecipe | undefined {
  if (check.kind !== 'web' || outcome.classification !== 'instrument' || outcome.evidence.passed) return undefined;
  const observation = outcome.result ?? outcome.evidence.observation;
  if (!observation || observation.exitCode !== 0 || observation.issue || observation.cancelled || observation.timedOut) return undefined;
  const browser = outcome.evidence.browserObservation;
  if (browser?.schema !== 'capivara/browser-interaction/1' || !Array.isArray(browser.witnesses) || browser.witnesses.length !== 0 || !Array.isArray(browser.diagnostics) || browser.diagnostics.length !== 0) return undefined;
  const invocation = literalRecipe(check);
  const build = invocation ? derivedChecks.find(candidate => candidate.level === 'build' && isDeepStrictEqual(literalRecipe(candidate), invocation)) : undefined;
  const selected = structuredClone(check);
  selected.kind = 'command';
  selected.level = build ? 'build' : check.level === 'syntax' ? 'syntax' : 'behavior';
  selected.requiredCapabilities = selected.requiredCapabilities.filter(capability => capability !== 'browser' && capability !== 'web-browser');
  if (selected.target === 'browser') delete selected.target;
  return {
    check: selected,
    transformation: {
      schema: 'capivara/verification-interface-recovery/1',
      reason: 'successful-command-without-browser-interaction',
      sourceEvidenceId: outcome.evidence.id,
      original: structuredClone(check), selected: structuredClone(selected),
      interfaceObligation: 'web-still-required',
      ...(build ? { matchedDerivedBuildId: build.id } : {}),
    },
  };
}

export interface InterfaceInvocationIdentity {
  requiredKind: Exclude<Verification['kind'], 'command'>;
  /** Concrete delivery reads/writes, independent of proposed recipe labels. */
  sourceStamp: string;
  /** The caller supplies the selected operational command/environment. */
  request: Pick<CommandRequest, 'command' | 'cwd' | 'environment'>;
  workspace?: string;
}

/** Identity of an unsuccessful interface instrument, not its model-assigned
 * ID, label or predicate. Reusing this key requires the same source and host. */
export function interfaceInvocationKey(options: InterfaceInvocationIdentity): string {
  if (!options.sourceStamp) throw new Error('An interface invocation identity requires its concrete delivery source stamp.');
  const root = options.workspace ? resolve(options.workspace).replaceAll('\\', '/') : undefined;
  const portable = (value: string): string => {
    if (!root) return value;
    const path = value.replaceAll('\\', '/');
    return path === root ? '$WORKSPACE' : path.startsWith(`${root}/`) ? `$WORKSPACE${path.slice(root.length)}` : value;
  };
  const command = typeof options.request.command === 'string'
    ? literalInvocationArguments(options.request.command) ?? { shell: options.request.command }
    : [...options.request.command];
  const invocation = Array.isArray(command) ? command.map(portable) : command;
  const environment = Object.fromEntries(Object.entries(options.request.environment ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, value.split(delimiter).map(portable).join(delimiter)]));
  return digest(JSON.stringify({ schema: 'capivara/interface-invocation/1', requiredKind: options.requiredKind, sourceStamp: options.sourceStamp, invocation, cwd: portable(resolve(options.request.cwd)), environment }));
}

export interface RecordedInterfaceCandidateOptions {
  plan: DevelopmentPlan;
  targetTaskId: string;
  target: Verification;
  requiredKind: Exclude<Verification['kind'], 'command'>;
  /** Records identify useful instruments; none is adopted as the new proof. */
  evidence: readonly VerificationEvidence[];
  taskChecks?: Readonly<Record<string, readonly Verification[]>>;
  workspace: string;
  sourceWorkspaces?: Readonly<Record<string, readonly string[]>>;
}

export interface RecordedInterfaceCandidate {
  check: Verification;
  transformation: {
    schema: 'capivara/recorded-interface-candidate/1';
    sourceEvidenceId: string;
    sourceTaskId: string;
    sourceCheckId: string;
    original: Verification;
    selected: Verification;
    sharedRequirementIds: string[];
    validation: 'fresh-execution-and-review-required';
  };
}

function relatedOwners(plan: DevelopmentPlan, left: string, right: string): boolean {
  const owners = new Set(plan.tasks.map(task => task.id));
  if (left === '$acceptance' || right === '$acceptance') return (left === '$acceptance' || owners.has(left)) && (right === '$acceptance' || owners.has(right));
  if (!owners.has(left) || !owners.has(right)) return false;
  const reaches = (start: string, target: string): boolean => {
    const pending = [start], seen = new Set<string>();
    while (pending.length) {
      const id = pending.pop()!;
      if (id === target) return true;
      if (seen.has(id)) continue;
      seen.add(id); pending.push(...(plan.tasks.find(task => task.id === id)?.dependsOn ?? []));
    }
    return false;
  };
  return reaches(left, right) || reaches(right, left);
}

function physicallyObserved(check: Verification, evidence: VerificationEvidence, kind: RecordedInterfaceCandidateOptions['requiredKind']): boolean {
  if (!evidence.passed || check.kind !== kind || evidence.kind !== kind || evidence.level !== 'behavior' || !check.command || !evidence.provenance || evidence.provenance.cancelled || evidence.provenance.timedOut) return false;
  const observation = evidence.observation;
  if (!observation || observation.issue || observation.cancelled || observation.timedOut) return false;
  if (kind === 'web') return interfaceEvidenceUsable(check, evidence);
  if (kind === 'cli') return observation.exitCode === (check.expectedExitCode ?? 0);
  if (kind !== 'tui' || !evidence.terminal || !observation.terminal) return false;
  let ready = false, input = false;
  for (const step of check.steps ?? []) {
    if (step.input && ready) input = true;
    if (step.waitFor) { if (input) return true; ready = true; }
  }
  return false;
}

function relocatedRecipe(check: Verification, roots: readonly string[], workspace: string): Verification {
  const known = [...new Set(roots.filter(Boolean).map(root => resolve(root)))].filter(root => root !== resolve(workspace)).sort((a, b) => b.length - a.length);
  const pattern = known.length ? new RegExp(known.map(root => root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g') : undefined;
  const relocate = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return pattern ? value.replace(pattern, (match, offset: number, whole: string) => {
        const before = whole[offset - 1], after = whole[offset + match.length];
        return (!before || /[\s'"=:(]/.test(before) || whole.slice(0, offset).endsWith('file://')) && (!after || after === '/' || after === '\\') ? resolve(workspace) : match;
      }) : value;
    }
    if (Array.isArray(value)) return value.map(relocate);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, relocate(item)]));
    return value;
  };
  return relocate(check) as Verification;
}

/** Borrow only a recipe whose interface was actually observed in this plan.
 * Both directions of the DAG are useful during revalidation of predecessors. */
export function candidateFromRecordedInterfaceProof(options: RecordedInterfaceCandidateOptions): RecordedInterfaceCandidate | undefined {
  const required = new Set(options.target.requirementIds);
  if (!required.size) return undefined;
  for (const evidence of [...options.evidence].reverse()) {
    if (!relatedOwners(options.plan, options.targetTaskId, evidence.taskId)) continue;
    const checks = options.taskChecks?.[evidence.taskId] ?? (evidence.taskId === '$acceptance' ? options.plan.acceptance : options.plan.tasks.find(task => task.id === evidence.taskId)?.checks);
    const candidates = checks?.filter(check => check.id === evidence.checkId) ?? [];
    if (candidates.length !== 1) continue;
    const peer = candidates[0]!;
    const shared = peer.requirementIds.filter(id => required.has(id));
    if (!shared.length || !physicallyObserved(peer, evidence, options.requiredKind)) continue;
    const relocated = relocatedRecipe(peer, [...options.sourceWorkspaces?.[evidence.taskId] ?? [], evidence.provenance!.workspace], options.workspace);
    const { conformance: _foreignClaim, declarationTransformation: _oldInterfaceLabel, recipeCandidate: _oldManifestReceipt, ...recipe } = relocated;
    const selected: Verification = {
      ...recipe, id: options.target.id, kind: options.requiredKind,
      requirementIds: [...options.target.requirementIds],
      requiredCapabilities: [...new Set([...options.target.requiredCapabilities, ...recipe.requiredCapabilities])],
      ...(options.target.expected !== undefined ? { expected: options.target.expected } : {}),
      ...(options.target.constraintIds?.length ? { constraintIds: [...new Set([...options.target.constraintIds, ...recipe.constraintIds ?? []])] } : {}),
    };
    return { check: selected, transformation: { schema: 'capivara/recorded-interface-candidate/1', sourceEvidenceId: evidence.id, sourceTaskId: evidence.taskId, sourceCheckId: peer.id, original: structuredClone(peer), selected: structuredClone(selected), sharedRequirementIds: [...new Set(shared)], validation: 'fresh-execution-and-review-required' } };
  }
  return undefined;
}
