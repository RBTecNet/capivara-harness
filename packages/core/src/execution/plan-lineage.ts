import { statSync } from 'node:fs';
import { matchesGlob } from 'node:path';
import { normalizeTasks } from '../domain/plan.js';
import { jsonObject } from '../domain/json.js';
import type { DevelopmentPlan, ProductBrief, WorkUnit } from '../domain/types.js';
import { digest } from './files.js';
import { pathScopesConflict } from './isolation.js';
import type { BuildState, TaskProgress } from './types.js';

export type PlanDomainCalls = Readonly<Record<string, { status?: string; result?: unknown }>>;
export interface CollectedTaskDefinition {
  definition: WorkUnit;
  hash: string;
  source: 'current-plan' | 'persisted-definition' | 'domain-call';
  sourceId: string;
}
export interface RestoredPlanLineage {
  previousTaskId: string;
  replacementTaskId: string;
  /** Exact retired contract; task IDs alone do not identify later proposals. */
  replacementDefinitionHash?: string;
  previousDefinitionHash: string;
  definitionHash: string;
  /** Effective task retains the original delivery and the replacement's proof configuration. */
  definition: WorkUnit;
  previousDefinition: WorkUnit;
  checkpointDirectory?: string;
  replacementCheckpointDirectory?: string;
  source: CollectedTaskDefinition['source'];
  sourceId: string;
}
const hash = (task: WorkUnit): string => digest(JSON.stringify(task));
const unique = (items: readonly string[]): string[] => [...new Set(items)];
const sameRequirements = (left: WorkUnit, right: WorkUnit): boolean => JSON.stringify(unique(left.requirementIds).sort()) === JSON.stringify(unique(right.requirementIds).sort());
const present = (path: string): boolean => { try { return statSync(path).isDirectory(); } catch { return false; } };
const covers=(parent:WorkUnit,child:WorkUnit):boolean=>child.files.every(path=>parent.files.some(scope=>scope===path||!/[?*{[]/.test(scope)&&path.startsWith(`${scope.replace(/\/$/,'')}/`)||!/[?*{[]/.test(path)&&matchesGlob(path,scope)));

function wasRetired(id: string, reference: string, progress: TaskProgress, definitions: readonly CollectedTaskDefinition[], state: BuildState): boolean {
  const checkpoint = progress.checkpoint;
  const usableProposal = checkpoint && ['checking', 'reviewing'].includes(checkpoint.phase) && present(checkpoint.directory);
  // Retirement removes the old checkpoint. A new private proposal is real work,
  // even if its delivery contract happens to have the same task identity.
  const retired = (state.planLineage ?? []).filter(entry => entry.replacementTaskId === id);
  const identities = unique(definitions.filter(item => item.definition.id === id).map(item => item.hash));
  for (const entry of retired) {
    const retiredHash = entry.replacementDefinitionHash ?? (identities.length === 1 ? identities[0] : undefined);
    if (retiredHash !== reference) continue;
    if (usableProposal && checkpoint.directory !== entry.replacementCheckpointDirectory) continue;
    return true;
  }
  // Older snapshots did not record the retired hash. Their explicit retirement
  // marker still identifies the saved, approved definition, never a new proposal.
  return !usableProposal && progress.strategy === 'superseded-plan-lineage' && progress.definitionHash === reference;
}

/** Recover only exact definitions. Similar prose cannot establish a proposal's identity. */
export function collectTaskDefinitions(brief: ProductBrief, plan: DevelopmentPlan, state: BuildState, domainCalls: PlanDomainCalls = {}): CollectedTaskDefinition[] {
  const definitions: CollectedTaskDefinition[] = [], seen = new Set<string>();
  const add = (definition: WorkUnit, source: CollectedTaskDefinition['source'], sourceId: string): void => {
    const identity = hash(definition), key = `${definition.id}:${identity}`;
    if (seen.has(key)) return;
    seen.add(key); definitions.push({ definition: structuredClone(definition), hash: identity, source, sourceId });
  };
  for (const [id, definition] of Object.entries(state.taskDefinitionHistory ?? {})) if (hash(definition) === id) add(definition, 'persisted-definition', id);
  for (const [id, definition] of Object.entries(state.taskDefinitions ?? {})) if (definition.id === id) add(definition, 'persisted-definition', id);
  for (const definition of plan.tasks) add(definition, 'current-plan', definition.id);
  for (const [id, call] of Object.entries(domainCalls)) {
    if (call.status !== 'complete' || call.result === undefined) continue;
    const value = typeof call.result === 'string' ? jsonObject(call.result) : call.result;
    if (!value || typeof value !== 'object' || !('tasks' in value) || !Array.isArray(value.tasks)) continue;
    try { for (const task of normalizeTasks(value.tasks, brief, plan.environment, plan.contracts)) add(task, 'domain-call', id); }
    catch { /* A malformed historical response is not a source of execution authority. */ }
  }
  return definitions;
}

/**
 * Rescues a uniquely identified, unintegrated proposal after a proof-only plan
 * replacement lost its task ID. It changes coordinator metadata only; normal
 * verification, independent review and integration still govern publication.
 */
export function recoverPlanLineage(brief: ProductBrief, current: DevelopmentPlan, state: BuildState, domainCalls: PlanDomainCalls = {}): { plan: DevelopmentPlan; restored: RestoredPlanLineage[] } {
  const plan = structuredClone(current), definitions = collectTaskDefinitions(brief, plan, state, domainCalls);
  const currentIds = new Set(plan.tasks.map(task => task.id));
  const pairs: { previousTaskId: string; progress: TaskProgress; definition: CollectedTaskDefinition; replacement: WorkUnit }[] = [];
  for (const [id, progress] of Object.entries(state.tasks)) {
    const checkpoint = progress.checkpoint;
    if (id.startsWith('$') || currentIds.has(id))continue;
    if(progress.status==='complete'&&!progress.definitionHash)continue;
    const approved=progress.status==='complete'&&!!progress.definitionHash;
    if(!approved&&(!checkpoint||!['checking','reviewing'].includes(checkpoint.phase)||!present(checkpoint.directory)))continue;
    const reference=approved?progress.definitionHash:checkpoint?.taskHash;
    if (reference && wasRetired(id, reference, progress, definitions, state)) continue;
    const exact = definitions.filter(item => item.definition.id === id && item.hash === reference);
    if (exact.length !== 1) continue;
    const definition = exact[0]!;
    const candidates = plan.tasks.filter(task => {
      const proven=state.tasks[task.id]?.status==='complete'&&state.evidence.some(proof=>proof.taskId===task.id&&proof.passed&&proof.level==='behavior');
      return !proven&&sameRequirements(definition.definition, task)&&definition.definition.files.some(path=>task.files.some(other=>pathScopesConflict(path,other)));
    });
    if (candidates.length !== 1) continue;
    pairs.push({ previousTaskId: id, progress, definition, replacement: candidates[0]! });
  }
  // Successive proof-only replacements can leave several narrow orphaned
  // proposals. The unique original with strictly containing output ownership
  // retains the delivery; equally broad proposals remain ambiguous.
  const maximal=pairs.filter(pair=>!pairs.some(other=>other!==pair&&other.replacement.id===pair.replacement.id&&covers(other.definition.definition,pair.definition.definition)&&!covers(pair.definition.definition,other.definition.definition)));
  let selected = maximal.filter(pair => maximal.filter(other => other.replacement.id === pair.replacement.id).length === 1);
  for (;;) {
    const aliases = new Map(selected.map(pair => [pair.replacement.id, pair.previousTaskId]));
    const effectiveIds = new Set(plan.tasks.map(task => aliases.get(task.id) ?? task.id));
    const complete = selected.filter(pair => pair.definition.definition.dependsOn.every(id => effectiveIds.has(aliases.get(id) ?? id)));
    if (complete.length === selected.length) break;
    selected = complete;
  }
  const aliases = new Map(selected.map(pair => [pair.replacement.id, pair.previousTaskId]));
  const restored: RestoredPlanLineage[] = [];
  for (const pair of selected) {
    const original = structuredClone(pair.definition.definition), replacement = pair.replacement;
    const definition: WorkUnit = { ...original, checks: structuredClone(pair.progress.status==='complete'?pair.progress.checks??original.checks:replacement.checks.length?replacement.checks:original.checks), environmentIds: unique([...original.environmentIds, ...replacement.environmentIds]) };
    if (original.inputs || replacement.inputs) definition.inputs = unique([...(original.inputs ?? []), ...(replacement.inputs ?? [])]);
    definition.dependsOn = unique(definition.dependsOn.map(id => aliases.get(id) ?? id));
    const replacementProgress = state.tasks[replacement.id], proposal = replacementProgress?.checkpoint?.directory;
    for(const intermediate of pairs.filter(other=>other!==pair&&other.replacement.id===replacement.id)){
      const directory=intermediate.progress.checkpoint?.directory;
      if(directory)pair.progress.proposals=unique([...(pair.progress.proposals??[]),directory]);
      delete intermediate.progress.checkpoint;delete intermediate.progress.verificationCheckpoint;intermediate.progress.strategy='superseded-plan-lineage';
    }
    if (proposal && proposal !== pair.progress.checkpoint?.directory) pair.progress.proposals = unique([...(pair.progress.proposals ?? []), proposal]);
    if (replacementProgress) { delete replacementProgress.checkpoint; delete replacementProgress.verificationCheckpoint; replacementProgress.strategy = 'superseded-plan-lineage'; }
    if(pair.progress.checkpoint){pair.progress.checkpoint.taskHash = hash(definition);pair.progress.checkpoint.phase = 'checking';}
    pair.progress.status = 'checking'; pair.progress.strategy = 'recover-plan-lineage'; pair.progress.checks = structuredClone(definition.checks);
    delete pair.progress.suspension; delete pair.progress.verificationCheckpoint;
    plan.tasks[plan.tasks.findIndex(task => task.id === replacement.id)] = definition;
    restored.push({ previousTaskId: pair.previousTaskId, replacementTaskId: replacement.id, replacementDefinitionHash: hash(replacement), previousDefinitionHash: pair.definition.hash, definitionHash: hash(definition), definition: structuredClone(definition), previousDefinition: original, ...(pair.progress.checkpoint?{checkpointDirectory:pair.progress.checkpoint.directory}:{}), ...(proposal ? { replacementCheckpointDirectory: proposal } : {}), source: pair.definition.source, sourceId: pair.definition.sourceId });
  }
  for (const task of plan.tasks) task.dependsOn = unique(task.dependsOn.map(id => aliases.get(id) ?? id));
  if (restored.length) plan.revision++;
  state.taskDefinitions ??= {};
  state.taskDefinitionHistory ??= {};
  for (const task of plan.tasks) { state.taskDefinitions[task.id] = structuredClone(task); state.taskDefinitionHistory[hash(task)] = structuredClone(task); }
  return { plan, restored };
}
