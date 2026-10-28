import { allowedCapabilities, identity, inferredCapabilities, normalize, requestedCapabilities } from './authority.js';
import { ordered } from './context.js';
import { PlanningFailure } from './control.js';
import type { DevelopmentPlan, ProductBrief, Requirement, Verification, WorkUnit } from './types.js';

export interface PlanIssue { code: string; subject: string; message: string; }
const canonical = (text: string): string => normalize(text).replace(/[^\p{L}\p{N}+#.]+/gu, ' ').trim().replace(/\s+/g,' ');
const unique = (items: string[]): string[] => [...new Set(items)];
const outcome = (task: WorkUnit): string => canonical(task.goal);
const output = (path: string): string => path.replaceAll('\\','/').replace(/^\.\//,'').replace(/\/$/,'');
type InteractionKind = 'cli' | 'tui' | 'web' | 'desktop';
/** A global product outcome belongs to its consumers, rather than every layer
 * sharing its requirement ID. Foundation code can be checked before a UI exists. */
export function requiredRequirementInterface(requirement: Requirement): InteractionKind | undefined {
  if (['cli','tui','web','desktop'].includes(requirement.mode)) return requirement.mode as InteractionKind;
  return requestedCapabilities(requirement.source.text).includes('browser') && (requirement.kind === 'interface' || /\b(?:fluxos?|flows?|intera\w*|execut\w*|navega\w*|browser)\b/.test(normalize(requirement.statement))) ? 'web' : undefined;
}
function dependsOn(plan: DevelopmentPlan, task: WorkUnit, prerequisite: string, seen = new Set<string>()): boolean {
  if (seen.has(task.id)) return false;
  seen.add(task.id);
  return task.dependsOn.some(id => id === prerequisite || !!plan.tasks.find(candidate => candidate.id === id && dependsOn(plan,candidate,prerequisite,seen)));
}
export function preferredProofOwner(plan: DevelopmentPlan, requirementId: string): WorkUnit | undefined {
  const consumers = plan.tasks.filter(task => task.requirementIds.includes(requirementId));
  return consumers.filter(task => !consumers.some(other => other.id !== task.id && dependsOn(plan,other,task.id))).sort((left,right) => {
    const weight = (task: WorkUnit): number => consumers.filter(other => other.id !== task.id && dependsOn(plan,task,other.id)).length;
    return weight(right)-weight(left) || plan.tasks.indexOf(right)-plan.tasks.indexOf(left);
  })[0];
}
const provesInterface = (check: Verification, requirementId: string, kind: InteractionKind): boolean => check.requirementIds.includes(requirementId) && !!check.command && check.level === 'behavior' && (check.kind === kind || kind === 'web' && check.requiredCapabilities.includes('browser'));
export function requiredTaskInterfaces(brief: ProductBrief, plan: DevelopmentPlan, task: WorkUnit): InteractionKind[] {
  const result = new Set<InteractionKind>();
  for (const requirement of brief.requirements.filter(candidate => task.requirementIds.includes(candidate.id))) {
    const kind = requiredRequirementInterface(requirement);
    if (!kind) continue;
    if (task.checks.some(check => provesInterface(check,requirement.id,kind))) { result.add(kind); continue; }
    if ((plan.acceptance ?? []).some(check => provesInterface(check,requirement.id,kind))) continue;
    const consumers = plan.tasks.filter(candidate => candidate.requirementIds.includes(requirement.id));
    if (!consumers.some(other => other.id !== task.id && dependsOn(plan,other,task.id))) result.add(kind);
  }
  return [...result];
}
/** Equal prose is insufficient: independent deliveries can have identical generic goals. */
export function sameDelivery(left: WorkUnit, right: WorkUnit): boolean {
  if (outcome(left) !== outcome(right)) return false;
  if (left.id === right.id) return true;
  if (left.files.length || right.files.length) return left.files.some(path=>right.files.some(other=>output(path)===output(other)));
  const same = (a: string[], b: string[]): boolean => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  return same(left.requirementIds,right.requirementIds) && same(left.criteria.map(canonical),right.criteria.map(canonical)) && same(left.checks.map(recipeKey),right.checks.map(recipeKey));
}
const recipeKey = (check: Verification): string => { const { id: _id, requirementIds: _requirements, constraintIds: _constraints, ...recipe } = check; return JSON.stringify(recipe); };

/** Duplicate recipes retain all consumers; identifier collisions never overwrite a different proof. */
export function reconcileChecks(checks: Verification[]): Verification[] {
  const byRecipe = new Map<string, Verification>();
  const usedIds = new Map<string, string>();
  for (const original of checks) {
    const check = structuredClone(original);
    const key = recipeKey(check);
    const earlier = byRecipe.get(key);
    if (earlier) {
      earlier.requirementIds = unique([...earlier.requirementIds, ...check.requirementIds]);
      if (earlier.constraintIds || check.constraintIds) earlier.constraintIds = unique([...(earlier.constraintIds ?? []), ...(check.constraintIds ?? [])]);
      continue;
    }
    if (usedIds.has(check.id) && usedIds.get(check.id) !== key) check.id = identity(`check-${check.id}`, key);
    usedIds.set(check.id, key); byRecipe.set(key, check);
  }
  return [...byRecipe.values()];
}

/** Reconcile deliveries, not source fragments. Omitted old deliveries are retired on full replanning. */
export function reconcilePlan(brief: ProductBrief, proposal: DevelopmentPlan, previous?: DevelopmentPlan): DevelopmentPlan {
  const plan = structuredClone(proposal);
  const byId = new Map<string, WorkUnit>();
  const aliases = new Map<string, string>();
  const tasks: WorkUnit[] = [];
  for (const original of plan.tasks) {
    const task = structuredClone(original);
    const key = outcome(task);
    const idCollision = byId.get(task.id);
    if (idCollision && outcome(idCollision) !== key) throw new PlanningFailure('invalid-plan', [`O identificador ${task.id} representa duas entregas diferentes: ${idCollision.goal}; ${task.goal}.`], 'reconcile');
    const earlier = tasks.find(candidate => sameDelivery(candidate, task));
    if (earlier) {
      aliases.set(task.id, earlier.id);
      for (const field of ['requirementIds','dependsOn','environmentIds','contractIds','files','criteria','blockedBy'] as const) earlier[field] = unique([...earlier[field], ...task[field]]);
      if (earlier.inputs || task.inputs) earlier.inputs = unique([...(earlier.inputs ?? []), ...(task.inputs ?? [])]);
      if (earlier.resources || task.resources) earlier.resources = unique([...(earlier.resources ?? []), ...(task.resources ?? [])]);
      if (earlier.exclusiveContracts || task.exclusiveContracts) earlier.exclusiveContracts = unique([...(earlier.exclusiveContracts ?? []), ...(task.exclusiveContracts ?? [])]);
      earlier.checks = reconcileChecks([...earlier.checks, ...task.checks]);
      if (!earlier.instructions.includes(task.instructions)) earlier.instructions += `\n${task.instructions}`;
      continue;
    }
    const stable = previous?.tasks.find(candidate=>sameDelivery(candidate,task))?.id;
    if (stable && !byId.has(stable)) { aliases.set(task.id, stable); task.id = stable; }
    task.checks = reconcileChecks(task.checks);
    byId.set(task.id, task); tasks.push(task);
  }
  const resolve = (id: string): string => { const seen = new Set<string>(); while (aliases.has(id) && !seen.has(id)) { seen.add(id); const next = aliases.get(id)!; if (next === id) break; id = next; } return id; };
  for (const task of tasks) {
    // A self dependency remains a planning defect, rather than being erased for a green DAG.
    task.dependsOn = unique(task.dependsOn.map(id => resolve(id)));
  }
  plan.tasks = tasks;
  if (plan.acceptance) plan.acceptance = reconcileChecks(plan.acceptance);
  plan.briefId = brief.id; plan.briefRevision = brief.revision;
  return plan;
}

/** Structural invariants are checked before scheduling and again before final acceptance. */
export function validatePlan(brief: ProductBrief, plan: DevelopmentPlan): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const issue = (code: string, subject: string, message: string): void => { issues.push({code,subject,message}); };
  const required = new Set(brief.requirements.map(requirement => requirement.id));
  const constraints = new Set(brief.constraints.map(constraint => constraint.id));
  const taskIds = new Set<string>();
  const environment = new Set<string>();
  const contracts = new Set(plan.contracts.map(contract => contract.id));
  for (const node of plan.environment) {
    if (environment.has(node.id)) issue('duplicate-environment', node.id, 'O mesmo identificador representa mais de um pré-requisito.');
    environment.add(node.id);
    if (node.kind === 'database' && !node.identity) issue('ambiguous-environment-kind', node.id, 'Uma dependência de banco precisa declarar se é CLI, driver, biblioteca ou serviço e qual provedor será consumido.');
    if (!node.check.command.trim()) issue('missing-readiness-recipe', node.id, 'A capacidade não possui sonda de prontidão executável.');
  }
  for (const node of plan.environment) for (const id of node.dependsOn) if (!environment.has(id)) issue('missing-environment-dependency',node.id,`Pré-requisito inexistente: ${id}.`);
  if (ordered(plan.environment).unresolved.length) issue('environment-cycle','environment','A árvore técnica contém ciclo ou referência ausente.');
  for (const task of plan.tasks) {
    if (taskIds.has(task.id)) issue('duplicate-task',task.id,'Identificador de tarefa duplicado.');
    taskIds.add(task.id);
    if (!task.goal.trim() || !task.criteria.length) issue('missing-outcome',task.id,'A tarefa precisa definir resultado observável e critérios.');
    if (!task.requirementIds.length) issue('ungrounded-task',task.id,'Nenhum requisito autoriza esta entrega.');
    for (const id of task.requirementIds) if (!required.has(id)) issue('unknown-requirement',task.id,`Requisito inexistente: ${id}.`);
    for (const id of task.environmentIds) if (!environment.has(id)) issue('missing-environment',task.id,`Capacidade inexistente: ${id}.`);
    for (const id of [...task.contractIds,...task.exclusiveContracts ?? []]) if (!contracts.has(id)) issue('missing-contract',task.id,`Contrato inexistente: ${id}.`);
    for (const check of task.checks) {
      for (const id of check.requirementIds) if (!required.has(id)) issue('unknown-proof-requirement',check.id,`A prova cita requisito inexistente: ${id}.`);
      for (const id of check.constraintIds ?? []) if (!constraints.has(id)) issue('unknown-proof-constraint',check.id,`A prova cita restrição inexistente: ${id}.`);
      if (!allowedCapabilities(brief, [...check.requiredCapabilities, ...inferredCapabilities(`${check.command ?? ''} ${(check.args ?? []).join(' ')}`), ...(check.kind === 'web' ? ['browser'] : [])])) issue('forbidden-proof-capability',check.id,'A receita usa uma capacidade incompatível com a autoridade atual; corrija a receita sem remover o resultado obrigatório.');
    }
  }
  for (const task of plan.tasks) for (const id of task.dependsOn) if (!taskIds.has(id)) issue('missing-task-dependency',task.id,`Dependência inexistente: ${id}.`);
  if (ordered(plan.tasks).unresolved.length) issue('task-cycle','tasks','O grafo de entregas contém ciclo ou referência ausente.');
  for (const requirement of brief.requirements) {
    if (!plan.tasks.some(task => task.requirementIds.includes(requirement.id))) issue('uncovered-requirement',requirement.id,'Nenhuma entrega cobre este requisito obrigatório.');
    const browserOutcome = requiredRequirementInterface(requirement) === 'web' && (requirement.kind === 'interface' || requestedCapabilities(requirement.source.text).includes('browser'));
    if (browserOutcome) {
      const proof = [...plan.acceptance ?? [], ...plan.tasks.flatMap(task => task.checks)].some(check => check.requirementIds.includes(requirement.id) && check.command && check.level === 'behavior' && (check.kind === 'web' || check.requiredCapabilities.includes('browser')));
      if (!proof) issue('unproven-interface-behavior',requirement.id,'O resultado exige comportamento real no navegador. Inclua uma receita executável de nível behavior, kind=web ou requiredCapabilities=[browser], vinculada a este requisito. Build, API e sintaxe não comprovam interação no navegador.');
    }
    if (!requirement.binding) continue;
    const binding = requirement.binding;
    const nodes = plan.environment.filter(node => node.identity && canonical(node.identity.capability) === canonical(binding.capability) && node.identity.kind === binding.kind);
    const matches = nodes.filter(node => canonical(node.identity!.provider) === canonical(binding.provider));
    if (!matches.length) issue('mandatory-provider-mismatch',requirement.id,`A capacidade ${binding.capability} (${binding.kind}) deve usar ${binding.provider}; o plano não oferece esse provedor.`);
    else if (!plan.tasks.some(task => task.environmentIds.some(id => matches.some(node => node.id === id)))) issue('unused-mandatory-provider',requirement.id,`O provedor obrigatório ${binding.provider} não é consumido pelas entregas.`);
    const proof = [...plan.acceptance ?? []].some(check => check.requirementIds.includes(requirement.id) && check.command && check.level !== 'syntax' && check.conformance?.requirementId===requirement.id && check.conformance.capability===binding.capability && check.conformance.kind===binding.kind && check.conformance.provider===binding.provider && check.conformance.productInputs.length>0);
    if (!proof) issue('unproven-mandatory-provider',requirement.id,`A conformidade com ${binding.provider} precisa de uma receita de aceite dedicada, vinculada à capacidade e a arquivos reais do produto. Disponibilidade e sintaxe não provam uso.`);
  }
  return issues;
}

export function assertValidPlan(brief: ProductBrief, plan: DevelopmentPlan): void {
  const issues = validatePlan(brief, plan);
  if (issues.length) throw new PlanningFailure('invalid-plan', issues.map(issue => `${issue.code} [${issue.subject}]: ${issue.message}`));
}
