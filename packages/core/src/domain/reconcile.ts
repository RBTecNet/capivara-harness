import { matchesGlob } from 'node:path';
import { allowedCapabilities, identity, inferredCapabilities, normalize, requestedCapabilities } from './authority.js';
import { ordered } from './context.js';
import { PlanningFailure } from './control.js';
import { verificationAssertionStatus } from './assertions.js';
import type { DevelopmentPlan, ProductBrief, Requirement, Verification, VerificationAssertion, WorkUnit } from './types.js';

export interface PlanIssue { code: string; subject: string; message: string; environmentIds?: string[]; taskIds?: string[]; }
const canonical = (text: string): string => normalize(text).replace(/[^\p{L}\p{N}+#.]+/gu, ' ').trim().replace(/\s+/g,' ');
const unique = (items: string[]): string[] => [...new Set(items)];
const outcome = (task: WorkUnit): string => canonical(task.goal);
const output = (path: string): string => path.replaceAll('\\','/').replace(/^\.\//,'').replace(/\/$/,'');
const sameValues = (left: string[], right: string[]): boolean => JSON.stringify(unique(left).sort()) === JSON.stringify(unique(right).sort());
const literalPath = (path: string): boolean => !/[?*{[\]()]/.test(path);
function coversOutput(scope: string, path: string): boolean {
  scope = output(scope); path = output(path);
  if (scope === path) return true;
  if (literalPath(scope) && path.startsWith(`${scope}/`)) return true;
  if (literalPath(path) && matchesGlob(path, scope)) return true;
  return scope.endsWith('/**') && path.startsWith(`${scope.slice(0, -3)}/`);
}
function compatibleOutputs(left: string[], right: string[]): boolean {
  // A refinement may add files or narrow an existing directory/glob. A shared
  // incidental file alone cannot combine two otherwise disjoint deliveries.
  return left.every(path => right.some(other => coversOutput(path, other) || coversOutput(other, path)))
    || right.every(path => left.some(other => coversOutput(path, other) || coversOutput(other, path)));
}
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
/** Stable IDs plus output ownership identify sliced deliveries, independently
 * of the language used to describe them. Distinct IDs stay conservative. */
export function sameDelivery(left: WorkUnit, right: WorkUnit): boolean {
  if (left.id === right.id) {
    if (left.files.length && right.files.length) return compatibleOutputs(left.files, right.files);
    if (left.contractIds.length && right.contractIds.length && !left.contractIds.some(id => right.contractIds.includes(id))) return false;
    return outcome(left) === outcome(right) || !!left.contractIds.length && sameValues(left.contractIds, right.contractIds);
  }
  if (outcome(left) !== outcome(right)) return false;
  if (left.files.length || right.files.length) return !!left.files.length && !!right.files.length && compatibleOutputs(left.files, right.files);
  return sameValues(left.requirementIds,right.requirementIds) && sameValues(left.criteria.map(canonical),right.criteria.map(canonical)) && sameValues(left.checks.map(recipeKey),right.checks.map(recipeKey));
}
function assertionIdentity(assertion: VerificationAssertion): VerificationAssertion {
  if (assertion.type === 'all' || assertion.type === 'any') return { ...assertion, assertions: assertion.assertions.map(assertionIdentity) };
  if (assertion.type === 'json') return { ...assertion, source: assertion.source ?? 'stdout' };
  return assertion.type === 'exit' ? assertion : { ...assertion, source: assertion.source ?? 'stdout' };
}
const recipeKey = (check: Verification): string => {
  const { id: _id, requirementIds: _requirements, constraintIds: _constraints, dependsOn, expected, assertion, ...recipe } = check;
  const selected = verificationAssertionStatus(check);
  const predicate = selected.status === 'ready' ? { assertion: assertionIdentity(selected.assertion!) }
    : selected.status === 'missing' && (check.level === 'build' || check.level === 'syntax') ? {}
      : { expected, assertion };
  return JSON.stringify({ ...recipe, dependsOn: unique(dependsOn ?? []).sort(), ...predicate }, (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) : value);
};

/** Duplicate recipes retain all consumers; identifier collisions never overwrite a different proof. */
export function reconcileChecks(checks: Verification[]): Verification[] {
  const byRecipe = new Map<string, Verification>();
  const usedIds = new Map<string, string>();
  const aliases = new Map<string, string>();
  for (const original of checks) {
    const check = structuredClone(original);
    const key = recipeKey(check);
    const earlier = byRecipe.get(key);
    if (earlier) {
      earlier.requirementIds = unique([...earlier.requirementIds, ...check.requirementIds]);
      if (earlier.constraintIds || check.constraintIds) earlier.constraintIds = unique([...(earlier.constraintIds ?? []), ...(check.constraintIds ?? [])]);
      if (earlier.dependsOn || check.dependsOn) earlier.dependsOn = unique([...(earlier.dependsOn ?? []), ...(check.dependsOn ?? [])]);
      if (check.expected && earlier.expected !== check.expected && !earlier.expected?.includes(check.expected)) {
        // A combined human description no longer has the legacy parser's
        // machine syntax. Materialize that same predicate only when merging.
        const selected = verificationAssertionStatus(earlier);
        if (!earlier.assertion && selected.status === 'ready') earlier.assertion = structuredClone(selected.assertion!);
        earlier.expected = earlier.expected ? `${earlier.expected}\n${check.expected}` : check.expected;
      }
      if (check.id !== earlier.id && (!usedIds.has(check.id) || usedIds.get(check.id) === key)) aliases.set(check.id, earlier.id);
      if (!usedIds.has(check.id)) usedIds.set(check.id, key);
      continue;
    }
    if (usedIds.has(check.id) && usedIds.get(check.id) !== key) check.id = identity(`check-${check.id}`, key);
    usedIds.set(check.id, key); byRecipe.set(key, check);
  }
  const resolve = (id: string): string => { const seen = new Set<string>(); while (aliases.has(id) && !seen.has(id)) { seen.add(id); id = aliases.get(id)!; } return id; };
  const result = [...byRecipe.values()];
  for (const check of result) if (check.dependsOn) check.dependsOn = unique(check.dependsOn.map(resolve));
  return result;
}

/** Reconcile deliveries, not source fragments. Omitted old deliveries are retired on full replanning. */
export function reconcilePlan(brief: ProductBrief, proposal: DevelopmentPlan, previous?: DevelopmentPlan): DevelopmentPlan {
  const plan = structuredClone(proposal);
  const byId = new Map<string, WorkUnit>();
  const aliases = new Map<string, string>();
  const tasks: WorkUnit[] = [];
  for (const original of plan.tasks) {
    const task = structuredClone(original);
    const idCollision = byId.get(task.id) ?? byId.get(aliases.get(task.id) ?? '');
    const identified = idCollision && idCollision.id !== task.id ? { ...task, id: idCollision.id } : task;
    if (idCollision && !sameDelivery(idCollision, identified)) throw new PlanningFailure('invalid-plan', [`O identificador ${task.id} representa duas entregas diferentes com propriedade de saídas incompatível: ${idCollision.goal}; ${task.goal}.`], 'reconcile');
    const earlier = idCollision ?? tasks.find(candidate => sameDelivery(candidate, task));
    if (earlier) {
      aliases.set(task.id, earlier.id);
      for (const field of ['requirementIds','dependsOn','environmentIds','contractIds','files','criteria','blockedBy'] as const) earlier[field] = unique([...earlier[field], ...task[field]]);
      if (earlier.inputs || task.inputs) earlier.inputs = unique([...(earlier.inputs ?? []), ...(task.inputs ?? [])]);
      if (earlier.resources || task.resources) earlier.resources = unique([...(earlier.resources ?? []), ...(task.resources ?? [])]);
      if (earlier.exclusiveContracts || task.exclusiveContracts) earlier.exclusiveContracts = unique([...(earlier.exclusiveContracts ?? []), ...(task.exclusiveContracts ?? [])]);
      earlier.checks = reconcileChecks([...earlier.checks, ...task.checks]);
      if (task.goal !== earlier.goal && !earlier.instructions.includes(task.goal)) earlier.instructions += `\n${task.goal}`;
      if (!earlier.instructions.includes(task.instructions)) earlier.instructions += `\n${task.instructions}`;
      if (['low','normal','high'].indexOf(task.risk) > ['low','normal','high'].indexOf(earlier.risk)) earlier.risk = task.risk;
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
  const issue = (code: string, subject: string, message: string, references: Pick<PlanIssue, 'environmentIds' | 'taskIds'> = {}): void => { issues.push({code,subject,message,...references}); };
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
    const consumers = plan.tasks.filter(task => task.requirementIds.includes(requirement.id));
    const references = { environmentIds: matches.map(node => node.id), taskIds: consumers.map(task => task.id) };
    const providers = new Set(matches.map(node => node.id));
    const consumes = (id: string, seen = new Set<string>()): boolean => {
      if (providers.has(id)) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return plan.environment.find(node => node.id === id)?.dependsOn.some(dependency => consumes(dependency, seen)) ?? false;
    };
    if (!matches.length) issue('mandatory-provider-mismatch',requirement.id,`A capacidade ${binding.capability} (${binding.kind}) deve usar ${binding.provider}; o plano não oferece esse provedor.`, { ...references, environmentIds: nodes.map(node => node.id) });
    else if (!plan.tasks.some(task => task.environmentIds.some(id => consumes(id)))) issue('unused-mandatory-provider',requirement.id,`O provedor obrigatório ${binding.provider}, declarado em ${references.environmentIds.join(', ')}, não é consumido diretamente nem por dependências explícitas das entregas. Consumidores do requisito: ${references.taskIds.join(', ') || 'nenhum'}.`, references);
    const proof = [...plan.acceptance ?? []].some(check => check.requirementIds.includes(requirement.id) && check.command && check.level !== 'syntax' && check.conformance?.requirementId===requirement.id && check.conformance.capability===binding.capability && check.conformance.kind===binding.kind && check.conformance.provider===binding.provider && check.conformance.productInputs.length>0);
    if (!proof) issue('unproven-mandatory-provider',requirement.id,`A conformidade com ${binding.provider} precisa de uma receita de aceite dedicada, vinculada à capacidade e a arquivos reais do produto. Disponibilidade e sintaxe não provam uso.`);
  }
  return issues;
}

export function assertValidPlan(brief: ProductBrief, plan: DevelopmentPlan): void {
  const issues = validatePlan(brief, plan);
  if (issues.length) throw new PlanningFailure('invalid-plan', issues.map(issue => `${issue.code} [${issue.subject}]: ${issue.message}`));
}
