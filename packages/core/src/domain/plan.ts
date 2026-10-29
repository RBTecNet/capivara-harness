import { allowedCapabilities, identity, inferredCapabilities, normalize } from "./authority.js";
import { contextForTask, ContextTooLarge, ordered } from "./context.js";
import { applyRepositoryConstraints, resolveQuestions } from "./init.js";
import { matchesGlob } from 'node:path';
import { engineeringRepairContext } from './engineering-context.js';
import { cancelled, object, records, requestObject, string, strings } from "./json.js";
import { boundedReferences } from "./material.js";
import type { CapabilityIdentity, CommandRecipe, DevelopmentPlan, DomainHooks, EnvironmentNode, IntegrationContract, PlanOptions, ProductBrief, Requirement, Verification, WorkUnit } from "./types.js";
import { emitEvent, emitProgress } from "../telemetry/progress.js";
import { PlanningFailure, PlanningProgress } from "./control.js";
import { assertValidPlan, derivePlanObligations, reconcileChecks, reconcilePlan, sameDelivery, validatePlan, resolveRequirementAlias } from "./reconcile.js";
import { normalizeVerificationAssertion } from "./assertions.js";
import { verificationAssertionStatus } from "./assertions.js";
import { verificationRegistry } from "./verifications.js";
import { deriveBindingAuthority, matchesOperationalClaim, obligationMatchesProvider, recordBindingTransformation } from "./bindings.js";
import type { PlanIssue } from "./reconcile.js";
import { rehydratePlanRecords } from "./plan-records.js";
import { verificationDeclaration } from './verification-declarations.js';
import { applyAuthorityAmendments } from './authority-repair.js';

const cleanId = (value: unknown, fallback: string): string => string(value).replace(/[^a-zA-Z0-9_.:-]+/g, "-") || fallback;
const unique = <T extends { id: string }>(items: T[]): T[] => [...new Map(items.map((item) => [item.id, item])).values()];
const uniqueStrings = (items: string[]): string[] => [...new Set(items)];
const argv = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const stableJson=(value:unknown):string=>JSON.stringify(value,(_key,item:unknown)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([left],[right])=>left.localeCompare(right))):item);
function environmentOperation(node:EnvironmentNode):string{
  const invocation=(command:CommandRecipe)=>({command:command.command,args:command.args??[],cwd:command.cwd??'.',system:command.system??false,timeoutMs:command.timeoutMs??null,capabilities:[...command.capabilities??[]].sort()});
  return stableJson({kind:node.kind,dependsOn:[...node.dependsOn].sort(),targets:[...node.targets].sort(),check:invocation(node.check),prepare:node.prepare.map(invocation),provides:node.provides??null});
}

function inferredEnvironmentIdentity(node:EnvironmentNode,brief:ProductBrief):Pick<EnvironmentNode,'identity'|'identityOrigin'>|undefined{
  if(node.identity)return undefined;
  const roles:Partial<Record<EnvironmentNode['kind'],CapabilityIdentity['kind']>>={runtime:'runtime',sdk:'sdk',tool:'cli',package:'library',service:'service'};
  const kind=roles[node.kind];if(!kind)return undefined;
  const exactName=(value:string):string=>value.normalize('NFC').trim().replace(/\s+/g,' ').toLowerCase();
  const candidates=brief.requirements.filter(requirement=>requirement.binding&&exactName(requirement.binding.provider)===exactName(node.name)).map(requirement=>{
    const authority=requirement.bindingAuthority??deriveBindingAuthority(requirement);
    const identity:CapabilityIdentity={provider:requirement.binding!.provider,kind,capability:authority?.capability.authority==='literal'?requirement.binding!.capability:node.id};
    return{requirement,identity};
  }).filter(({requirement,identity})=>obligationMatchesProvider(requirement,identity));
  const identities=new Map(candidates.map(candidate=>[stableJson(candidate.identity),candidate.identity]));
  if(identities.size!==1)return undefined;
  return{identity:[...identities.values()][0]!,identityOrigin:{kind:'literal-provider-name',requirementIds:candidates.map(candidate=>candidate.requirement.id),operationalKind:kind}};
}

function completeEnvironmentIdentities(brief:ProductBrief,plan:DevelopmentPlan,hooks:DomainHooks):boolean{
  let changed=false;
  for(const node of plan.environment){
    const completed=inferredEnvironmentIdentity(node,brief);if(!completed)continue;
    Object.assign(node,completed);node.requirementIds=uniqueStrings([...(node.requirementIds??[]),...completed.identityOrigin!.requirementIds]);changed=true;
    emitEvent(hooks.onEvent,{type:'replanned',subject:node.id,message:'Identidade técnica completada por nome de provedor literal exato e papel operacional do nó; nenhuma instalação ou prova foi inferida.',detail:{id:node.id,identity:node.identity,origin:node.identityOrigin}});
  }
  return changed;
}

function recordPlanObligations(brief:ProductBrief,plan:DevelopmentPlan):boolean{
  const obligations=derivePlanObligations(brief,plan),changed=stableJson(plan.obligations??[])!==stableJson(obligations);
  plan.obligations=obligations;return changed;
}

function capabilityIdentity(value:unknown):CapabilityIdentity|undefined{
  if(!object(value)||!['cli','library','driver','service','runtime','sdk'].includes(string(value.kind))||!string(value.capability)||!string(value.provider))return undefined;
  return{capability:string(value.capability),kind:string(value.kind) as CapabilityIdentity['kind'],provider:string(value.provider)};
}

function recipe(value: unknown): CommandRecipe | null {
  if (typeof value === "string" && value.trim()) return { command: value.trim(), capabilities: inferredCapabilities(value) };
  if (!object(value)) return null;
  const command = string(value.command);
  if (!command) return null;
  const result: CommandRecipe = { command, capabilities: uniqueStrings([...strings(value.capabilities), ...inferredCapabilities(command)]) };
  const args = argv(value.args);
  if (args.length) result.args = args;
  if (string(value.cwd)) result.cwd = string(value.cwd);
  if (typeof value.system === "boolean") result.system = value.system;
  if (typeof value.timeoutMs === "number" && Number.isFinite(value.timeoutMs) && value.timeoutMs > 0) result.timeoutMs = value.timeoutMs;
  return result;
}

export function normalizeEnvironment(value: unknown, brief: ProductBrief, resolvedAliases?:Map<string,string>): EnvironmentNode[] {
  const result: EnvironmentNode[] = [];
  const incompatible = new Set<string>();
  for (const item of records(value)) {
    const name = string(item.name);
    if (!name) continue;
    const kind = ["runtime", "sdk", "tool", "package", "service", "database"].includes(string(item.kind)) ? string(item.kind) as EnvironmentNode["kind"] : "tool";
    const check = recipe(item.check);
    if (!check) continue;
    const prepare = (Array.isArray(item.prepare) ? item.prepare : item.prepare ? [item.prepare] : []).map(recipe).filter((command): command is CommandRecipe => command !== null);
    const capabilities = uniqueStrings([...(check.capabilities ?? []), ...prepare.flatMap((command) => command.capabilities ?? [])]);
    if (kind === "package") capabilities.push("external-package");
    if (!allowedCapabilities(brief, capabilities)) { incompatible.add(cleanId(item.id, identity("env", normalize(name)))); continue; }
    const node: EnvironmentNode = { id: cleanId(item.id, identity("env", normalize(name))), name, kind, dependsOn: strings(item.dependsOn), targets: strings(item.targets), reason: string(item.reason, `Preparar ${name} para o comportamento pedido.`), check, prepare };
    if (object(item.identity) && ["cli", "library", "driver", "service", "runtime", "sdk"].includes(string(item.identity.kind)) && string(item.identity.capability) && string(item.identity.provider)) node.identity = { capability: string(item.identity.capability), kind: string(item.identity.kind) as NonNullable<EnvironmentNode["identity"]>["kind"], provider: string(item.identity.provider) };
    if(node.identity&&object(item.identityOrigin)&&item.identityOrigin.kind==='literal-provider-name'&&item.identityOrigin.operationalKind===node.identity.kind)node.identityOrigin={kind:'literal-provider-name',requirementIds:strings(item.identityOrigin.requirementIds),operationalKind:node.identity.kind};
    const transformations=records(item.identityTransformations).flatMap(change=>{
      const from=capabilityIdentity(change.from),to=capabilityIdentity(change.to),source=object(change.source)?change.source:undefined;
      if(!from||!to||!source||!['request','answer','repository'].includes(string(source.kind))||!string(source.reference)||!string(source.text)||!string(change.requirementId))return[];
      return[{from,to,requirementId:string(change.requirementId),source:{kind:string(source.kind) as Requirement['source']['kind'],reference:string(source.reference),text:string(source.text)},reason:string(change.reason)}];
    });
    if(transformations.length)node.identityTransformations=transformations;
    if (Array.isArray(item.requirementIds)) node.requirementIds = strings(item.requirementIds).filter(id => brief.requirements.some(requirement => requirement.id === id));
    if (object(item.provides)) {
      const provided: NonNullable<EnvironmentNode["provides"]> = {};
      const command = argv(item.provides.command); if (command.length) provided.command = command;
      if (Array.isArray(item.provides.aliases)) provided.aliases = strings(item.provides.aliases);
      if (Array.isArray(item.provides.invocations)) provided.invocations = records(item.provides.invocations).map(invocation => ({ command: argv(invocation.command), ...(Array.isArray(invocation.aliases) ? { aliases: strings(invocation.aliases) } : {}) })).filter(invocation => invocation.command.length > 0);
      if (object(item.provides.env)) provided.env = Object.fromEntries(Object.entries(item.provides.env).filter((entry): entry is [string, string] => typeof entry[1] === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry[0])));
      if (Array.isArray(item.provides.paths)) provided.paths = strings(item.provides.paths);
      if (Array.isArray(item.provides.inputs)) provided.inputs = safePaths(item.provides.inputs);
      if(Array.isArray(item.provides.modules))provided.modules=records(item.provides.modules).filter(module=>['node','python'].includes(string(module.protocol))&&!!string(module.specifier)&&argv(module.runtimeCommand).length>0).map(module=>({protocol:string(module.protocol) as 'node'|'python',specifier:string(module.specifier),runtimeCommand:argv(module.runtimeCommand)}));
      if (Object.keys(provided).length) node.provides = provided;
    }
    const completed=inferredEnvironmentIdentity(node,brief);if(completed){Object.assign(node,completed);node.requirementIds=uniqueStrings([...(node.requirementIds??[]),...completed.identityOrigin!.requirementIds]);}
    result.push(node);
  }
  const byName = new Map<string, EnvironmentNode>();
  const aliases = new Map<string, string>();
  for (const node of result) {
    const key = normalize(node.identity ? `${node.identity.capability}:${node.identity.kind}:${node.identity.provider}` : `${node.kind}:${node.name}`);
    const earlier = byName.get(key);
    if(earlier&&earlier.id!==node.id&&environmentOperation(earlier)!==environmentOperation(node)){
      // A provider label cannot overwrite a different executable contract.
      byName.set(`${key}:${node.id}`,node);continue;
    }
    if (earlier) {
      aliases.set(node.id, earlier.id);
      if(node.id!==earlier.id)resolvedAliases?.set(node.id,earlier.id);
      const id = earlier.id;
      const dependsOn = uniqueStrings([...earlier.dependsOn, ...node.dependsOn]);
      const requirementIds = uniqueStrings([...(earlier.requirementIds ?? []), ...(node.requirementIds ?? [])]);
      // A recovered recipe/binding replaces the unusable operational definition.
      Object.assign(earlier, node, { id, dependsOn, ...(requirementIds.length ? { requirementIds } : {}) });
    } else byName.set(key, node);
  }
  const nodes = [...byName.values()];
  // A removed incompatible browser tool cannot remain a prerequisite of a terminal task.
  for (const node of nodes) node.dependsOn = uniqueStrings(node.dependsOn.map((id) => aliases.get(id) ?? id)).filter((id) => !incompatible.has(id));
  return nodes;
}

function remapEnvironmentReferences(plan:DevelopmentPlan,aliases:Map<string,string>):void{
  const resolve=(id:string):string=>{const seen=new Set<string>();while(aliases.has(id)&&!seen.has(id)){seen.add(id);id=aliases.get(id)!;}return id;};
  for(const node of plan.environment)node.dependsOn=uniqueStrings(node.dependsOn.map(resolve));
  for(const task of plan.tasks)task.environmentIds=uniqueStrings(task.environmentIds.map(resolve));
}

/** An anonymous identity enrichment can retain a consumed prerequisite ID only
 * when its full executable contract has exactly one bound/unbound match. */
function reconcileOperationalProviders(plan:DevelopmentPlan,hooks:DomainHooks):boolean{
  const aliases=new Map<string,string>();
  for(const bound of plan.environment.filter(node=>node.identity)){
    if(aliases.has(bound.id))continue;
    const operation=environmentOperation(bound);
    const candidates=plan.environment.filter(node=>!node.identity&&!aliases.has(node.id)&&environmentOperation(node)===operation);
    const bindings=plan.environment.filter(node=>node.identity&&!aliases.has(node.id)&&environmentOperation(node)===operation);
    if(candidates.length!==1||bindings.length!==1)continue;
    const unbound=candidates[0]!,canonical=plan.environment.indexOf(unbound)<plan.environment.indexOf(bound)?unbound:bound;
    const id=canonical.id,removed=canonical===unbound?bound:unbound;
    const requirementIds=uniqueStrings([...(unbound.requirementIds??[]),...(bound.requirementIds??[])]);
    Object.assign(canonical,unbound,bound,{id,...(requirementIds.length?{requirementIds}:{})});
    aliases.set(removed.id,id);
  }
  if(!aliases.size)return false;
  plan.environment=plan.environment.filter(node=>!aliases.has(node.id));remapEnvironmentReferences(plan,aliases);
  for(const [from,to] of aliases)emitEvent(hooks.onEvent,{type:'replanned',subject:to,message:`Identidade do pré-requisito reconciliada: ${from} → ${to}. Kind, invocação de prontidão, preparação, dependências, targets e exports têm contrato operacional idêntico e correspondência única; referências preservadas.`});
  return true;
}

function contractsFrom(value: unknown, requirements: Requirement[]): IntegrationContract[] {
  const available = new Set(requirements.map((requirement) => requirement.id));
  return records(value).map((item) => ({
    id: cleanId(item.id, identity("contract", string(item.name, string(item.description)))),
    name: string(item.name, "Contrato de integração"),
    description: string(item.description),
    inputs: strings(item.inputs),
    outputs: strings(item.outputs),
    requirementIds: strings(item.requirementIds).filter((id) => available.has(id)),
  })).filter((contract) => contract.description !== "");
}

function declaredConformance(item: Record<string, unknown>): Record<string, unknown> | undefined {
  return object(item.conformance) ? item.conformance
    : object(item.acceptance) && object(item.acceptance.conformance) ? item.acceptance.conformance
      : string(item.requirementId) && string(item.capability) && string(item.provider) && Array.isArray(item.productInputs) ? item : undefined;
}

export function normalizeChecks(value: unknown, brief: ProductBrief): Verification[] {
  const result: Verification[] = [];
  for (const declaration of records(value)) {
    // Transport placement cannot discard an explicitly declared contract.
    // These adapters copy metadata; they never infer a provider or a proof.
    const item = verificationDeclaration(declaration);
    const conformance = declaredConformance(item);
    const kind = ["command", "cli", "tui", "web", "desktop"].includes(string(item.kind)) ? string(item.kind) as Verification["kind"] : "command";
    const command = string(item.command);
    const capabilities = uniqueStrings([...strings(item.requiredCapabilities), ...inferredCapabilities(`${command} ${argv(item.args).join(" ")}`), ...(kind === "web" ? ["browser"] : [])]);
    if (!allowedCapabilities(brief, capabilities)) continue;
    if (kind === "desktop" && !brief.modes.includes("desktop")) continue;
    const check: Verification = { id: cleanId(item.id, identity("check", `${kind}:${command}:${string(item.expected)}`)), kind, requirementIds: uniqueStrings([...strings(item.requirementIds), ...(string(item.requirementId) ? [string(item.requirementId)] : []), ...(conformance && string(conformance.requirementId) ? [string(conformance.requirementId)] : [])]), requiredCapabilities: capabilities };
    if (command) check.command = command;
    const args = argv(item.args);
    if (args.length) check.args = args;
    const expected = string(item.expected);
    if (expected) check.expected = expected;
    if (item.assertion !== undefined) {
      const assertion = normalizeVerificationAssertion(item.assertion);
      if (assertion) check.assertion = assertion;
      else check.assertionIssue = "The proposed assertion is invalid. Use a typed contains/regex/exit/empty/json/all/any predicate with a concrete selector and value.";
    } else if (string(item.assertionIssue)) check.assertionIssue = string(item.assertionIssue);
    if (typeof item.expectedExitCode === "number" && Number.isInteger(item.expectedExitCode) && item.expectedExitCode >= 0 && item.expectedExitCode <= 255) check.expectedExitCode = item.expectedExitCode;
    if (Array.isArray(item.input)) check.input = item.input.filter((input): input is string => typeof input === "string");
    if (Array.isArray(item.steps)) check.steps = records(item.steps).map((step) => {
      const result: NonNullable<Verification["steps"]>[number] = {};
      if (typeof step.input === "string") result.input = step.input;
      if (typeof step.waitFor === "string") result.waitFor = step.waitFor;
      if (typeof step.timeoutMs === "number" && step.timeoutMs > 0) result.timeoutMs = step.timeoutMs;
      return result;
    });
    if (typeof item.closeInput === "string") check.closeInput = item.closeInput;
    if (typeof item.timeoutMs === "number" && item.timeoutMs > 0) check.timeoutMs = item.timeoutMs;
    if (["linux", "windows", "macos", "browser", "portable"].includes(string(item.target))) check.target = string(item.target) as NonNullable<Verification["target"]>;
    if (Array.isArray(item.inputs)) check.inputs = safePaths(item.inputs);
    if (Array.isArray(item.constraintIds)) check.constraintIds = strings(item.constraintIds).filter(id => brief.constraints.some(constraint => constraint.id === id));
    if (["syntax", "build", "behavior"].includes(string(item.level))) check.level = string(item.level) as NonNullable<Verification["level"]>;
    if (string(item.cwd) && safePaths([item.cwd]).length) check.cwd = string(item.cwd);
    if (Array.isArray(item.outputs)) check.outputs = safePaths(item.outputs);
    if (Array.isArray(item.dependsOn)) check.dependsOn = strings(item.dependsOn);
    if (conformance && string(conformance.requirementId) && string(conformance.capability) && string(conformance.provider) && ["cli", "library", "driver", "service", "runtime", "sdk"].includes(string(conformance.kind))) {
      check.conformance = { requirementId: string(conformance.requirementId), capability: string(conformance.capability), kind: string(conformance.kind) as NonNullable<Verification["conformance"]>["kind"], provider: string(conformance.provider), productInputs: safePaths(conformance.productInputs), ...(Array.isArray(conformance.providerCommand) ? {providerCommand:argv(conformance.providerCommand)} : {}), ...(Array.isArray(conformance.providerInputs) ? {providerInputs:safePaths(conformance.providerInputs)} : {}), ...(Array.isArray(conformance.artifacts) ? {artifacts:safePaths(conformance.artifacts)} : {}) };
    }
    result.push(check);
  }
  return reconcileChecks(result);
}

function safePaths(value: unknown): string[] {
  return strings(value).filter((path) => !path.startsWith("/") && !/^[A-Za-z]:/.test(path) && !path.split(/[\\/]/).includes("..") && !path.includes("\0"));
}

export function normalizeTasks(value: unknown, brief: ProductBrief, environment: EnvironmentNode[], contracts: IntegrationContract[], fallbackRequirements: Requirement[] = brief.requirements): WorkUnit[] {
  const available = new Set(brief.requirements.map((requirement) => requirement.id));
  const environments = new Map(environment.map((node) => [node.id.toLowerCase(), node.id]));
  const contractIds = new Map(contracts.map((contract) => [contract.id.toLowerCase(), contract.id]));
  return records(value).map((item): WorkUnit => {
    const title = string(item.title, string(item.goal));
    const goal = string(item.goal, title);
    const requirementIds = uniqueStrings(strings(item.requirementIds).map(id=>resolveRequirementAlias(brief,id))).filter((id) => available.has(id));
    const criteria = strings(item.criteria);
    return {
      id: cleanId(item.id, identity("task", `${goal}:${requirementIds.join(",")}`)), title, goal,
      instructions: string(item.instructions, goal),
      requirementIds,
      dependsOn: strings(item.dependsOn), environmentIds: strings(item.environmentIds).map((id) => environments.get(id.toLowerCase()) ?? id),
      contractIds: strings(item.contractIds).map((id) => contractIds.get(id.toLowerCase()) ?? id), files: safePaths(item.files),
      ...(Array.isArray(item.inputs) ? { inputs: safePaths(item.inputs) } : {}),
      ...(Array.isArray(item.resources) ? { resources: strings(item.resources) } : {}),
      ...(Array.isArray(item.exclusiveContracts) ? { exclusiveContracts: strings(item.exclusiveContracts) } : {}),
      criteria: criteria.length ? criteria : [goal], checks: normalizeChecks(item.checks, brief),
      risk: ["low", "normal", "high"].includes(string(item.risk)) ? string(item.risk) as WorkUnit["risk"] : "normal",
      blockedBy: strings(item.blockedBy).filter((id) => brief.gaps.some((gap) => gap.id === id && gap.status === "pending")),
    };
  }).filter((task) => task.goal !== "");
}

/** Resolve missing prerequisites and real cycles, rather than deleting edges to obtain a green DAG. */
async function repairGraph(plan: DevelopmentPlan, brief: ProductBrief, kind: "environment" | "tasks", hooks: DomainHooks): Promise<void> {
  const recovery = new PlanningProgress(`graph:${kind}`);
  const progress = { id: `plan:graph:${kind}`, label: kind === "environment" ? "Dependências do ambiente" : "Dependências das tarefas", stage: "plan" };
  let repairing = false;
  for (;;) {
    cancelled(hooks.signal);
    const nodes: (EnvironmentNode | WorkUnit)[] = plan[kind];
    const ids = new Set(nodes.map((node) => node.id));
    const lowerIds = new Map(nodes.map((node) => [node.id.toLowerCase(), node.id]));
    for (const node of nodes) node.dependsOn = uniqueStrings(node.dependsOn.map((id) => lowerIds.get(id.toLowerCase()) ?? id));
    const sorted = ordered(nodes);
    if (!sorted.unresolved.length) {
      if (kind === "environment") plan.environment = sorted.ready.filter((node): node is EnvironmentNode => "kind" in node);
      else plan.tasks = sorted.ready.filter((node): node is WorkUnit => "goal" in node);
      if (repairing) emitProgress(hooks.onEvent, { ...progress, status: "complete" });
      return;
    }
    const missingNode = sorted.unresolved.find((node) => node.dependsOn.some((id) => !ids.has(id)));
    const byId = new Map(nodes.map((node) => [node.id, node]));
    let cycle: string[] = [];
    const visited = new Set<string>();
    const active: string[] = [];
    const visit = (id: string): void => {
      const start = active.indexOf(id);
      if (start >= 0) { cycle = [...active.slice(start), id]; return; }
      if (visited.has(id) || cycle.length) return;
      visited.add(id); active.push(id);
      for (const dependency of byId.get(id)?.dependsOn ?? []) { visit(dependency); if (cycle.length) break; }
      active.pop();
    };
    if (!missingNode) for (const node of sorted.unresolved) { visit(node.id); if (cycle.length) break; }
    // Only the technical cause is sent, rather than every downstream consumer blocked by it.
    const focus = missingNode ? [missingNode] : uniqueStrings(cycle).slice(0, 5).map((id) => byId.get(id)!).filter(Boolean);
    const missing = uniqueStrings(focus.flatMap((node) => node.dependsOn).filter((id) => !ids.has(id)));
    const focusIds = new Set(focus.map((node) => node.id));
    const description = JSON.stringify(focus.map((node) => ({ id: node.id, dependsOn: node.dependsOn.filter((id, index) => focusIds.has(id) || !ids.has(id) || index < 8), otherPrerequisites: Math.max(0, node.dependsOn.length - 8), description: ("name" in node ? node.name : node.goal).slice(0, 400) })));
    recovery.requireChange(description, `O grafo ${kind} continua sem uma ordenação executável.`, focus.map(node=>node.id).sort().join(","));
    repairing = true;
    emitProgress(hooks.onEvent, { ...progress, status: "running" });
    emitEvent(hooks.onEvent, { type: "recovering", message: "Corrigindo dependência ausente ou circular na origem, preservando o trabalho válido.", subject: kind });
    const answer = await requestObject({ ...hooks, operation: "repair", prompt: [
      `Correct this ${kind} dependency graph locally. Missing IDs: ${missing.join(", ") || "none; unresolved nodes form a cycle"}.`,
      'Return {"updates":[{"id":"existing id","addDependsOn":[],"removeDependsOn":[]}],"additions":[],"reason":"technical correction"}. Additions are complete environment/task objects only if an omitted prerequisite is genuinely required. You may return dependsOn instead of add/remove only when replacing the complete prerequisite list is necessary.',
      "Do not remove a real prerequisite merely to erase a cycle. Split responsibilities or add the missing foundation; preserve all product behavior. Only a local section is shown; add/remove patches preserve other existing prerequisites. No user interview is needed to settle an engineering dependency.",
      `Interfaces: ${brief.modes.join(", ")}. Unresolved nodes:\n${description}`,
      `Relevant existing IDs: ${uniqueStrings(focus.flatMap((node) => [node.id, ...node.dependsOn.filter((id) => ids.has(id)).slice(0, 8)])).join(", ")}. Cycle length: ${cycle.length ? cycle.length - 1 : 0}.`,
      kind === "environment" ? 'New environment node: {id,name,kind,dependsOn,targets,reason,check:{command,args},prepare:[{command,args,system}]}' : 'New task: {id,title,goal,instructions,requirementIds,dependsOn,environmentIds,contractIds,files,criteria,checks,risk,blockedBy}',
    ].join("\n\n") });
    for (const update of records(answer.updates)) {
      const node = nodes.find((candidate) => candidate.id === string(update.id));
      if (node && Array.isArray(update.dependsOn)) node.dependsOn = strings(update.dependsOn);
      else if (node) node.dependsOn = uniqueStrings([...node.dependsOn.filter((id) => !strings(update.removeDependsOn).includes(id)), ...strings(update.addDependsOn)]);
    }
    if (kind === "environment") plan.environment = unique([...plan.environment, ...await executableEnvironment(answer.additions, brief, hooks)]);
    else plan.tasks = unique([...plan.tasks, ...normalizeTasks(answer.additions, brief, plan.environment, plan.contracts, [])]);
    await hooks.save?.({ brief, plan });
  }
}

function productFacts(brief: ProductBrief, budget = 3_000): string {
  const limits = { forbidden: uniqueStrings(brief.constraints.flatMap((constraint) => constraint.forbiddenCapabilities)), required: uniqueStrings(brief.constraints.flatMap((constraint) => constraint.requiredCapabilities)) };
  const details: { id: string; statement: string }[] = [];
  let room = Math.max(0, budget - 1_200);
  for (const constraint of brief.constraints) {
    const statement = constraint.statement.slice(0, 400);
    if (statement.length + 100 > room) continue;
    details.push({ id: constraint.id, statement }); room -= statement.length + 100;
  }
  const facts = { name: brief.name, summary: brief.summary.slice(0, Math.min(600, Math.floor(budget / 4))), modes: brief.modes, targets: brief.targets, capabilityLimits: limits, restrictionDetails: details, restrictionCount: brief.constraints.length, decisions: brief.decisions.slice(-6).map(({ fact, answer }) => ({ fact, answer: answer.slice(0, 200) })), references: [] as NonNullable<ProductBrief["references"]>, referenceCount: brief.references?.length ?? 0 };
  while (JSON.stringify(facts).length > budget && facts.decisions.length) facts.decisions.shift();
  while (JSON.stringify(facts).length > budget && facts.restrictionDetails.length) facts.restrictionDetails.pop();
  const available = (brief.references ?? []).filter(reference => allowedCapabilities(brief, inferredCapabilities(reference.title ?? ""))).sort((a, b) => Number(b.scope === "global") - Number(a.scope === "global"));
  facts.references = boundedReferences(available, budget - JSON.stringify(facts).length);
  return JSON.stringify(facts);
}

/** Obtain executable recipes instead of quietly dropping a required SDK with an incomplete answer. */
async function executableEnvironment(value: unknown, brief: ProductBrief, hooks: DomainHooks): Promise<EnvironmentNode[]> {
  const pending: unknown[] = Array.isArray(value) ? [...value] : value == null ? [] : [value];
  const complete: EnvironmentNode[] = [];
  const recovery = new PlanningProgress("environment-recipes");
  let repairing = false;
  while (pending.length) {
    cancelled(hooks.signal);
    const candidate = pending.shift();
    if (object(candidate) && string(candidate.name) && recipe(candidate.check) && (string(candidate.kind) !== "database" || object(candidate.identity))) {
      const nodes = normalizeEnvironment([candidate], brief);
      if (!nodes.length) emitEvent(hooks.onEvent, { type: "recovering", message: "Pré-requisito incompatível com o produto rejeitado antes de preparar o ambiente.", subject: string(candidate.id) });
      complete.push(...nodes);
      continue;
    }
    const serialized = JSON.stringify(candidate) ?? "null";
    recovery.requireChange(serialized, "A preparação técnica continua sem uma receita executável.", object(candidate) ? string(candidate.id, string(candidate.name, serialized)) : serialized);
    repairing = true;
    emitProgress(hooks.onEvent, { id: "plan:environment-repair", label: "Receitas dos pré-requisitos", status: "running", stage: "plan" });
    emitEvent(hooks.onEvent, { type: "recovering", message: "Completando a receita executável de um pré-requisito, sem perder a dependência.", subject: "environment" });
    const result = await requestObject({ ...hooks, operation: "repair", prompt: [
      "Repair this incomplete technical prerequisite. An environment node needs a real availability check and preparation recipes, not a prose placeholder. Do not edit files.",
      'Return {"environment":[{"id":"stable id","name":"prerequisite","kind":"runtime|sdk|tool|package|service|database","identity":{"capability":"required capability","kind":"cli|library|driver|service|runtime|sdk","provider":"chosen provider"},"dependsOn":[],"targets":[],"reason":"actual consumer","check":{"command":"availability command","args":[]},"prepare":[{"command":"preparation command","args":[],"system":false}],"provides":{"command":[],"env":{},"paths":[]}}],"unnecessary":false,"reason":"technical explanation"}. A database node must distinguish CLI, driver and service. Use unnecessary=true only for an optional or forbidden instrument.',
      `Product: ${productFacts(brief, Math.min(1_500, Math.floor((hooks.contextChars ?? 24_000) / 5)))}`,
      `Incomplete prerequisite: ${serialized}`,
    ].join("\n\n") });
    const corrected = Array.isArray(result.environment) ? result.environment : [];
    if (corrected.length) pending.unshift(...corrected);
    else if (result.unnecessary === true && string(result.reason)) emitEvent(hooks.onEvent, { type: "replanned", message: `Pré-requisito dispensado com justificativa técnica: ${string(result.reason)}`, subject: "environment" });
    else pending.unshift(candidate);
  }
  if (repairing) emitProgress(hooks.onEvent, { id: "plan:environment-repair", label: "Receitas dos pré-requisitos", status: "complete", stage: "plan" });
  return normalizeEnvironment(complete, brief);
}

/** Preserve unresolved references until they have a real dependency or a justified engineering correction. */
async function repairReferences(plan: DevelopmentPlan, brief: ProductBrief, hooks: DomainHooks): Promise<void> {
  const recovery = new PlanningProgress("task-references");
  let repairing = false;
  for (;;) {
    const task = plan.tasks.find((unit) => unit.environmentIds.some((id) => !plan.environment.some((node) => node.id === id)) || unit.contractIds.some((id) => !plan.contracts.some((contract) => contract.id === id)));
    if (!task) {
      if (repairing) emitProgress(hooks.onEvent, { id: "plan:references", label: "Referências técnicas das tarefas", status: "complete", stage: "plan" });
      return;
    }
    cancelled(hooks.signal);
    const missingEnvironment = task.environmentIds.filter((id) => !plan.environment.some((node) => node.id === id));
    const missingContracts = task.contractIds.filter((id) => !plan.contracts.some((contract) => contract.id === id));
    const state = JSON.stringify([task.id, missingEnvironment, missingContracts]);
    recovery.requireChange(state, "A tarefa continua citando capacidades ou contratos inexistentes.", `${task.id}:${missingEnvironment[0] ?? missingContracts[0]}`);
    repairing = true;
    emitProgress(hooks.onEvent, { id: "plan:references", label: "Referências técnicas das tarefas", status: "running", stage: "plan" });
    emitEvent(hooks.onEvent, { type: "recovering", message: "Resolvendo pré-requisito ou contrato citado por uma tarefa antes da construção.", subject: task.id });
    const result = await requestObject({ ...hooks, operation: "repair", prompt: [
      "Resolve missing technical references in this local task. Add the real prerequisite/interface or correct an inaccurate identifier. Preserve product behavior and prerequisite ordering. Do not merely erase a required dependency.",
      'Return {"environment":[{"id":"id","name":"name","kind":"tool","dependsOn":[],"targets":[],"check":{"command":"availability command"},"prepare":[]}],"contracts":[{"id":"id","name":"name","description":"actual interface","inputs":[],"outputs":[],"requirementIds":[]}],"task":{"environmentIds":[],"contractIds":[]},"reason":"technical correction"}. Return only new nodes; include all retained references in task.',
      `Product: ${productFacts(brief, Math.min(1_500, Math.floor((hooks.contextChars ?? 24_000) / 5)))}`,
      `Task: ${JSON.stringify({ id: task.id, goal: task.goal, requirementIds: task.requirementIds, environmentIds: task.environmentIds, contractIds: task.contractIds })}`,
      `Missing references: ${JSON.stringify({ environment: missingEnvironment, contracts: missingContracts })}`,
      `Existing local environment: ${JSON.stringify(plan.environment.filter((node, index) => task.environmentIds.includes(node.id) || index < 12).map(({ id, name }) => ({ id, name })))}`,
      `Existing local contracts: ${JSON.stringify(plan.contracts.filter((contract, index) => task.contractIds.includes(contract.id) || index < 8).map(({ id, name }) => ({ id, name })))}`,
    ].join("\n\n") });
    plan.environment = normalizeEnvironment([...plan.environment, ...await executableEnvironment(result.environment, brief, hooks)], brief);
    plan.contracts = unique([...plan.contracts, ...contractsFrom(result.contracts, brief.requirements)]);
    if (object(result.task) && string(result.reason)) {
      if (Array.isArray(result.task.environmentIds)) task.environmentIds = strings(result.task.environmentIds);
      if (Array.isArray(result.task.contractIds)) task.contractIds = strings(result.task.contractIds);
    }
    await hooks.save?.({ brief, plan });
  }
}

function requirementGroups(brief: ProductBrief, budget: number): Requirement[][] {
  const groups: Requirement[][] = [];
  let group: Requirement[] = [];
  let size = 0;
  for (const requirement of brief.requirements) {
    const length = requirement.statement.length + requirement.source.text.length + 300;
    if (size + length > budget && group.length) { groups.push(group); group = []; size = 0; }
    group.push(requirement); size += length;
  }
  if (group.length) groups.push(group);
  return groups;
}

function metadataList(items: object[], budget: number): string {
  const selected: object[] = [];
  let size = 2;
  for (const item of items) {
    const cost = JSON.stringify(item).length + 1;
    if (size + cost > budget) continue;
    selected.push(item); size += cost;
  }
  return JSON.stringify(selected);
}

async function ensureCoverage(brief: ProductBrief, plan: DevelopmentPlan, hooks: DomainHooks): Promise<void> {
  const progress = new PlanningProgress("requirement-coverage");
  for (;;) {
    const covered = new Set(plan.tasks.flatMap(task => task.requirementIds));
    const missing = brief.requirements.filter(requirement => !covered.has(requirement.id));
    if (!missing.length) break;
    progress.requireChange({missing: missing.map(requirement => requirement.id), tasks: plan.tasks.map(task => ({id: task.id, requirementIds: task.requirementIds}))}, "O plano ainda não cobre resultados obrigatórios do pedido.", missing[0]!.id);
    const budget = Math.max(400, Math.floor((hooks.contextChars ?? 24_000) / 3));
    const group = requirementGroups({...brief, requirements: missing}, budget)[0]!;
    const result = await requestObject({...hooks, operation: "outline", prompt: [
      "Reconcile uncovered mandatory outcomes into this engineering plan. Reuse an existing delivery only when it genuinely implements the outcome; do not manufacture one task per source fragment.",
      'Return {"tasks":[{"id":"stable delivery id","title":"capability","goal":"observable outcome","instructions":"local implementation","requirementIds":[],"dependsOn":[],"environmentIds":[],"contractIds":[],"files":[],"criteria":[],"checks":[]}],"environment":[],"acceptance":[]}. Return complete task definitions; a duplicate outcome is reconciled with its existing delivery.',
      `Product: ${productFacts(brief, Math.floor((hooks.contextChars ?? 24_000) / 8))}`,
      `Requirements of this slice:\n${JSON.stringify(group)}`,
      `Existing deliveries:\n${metadataList(plan.tasks.map(({id,title,goal,requirementIds})=>({id,title,goal,requirementIds})), Math.floor((hooks.contextChars ?? 24_000) / 5))}`,
    ].join("\n\n")});
    plan.environment = normalizeEnvironment([...plan.environment, ...await executableEnvironment(result.environment, brief, hooks)], brief);
    plan.tasks.push(...normalizeTasks(result.tasks, brief, plan.environment, plan.contracts, group));
    plan.acceptance = reconcileChecks([...(plan.acceptance ?? []), ...normalizeChecks(result.acceptance, brief)]);
    Object.assign(plan, reconcilePlan(brief, plan));
    await hooks.save?.({brief, plan});
  }
  for (const task of plan.tasks) {
    for (const gap of brief.gaps.filter((candidate) => candidate.status === "pending")) {
      const words = new Set(normalize(`${task.title} ${task.goal} ${brief.requirements.filter((requirement) => task.requirementIds.includes(requirement.id)).map((requirement) => requirement.statement).join(" ")}`).split(/\W+/).filter((word) => word.length > 3));
      const relevant = normalize(gap.fact).split(/\W+/).some((word) => word.length > 3 && words.has(word));
      const missingInterface = gap.category === "platform" && brief.modes.length === 0;
      if (gap.blocks.some((id) => id === task.id || task.requirementIds.includes(id)) || gap.blocks.length === 0 && (relevant || missingInterface)) task.blockedBy = uniqueStrings([...task.blockedBy, gap.id]);
    }
  }
}

const providerStages: Record<string, number> = { 'mandatory-provider-mismatch': 0, 'unused-mandatory-provider': 1 };
const repairTopic = (issue: PlanIssue): string => `${issue.code in providerStages ? 'provider' : issue.code}:${issue.subject}`;

function recordPlanBindings(brief: ProductBrief, plan: DevelopmentPlan): boolean {
  let changed = false;
  for (const requirement of brief.requirements.filter(item => item.binding)) {
    const offered = new Map(plan.environment.filter(node => obligationMatchesProvider(requirement, node.identity)).map(node => [stableJson(node.identity), node.identity!]));
    let identities = [...offered.values()];
    if (identities.length > 1) identities = identities.filter(identity => verificationRegistry(plan).some(({ check }) => check.conformance?.requirementId === requirement.id && normalize(check.conformance.provider) === normalize(identity.provider) && check.conformance.kind === identity.kind && normalize(check.conformance.capability) === normalize(identity.capability)));
    if (identities.length !== 1) continue;
    const previous = requirement.bindingTransformations?.length ?? 0;
    recordBindingTransformation(requirement, identities[0]!);
    changed ||= previous !== (requirement.bindingTransformations?.length ?? 0);
  }
  return changed;
}

/** Fingerprints contain executable contracts of this topic, never prose or clocks. */
function invariantState(brief: ProductBrief, plan: DevelopmentPlan, issue: PlanIssue): string {
  const requirement = brief.requirements.find(item => item.id === issue.subject);
  const tasks = plan.tasks.filter(task => task.id === issue.subject || task.requirementIds.includes(issue.subject));
  const providers = plan.environment.filter(node => requirement?.binding ? obligationMatchesProvider(requirement, node.identity) || !node.identity && tasks.some(task => task.environmentIds.includes(node.id)) : tasks.some(task => task.environmentIds.includes(node.id)));
  const checks = verificationRegistry(plan).filter(({ check, taskId }) => check.conformance?.requirementId === issue.subject || check.requirementIds.includes(issue.subject) || taskId === issue.subject).map(({ taskId, check }) => {
    const { expected: _description, ...recipe } = check;
    return { taskId, ...recipe, assertion: verificationAssertionStatus(check).assertion ?? null };
  });
  return stableJson({ topic: repairTopic(issue), code: issue.code, binding: requirement?.binding, authority: requirement?.bindingAuthority, tasks: tasks.map(({ id, requirementIds, dependsOn, environmentIds, contractIds }) => ({ id, requirementIds, dependsOn, environmentIds, contractIds })), providers: providers.map(({ id, kind, identity, check, prepare, provides, dependsOn, targets }) => ({ id, kind, identity, check, prepare, provides, dependsOn, targets })), checks });
}

function mergeRepairChecks(originals: Verification[], values: unknown, brief: ProductBrief): Verification[] {
  const result = structuredClone(originals), updates = records(values);
  for (const declaration of updates) {
    const update = verificationDeclaration(declaration);
    const original = result.find(check => check.id === update.id) ?? (!string(update.id) && result.length === 1 && updates.length === 1 ? result[0] : undefined);
    const conformance = declaredConformance(update);
    const normalized = normalizeChecks([{ ...original, ...update, ...(conformance ? { conformance } : {}), ...(original ? { id: original.id, ...(conformance === update && !['command','cli','tui','web','desktop'].includes(string(update.kind)) ? { kind: original.kind } : {}), requirementIds: uniqueStrings([...original.requirementIds, ...strings(update.requirementIds)]), constraintIds: uniqueStrings([...(original.constraintIds ?? []), ...strings(update.constraintIds)]) } : {}) }], brief);
    for (const check of normalized) {
      const index = result.findIndex(existing => existing.id === check.id);
      if (index >= 0) result[index] = check; else result.push(check);
    }
  }
  return reconcileChecks(result);
}

/** Unpublished technical transactions cannot replace product delivery contracts. */
async function invariantProposal(brief: ProductBrief, base: DevelopmentPlan, issue: PlanIssue, task: WorkUnit | undefined, result: Record<string, unknown>, hooks: DomainHooks): Promise<DevelopmentPlan> {
  const plan = structuredClone(base);
  const environmentUpdates=records(result.environmentUpdates).flatMap(update=>{
    const existing=plan.environment.find(node=>node.id===string(update.id));if(!existing)return[];
    const selected=capabilityIdentity(update.identity),requirement=brief.requirements.find(item=>item.id===issue.subject);
    if(object(update.identity)&&(!selected||!requirement||!obligationMatchesProvider(requirement,selected)))return[];
    if(object(update.identity)&&['runtime','sdk','service'].includes(existing.kind)&&string(update.identity.kind)!==existing.kind)return[];
    const transformations=[...existing.identityTransformations??[]];
    if(selected&&requirement&&existing.identity&&stableJson(existing.identity)!==stableJson(selected)){
      const change={from:structuredClone(existing.identity),to:structuredClone(selected),requirementId:requirement.id,source:structuredClone(requirement.source),reason:string(result.reason,'Explicit identity metadata correction; readiness and preparation remain unchanged. No execution proof was inferred.')};
      if(!transformations.some(previous=>stableJson(previous)===stableJson(change)))transformations.push(change);
    }
    return[{...existing,...(selected?{identity:selected}:{}),...(transformations.length?{identityTransformations:transformations}:{}),...(object(update.provides)?{provides:{...existing.provides,...update.provides}}:{}),requirementIds:uniqueStrings([...(existing.requirementIds??[]),...strings(update.requirementIds)])}];
  });
  const nodes = await executableEnvironment([...(Array.isArray(result.environment)?result.environment:[]),...environmentUpdates], brief, hooks);
  const changed = new Set(nodes.map(node => node.id)), aliases = new Map<string, string>();
  plan.environment = normalizeEnvironment([...plan.environment.filter(node => !changed.has(node.id)), ...nodes], brief, aliases);
  remapEnvironmentReferences(plan, aliases);
  plan.contracts = unique([...plan.contracts, ...contractsFrom(result.contracts, brief.requirements)]);
  const technical = issue.code in providerStages || /proof|interface|environment|contract/.test(issue.code);
  const updates = [...records(result.tasks), ...records(result.taskUpdates), ...(object(result.task) ? [{ id: task?.id, ...result.task }] : [])];
  for (const update of updates) {
    const existing = plan.tasks.find(candidate => candidate.id === update.id);
    if (!existing) { if (!technical) plan.tasks.push(...normalizeTasks([update], brief, plan.environment, plan.contracts, [])); continue; }
    if (Array.isArray(update.environmentIds)) {
      const references = strings(update.environmentIds).map(id => aliases.get(id) ?? id);
      existing.environmentIds = issue.code in providerStages || issue.code.includes('environment') ? references : uniqueStrings([...existing.environmentIds, ...references]);
    }
    if (Array.isArray(update.contractIds)) existing.contractIds = uniqueStrings([...existing.contractIds, ...strings(update.contractIds)]);
    if (Array.isArray(update.inputs)) existing.inputs = uniqueStrings([...(existing.inputs ?? []), ...safePaths(update.inputs)]);
    existing.checks = mergeRepairChecks(existing.checks, update.checks, brief);
    if (!technical) {
      const proposed = normalizeTasks([{ ...existing, ...update }], brief, plan.environment, plan.contracts, [])[0];
      if (proposed) Object.assign(existing, proposed, { criteria: uniqueStrings([...existing.criteria, ...proposed.criteria]), requirementIds: uniqueStrings([...existing.requirementIds, ...proposed.requirementIds]), files: uniqueStrings([...existing.files, ...proposed.files]), checks: mergeRepairChecks(existing.checks, proposed.checks, brief) });
    }
  }
  if (task && Array.isArray(result.checks)) { const owner = plan.tasks.find(candidate => candidate.id === task.id)!; owner.checks = mergeRepairChecks(owner.checks, result.checks, brief); }
  plan.acceptance = mergeRepairChecks(plan.acceptance ?? [], result.acceptance, brief);
  for (const update of records(result.verificationUpdates)) {
    if (!object(update.check)) continue;
    if (update.owner === '$acceptance') plan.acceptance = mergeRepairChecks(plan.acceptance, [update.check], brief);
    else { const owner = plan.tasks.find(candidate => candidate.id === update.owner); if (owner) owner.checks = mergeRepairChecks(owner.checks, [update.check], brief); }
  }
  const { onEvent: _publicationObserver, ...quiet } = hooks;
  reconcileOperationalProviders(plan, quiet);
  return reconcilePlan(brief, plan, base);
}

/** A retry changes protocol or a causal precondition. Rejected partial metadata
 * is retained for its patch, but never published as an accepted plan. */
async function repairPlanIssues(brief: ProductBrief, plan: DevelopmentPlan, hooks: DomainHooks): Promise<void> {
  const attempts = new Map<string, { calls: number; rejection?: unknown; staged?: DevelopmentPlan }>();
  for (;;) {
    cancelled(hooks.signal);
    const identitiesChanged=completeEnvironmentIdentities(brief,plan,hooks),bindingsChanged=recordPlanBindings(brief,plan),obligationsChanged=recordPlanObligations(brief,plan);
    if(identitiesChanged||bindingsChanged||obligationsChanged)await hooks.save?.({brief,plan});
    const issues = validatePlan(brief, plan);
    if (!issues.length) return;
    if (issues.some(issue => ['mandatory-provider-mismatch', 'unused-mandatory-provider'].includes(issue.code)) && reconcileOperationalProviders(plan, hooks)) { await hooks.save?.({ brief, plan }); continue; }
    const issue = issues[0]!, stamp = invariantState(brief, plan, issue), attempt = attempts.get(stamp) ?? { calls: 0 };
    if (attempt.calls >= 2) throw new PlanningFailure('no-progress', [`${issue.code} [${issue.subject}]: ${issue.message}`, 'A proposta e o protocolo de patch mínimo não corrigiram a causa. Entregas e provas originais foram preservadas.', stableJson(attempt.rejection)], 'plan-invariants');
    const environmentCause=issue.code==='mandatory-provider-mismatch'||issue.code==='unused-mandatory-provider'||issue.code.includes('environment');
    const protocol = environmentCause ? attempt.calls++?'environment-reference-patches':'environment-identity' : attempt.calls++ ? 'minimal-patches' : 'scoped-definitions'; attempts.set(stamp, attempt);
    const context = attempt.staged ?? plan, limit = hooks.contextChars ?? 24_000;
    const task = context.tasks.find(candidate => candidate.id === issue.subject || candidate.requirementIds.includes(issue.subject));
    const recipes = verificationRegistry(context).filter(({ check, taskId }) => check.conformance?.requirementId === issue.subject || check.requirementIds.includes(issue.subject) || taskId === task?.id);
    const requirement=brief.requirements.find(candidate=>candidate.id===issue.subject);
    const conformanceTargets=context.environment.filter(node=>requirement&&obligationMatchesProvider(requirement,node.identity)).map(node=>({environmentId:node.id,identity:node.identity,requirementId:issue.subject,requiredLevel:node.identity!.kind==='sdk'?'build':['runtime','service'].includes(node.identity!.kind)?'behavior':'build-or-behavior',artifactAndDependentBehaviorRequired:node.identity!.kind==='sdk',taskIds:context.tasks.filter(owner=>owner.environmentIds.includes(node.id)).map(owner=>owner.id)}));
    const result = await requestObject({ ...hooks, operation: 'repair', prompt: [
      `Repair protocol: ${protocol}. Correct this invariant's technical contract only. Preserve every existing delivery ID, goal, criterion, requirement, owned file and dependency. A task-owned recipe is valid; it need not be copied to global acceptance. Do not implement code.`,
      environmentCause ? 'Return {"environmentUpdates":[{"id":"existing prerequisite ID","identity":{"capability":"actual operational capability","kind":"cli|library|driver|service|runtime|sdk","provider":"complete literal provider"},"provides":{"command":[],"aliases":[],"invocations":[],"modules":[{"protocol":"node|python","specifier":"literal module name","runtimeCommand":[]}],"env":{},"paths":[],"inputs":[]}}],"environment":[],"taskUpdates":[{"id":"existing actual task ID","environmentIds":["retained prerequisite IDs"]}],"reason":"causal identity or reference correction"}. Omit unchanged fields. environmentUpdates patches metadata over the existing readiness/preparation definition; do not repeat that definition without its missing identity. Use environment only for a genuinely new or changed executable provider. Preserve the actual SDK/runtime role. Verification claims cannot repair a missing provider identity; do not replace product deliveries.' : protocol === 'minimal-patches' ? 'Return {"verificationUpdates":[{"owner":"existing task ID or $acceptance","check":{"id":"existing or new check ID","conformance":{"requirementId":"affected requirement","capability":"actual capability","kind":"cli|library|driver|service|runtime|sdk","provider":"literal provider","productInputs":["actual product files"]}}}],"environment":[],"taskUpdates":[],"reason":"causal correction"}. A partial check patches the previously supplied recipe. For reference repairs use taskUpdates[{id,environmentIds:["actual IDs"]}]; omit unchanged fields, never erase a prerequisite as a placeholder. Do not repeat an unchanged answer.' : 'Return {"tasks":[],"environment":[],"contracts":[],"acceptance":[],"reason":"causal correction"}. Return only affected complete definitions or taskUpdates[{id,checks,environmentIds}]. Both task checks and global acceptance retain their actual owners. Explicit conformance is {requirementId,capability,kind,provider,productInputs,artifacts}; availability alone does not prove product usage.',
      'Behavior recipes declare a typed assertion (contains/regex/exit/empty/json/all/any) and level=behavior. expected remains its human criterion. Build/syntax cannot replace interaction; SDK artifacts need a dependent behavior consumer. Do not alter a literal provider to fix an inferred engineering role.',
      `Invariant: ${JSON.stringify(issue)}`,
      `Mandatory requirement: ${metadataList(brief.requirements.filter(requirement => requirement.id === issue.subject), Math.floor(limit / 5))}`,
      `Operational conformance targets (actual provider roles, not inferred INIT labels): ${metadataList(conformanceTargets,Math.floor(limit / 8))}`,
      `Locked delivery: ${metadataList(task ? [{ id: task.id, goal: task.goal, requirementIds: task.requirementIds, files: task.files, criteria: task.criteria, environmentIds: task.environmentIds, dependsOn: task.dependsOn }] : [], Math.floor(limit / 5))}`,
      `Owned recipes: ${metadataList(recipes, Math.floor(limit / 3))}`,
      `Operational providers: ${metadataList(context.environment.filter(node => !node.identity && task?.environmentIds.includes(node.id) || brief.requirements.some(requirement => requirement.id === issue.subject && obligationMatchesProvider(requirement, node.identity))), Math.floor(limit / 5))}`,
      ...(attempt.rejection ? [`Previous proposal validation: ${stableJson(attempt.rejection)}`] : []),
    ].join('\n\n') });
    let candidate: DevelopmentPlan;
    try { candidate = await invariantProposal(brief, context, issue, task, result, hooks); }
    catch (error) { cancelled(hooks.signal); if (!(error instanceof PlanningFailure)) throw error; attempt.rejection = { reason: error.message }; emitEvent(hooks.onEvent, { type: 'recovering', message: 'A proposta técnica não pôde ser adotada; recuperando somente seu contrato em um protocolo de patch mínimo.', subject: issue.subject }); continue; }
    const after = validatePlan(brief, candidate), key = (value: PlanIssue): string => `${value.code}:${value.subject}`;
    const introduced = after.filter(next => !issues.some(previous => key(previous) === key(next)) && !issues.some(previous => repairTopic(previous) === repairTopic(next) && previous.code in providerStages && next.code in providerStages && providerStages[next.code]! > providerStages[previous.code]!));
    const cleared = issues.filter(previous => !after.some(next => key(previous) === key(next)));
    if (introduced.length || !cleared.length) {
      if (!introduced.length) attempt.staged = candidate;
      attempt.rejection = { remaining: after.filter(next => repairTopic(next) === repairTopic(issue)), introduced, reason: introduced.length ? 'The transaction introduced another invariant violation.' : 'No invariant or causal provider stage changed; wording, timestamps and unrelated edits are not progress.' };
      emitEvent(hooks.onEvent, { type: 'recovering', message: 'A proposta não resolveu uma causa verificável; preservando o plano publicado e recuperando apenas os campos pendentes.', subject: issue.subject });
      continue;
    }
    Object.assign(plan, candidate); recordPlanBindings(brief, plan);
    await hooks.save?.({ brief, plan });
    emitEvent(hooks.onEvent, { type: 'replanned', message: `Reparo técnico adotado atomicamente: ${cleared.map(item => `${item.code}[${item.subject}]`).join(', ')}.`, subject: issue.subject });
  }
}


export async function runPlan(options: PlanOptions): Promise<DevelopmentPlan> {
  const brief = options.brief;
  applyRepositoryConstraints(brief, options.repositoryConstraints);
  await resolveQuestions(brief, [], options);
  applyRepositoryConstraints(brief, options.repositoryConstraints);
  const restored=options.existing?.briefId===brief.id&&options.completedResponses
    ?rehydratePlanRecords(brief,options.existing,options.completedResponses(),normalizeChecks):undefined;
  const prior=restored?.plan??options.existing;
  const existing=prior?.briefId===brief.id?reconcilePlan(brief,prior,prior):prior;
  if(existing?.briefId===brief.id){
    const identitiesChanged=completeEnvironmentIdentities(brief,existing,options);recordPlanObligations(brief,existing);
    if(identitiesChanged||stableJson(prior?.obligations??[])!==stableJson(existing.obligations))await options.save?.({brief,plan:existing});
  }
  for(const record of restored?.restored??[])emitEvent(options.onEvent,{type:'replanned',subject:record.checkId,message:'Metadados explícitos recuperados da resposta já registrada; invocação e critérios preservados, sem repetir inferência.',detail:record});
  for(const record of restored?.ambiguous??[])emitEvent(options.onEvent,{type:'recovering',subject:record.checkId,message:'Respostas registradas divergem sobre metadados; nenhuma interpretação conflitante foi adotada.',detail:record});
  if(existing&&restored?.restored.length)await options.save?.({brief,plan:existing});
  if (existing?.briefId === brief.id && recordPlanBindings(brief, existing)) await options.save?.({ brief, plan: existing });
  if (existing?.status === "ready" && existing.briefId === brief.id && options.existing?.briefRevision === brief.revision && !validatePlan(brief, existing).length) return existing;
  // The product is still the same: fix its missing proofs/constraints in place.
  // Re-extracting the whole plan after a harness authority correction discards
  // useful contracts and reopens independent deliveries unnecessarily.
  if (existing?.status === "ready" && existing.briefId === brief.id && existing.tasks.every(task => task.requirementIds.every(id => brief.requirements.some(requirement => requirement.id === id)))) {
    const plan = reconcilePlan(brief, existing, existing);
    plan.status = "planning";
    plan.revision += 1;
    const constraints = new Set(brief.constraints.map(constraint => constraint.id));
    for (const check of [...plan.acceptance ?? [], ...plan.tasks.flatMap(task => task.checks)]) if (check.constraintIds) check.constraintIds = check.constraintIds.filter(id => constraints.has(id));
    await options.save?.({ brief, plan });
    await ensureCoverage(brief, plan, options);
    await repairGraph(plan, brief, "environment", options);
    await repairGraph(plan, brief, "tasks", options);
    await repairPlanIssues(brief, plan, options);
    plan.briefRevision = brief.revision;
    plan.status = "ready";
    delete plan.planning;
    await options.save?.({ brief, plan });
    emitEvent(options.onEvent, { type: "complete", message: "Plano existente reconciliado; entregas preservadas e somente lacunas afetadas reparadas.", subject: "plan" });
    return plan;
  }
  const limit = options.contextChars ?? 24_000;
  const facts = productFacts(brief, Math.floor(limit / 8));
  const partial=existing?.status === "planning" && existing.briefId === brief.id && existing.tasks.every(task=>task.requirementIds.every(id=>brief.requirements.some(requirement=>requirement.id===id))) ? existing : undefined;
  const plan: DevelopmentPlan = partial ? reconcilePlan(brief,partial,partial) : { schema: "capivara/plan/1", status: "planning", revision: (options.existing?.revision ?? 0) + 1, briefId: brief.id, briefRevision: brief.revision, environment: [], contracts: [], tasks: [] };
  recordPlanObligations(brief,plan);
  const checkpoint=plan.planning?.schema === "capivara/plan-progress/1" && plan.planning.briefRevision === brief.revision && plan.planning.groups.every(group=>group.requirementIds.every(id=>brief.requirements.some(requirement=>requirement.id===id))) ? plan.planning : undefined;
  // Legacy drafts already persisted every environment slice before the first
  // delivery. Keep their original outline request shape so a paid response in
  // the durable call cache is adopted with the exact same identity.
  const legacyPartial=!!partial&&!checkpoint;
  const legacyRequestShape=checkpoint?.legacyRequestShape??legacyPartial;
  const groups = checkpoint ? checkpoint.groups.map(group=>group.requirementIds.map(id=>brief.requirements.find(requirement=>requirement.id===id)!)) : requirementGroups(brief, Math.max(400, Math.floor(limit / 4)));
  const covered=new Set(plan.tasks.flatMap(task=>task.requirementIds));
  const construction:NonNullable<DevelopmentPlan["planning"]>=plan.planning=checkpoint??{schema:"capivara/plan-progress/1",briefRevision:brief.revision,...(legacyPartial?{legacyRequestShape:true}:{}),groups:groups.map(requirements=>({
    requirementIds:requirements.map(requirement=>requirement.id),environmentComplete:legacyPartial&&plan.tasks.length>0,outlineComplete:legacyPartial&&requirements.every(requirement=>covered.has(requirement.id)),
    environmentScope:plan.environment.filter(node=>node.requirementIds?.some(id=>requirements.some(requirement=>requirement.id===id))).map(node=>normalize(`${node.kind}:${node.name}`)),
  }))};
  const environmentProgress = { id: "plan:environment", label: "Grupos de pré-requisitos", total: groups.length, stage: "plan", unit: "grupos" };
  const outlineProgress = { id: "plan:outline", label: "Grupos de tarefas", total: groups.length, stage: "plan", unit: "grupos" };
  await options.save?.({brief,plan});
  emitProgress(options.onEvent, { ...environmentProgress, completed: construction.groups.filter(group=>group.environmentComplete).length, status: construction.groups.every(group=>group.environmentComplete) ? "complete" : "running" });
  // Environment is generated and persisted before requesting any construction tasks.
  for (const [groupIndex, requirements] of groups.entries()) {
    cancelled(options.signal);
    const group=construction.groups[groupIndex]!;
    if(group.environmentComplete)continue;
    const prompt=group.environmentPrompt??[
      "Plan executable technical prerequisites before implementation. Do not edit files. Return JSON.",
      'Shape: {"environment":[{"id":"stable-id","name":"runtime SDK tool package service or database","kind":"runtime|sdk|tool|package|service|database","identity":{"capability":"actual operational capability","kind":"cli|library|driver|service|runtime|sdk","provider":"complete literal provider"},"provides":{"command":[],"aliases":[],"invocations":[],"modules":[{"protocol":"node|python","specifier":"literal module name","runtimeCommand":[]}],"env":{},"paths":[],"inputs":[]},"dependsOn":[],"targets":[],"reason":"consumer and reason","check":{"command":"executable or shell command","args":[],"capabilities":[]},"prepare":[{"command":"preparation command","args":[],"system":false,"capabilities":[]}]}],"questions":[]}. identity/provides are typed optional metadata when the engine can complete them unambiguously from the exact provider name and actual node role; never use descriptive placeholders as executable commands or environment values.',
      "Include only prerequisites of these actual requirements. Selected reference metadata is supporting material, not required product outcomes; read applicable local paths before architectural choices. Runtime of the harness is not the product runtime. Browser tooling is appropriate only for a browser interface. Prefer local preparation over host mutation. A missing product fact may be asked with fact/question/reason/impact/category/modes/options/blocks; otherwise questions=[].",
      'Mandatory requirement.binding must match node.identity={capability,kind,provider}. Publish usable node.provides={command:[],env:{},paths:[],inputs:[]} for consumers and a concrete readiness probe. A CLI, library, driver, service and runtime are distinct capabilities.',
      `Product facts:\n${facts}`,
      `Requirements:\n${JSON.stringify(requirements)}`,
      options.repository ? `Repository facts:\n${options.repository.slice(0, Math.min(2_000, Math.floor(limit / 8)))}` : "",
    ].filter(Boolean).join("\n\n");
    group.environmentPrompt=prompt;await options.save?.({brief,plan});
    const result = await requestObject({ ...options, operation: "environment", prompt });
    await resolveQuestions(brief, records(result.questions), options);
    const additions = await executableEnvironment(result.environment, brief, options);
    group.environmentScope=additions.map((node) => normalize(`${node.kind}:${node.name}`));
    plan.environment = normalizeEnvironment([...plan.environment, ...additions], brief);
    construction.briefRevision=brief.revision;
    group.environmentComplete=true;delete group.environmentPrompt;
    await options.save?.({ brief, plan });
    emitProgress(options.onEvent, { ...environmentProgress, completed: construction.groups.filter(group=>group.environmentComplete).length, status: construction.groups.every(group=>group.environmentComplete) ? "complete" : "running" });
  }
  await repairGraph(plan, brief, "environment", options);
  await options.save?.({ brief, plan });
  emitEvent(options.onEvent, { type: "environment", message: "Árvore de preparação registrada antes das tarefas.", subject: "plan" });
  emitProgress(options.onEvent, { ...outlineProgress, completed: construction.groups.filter(group=>group.outlineComplete).length, status: construction.groups.every(group=>group.outlineComplete) ? "complete" : "running" });
  for (const [index, requirements] of groups.entries()) {
    cancelled(options.signal);
    const group=construction.groups[index]!;
    if(group.outlineComplete)continue;
    const environmentScope=new Set(group.environmentScope);
    const scopedIds = new Set(plan.environment.filter((node, nodeIndex) => environmentScope.has(normalize(`${node.kind}:${node.name}`)) || nodeIndex < 2 && ["runtime", "sdk"].includes(node.kind)).map((node) => node.id));
    for (;;) {
      const before = scopedIds.size;
      for (const node of plan.environment) if (scopedIds.has(node.id)) node.dependsOn.forEach((id) => scopedIds.add(id));
      if (before === scopedIds.size) break;
    }
    const outlinePrompt=(existingUnits:string,legacy=false):string=>[
      "Structure small executable work units and their integration contracts for these requirements. Return JSON; do not edit code.",
      'Shape: {"contracts":[{"id":"contract-id","name":"name","description":"precise behavior/interface","inputs":[],"outputs":[],"requirementIds":[]}],"tasks":[{"id":"task-id","title":"capability","goal":"observable outcome","instructions":"local implementation work","requirementIds":[],"dependsOn":[],"environmentIds":[],"contractIds":[],"files":[],"criteria":["necessary observable results"],"checks":[{"id":"check-id","kind":"command|cli|tui|web|desktop","command":"actual invocation with arguments when needed","expected":"human criterion","assertion":{"type":"contains","source":"stdout","value":"concrete scenario output"},"expectedExitCode":0,"requirementIds":[],"requiredCapabilities":[],"steps":[{"waitFor":"ready screen"},{"input":"key bytes","waitFor":"changed screen"}],"closeInput":"exit key"}],"risk":"low|normal|high","blockedBy":[]}],"questions":[]}',
      "There is no task, test or criterion quota. Each unit must fit one small context. Only relevant verification is useful. Define contracts before consumers. No server or browser for a terminal product unless explicitly required. TUI checks use synchronized steps: wait for readiness, send keys, wait for the observed state change, close input; pipes are not an interactive terminal. Omit steps for other kinds. CLI input[] contains literal bytes; include newline explicitly when needed. expectedExitCode is the actual successful outcome of that scenario, including a nonzero code when testing an expected rejection. Ask only a missing product fact with concrete impact; library and installer choices are engineering work.",
      legacy?'Declare task.inputs (read dependencies), files (owned outputs), resources (exclusive names), and exclusiveContracts when a unit changes a shared interface. Checks declare inputs, cwd, level=syntax|build|behavior and requirementIds. Final acceptance=[] contains the concrete mandatory stack/interface/behavior proof recipes; syntax does not prove a production build or interaction.':'Declare task.inputs, owned files, resources and integration contracts. Suggest relevant checks and optional final acceptance when their real invocation is known. Stack obligations with missing recipes remain explicit pending work for BUILD; do not invent paths or commands to make PLAN appear verified. Syntax and readiness never establish product conformance.',
      'A behavior recipe declares assertion: contains{source,value}, regex{source,pattern,flags}, empty{source}, exit{value}, json{source,path:["key",0],equals:value} or all/any{assertions:[]}. source is stdout/stderr/output (JSON uses stdout/stderr). expected is human prose and never parsed as a machine predicate. expectedExitCode alone is not an assertion.',
      legacy?'For every mandatory requirement.binding, acceptance has a dedicated conformance={requirementId,capability,kind,provider,productInputs:["real product paths"],artifacts:[]}. The real bound runtime executes product source; a compiled SDK build must produce declared outputs and a dependent functional recipe (dependsOn:["producer-check-id"]) consumes those exact artifacts. A ready tool or version probe cannot establish product conformance.':'A shared build or functional observation may support several provider obligations; there is no build/test-per-provider quota. Conformance metadata is optional before the code exists and remains pending until BUILD can establish actual provider usage. Exact argv, recipe dependency IDs and artifact consumers are technical verification details, not additional user requirements. BUILD still requires real product evidence before completion.',
      "Selected references support implementation; do not turn their code or every line into tasks. Read applicable skills/examples and cite their local paths in the instructions of units that need them, including globally applicable guidance.",
      `Product facts:\n${productFacts(brief, Math.floor(limit / 8))}`,
      `Requirements of this slice:\n${JSON.stringify(requirements)}`,
      `Technical prerequisites available in this slice (the full tree is recorded separately):\n${metadataList(plan.environment.filter((node) => scopedIds.has(node.id)).map(({ id, name, kind, identity }) => ({ id, name: name.slice(0, 180), kind, ...(!legacy&&identity?{identity}:{}) })), Math.floor(limit / 8))}`,
      existingUnits,
      plan.contracts.length ? `Relevant existing contract identifiers (details are stored in the plan):\n${metadataList(plan.contracts.filter((contract) => contract.requirementIds.some((id) => requirements.some((requirement) => requirement.id === id))).map(({ id, name }) => ({ id, name: name.slice(0, 120) })), Math.floor(limit / 12))}` : "",
    ].filter(Boolean).join("\n\n");
    let prompt=group.outlinePrompt;
    if(!prompt){
      prompt=outlinePrompt(plan.tasks.length?`Existing delivery identities and owned paths (details are stored separately):\n${metadataList(plan.tasks.map(({id,files,contractIds})=>({id,files,contractIds})),Math.floor(limit / 12))}`:"");
      if(legacyRequestShape){
        const legacy=outlinePrompt(plan.tasks.length?`Earlier foundations and relevant unit identifiers:\n${metadataList(plan.tasks.filter((task,unitIndex)=>unitIndex===0||task.requirementIds.some(id=>requirements.some(requirement=>requirement.id===id))).map(({id,title})=>({id,title:title.slice(0,120)})),Math.floor(limit/12))}`:"",true);
        if(options.hasCachedCall?.({operation:"outline",prompt:legacy,readOnly:true}))prompt=legacy;
      }
    }
    group.outlinePrompt=prompt;await options.save?.({brief,plan});
    const result = await requestObject({ ...options, operation: "outline", prompt });
    await resolveQuestions(brief, records(result.questions), options);
    const contracts = contractsFrom(result.contracts, brief.requirements);
    plan.contracts = unique([...plan.contracts, ...contracts]);
    const tasks = normalizeTasks(result.tasks, brief, plan.environment, plan.contracts, requirements);
    plan.tasks.push(...tasks);
    plan.acceptance = reconcileChecks([...(plan.acceptance ?? []), ...normalizeChecks(result.acceptance, brief)]);
    construction.briefRevision=brief.revision;
    group.outlineComplete=true;delete group.outlinePrompt;
    Object.assign(plan, reconcilePlan(brief, plan, options.existing));
    plan.planning=construction;
    await options.save?.({ brief, plan });
    emitProgress(options.onEvent, { ...outlineProgress, completed: construction.groups.filter(group=>group.outlineComplete).length, status: construction.groups.every(group=>group.outlineComplete) ? "complete" : "running" });
  }
  await ensureCoverage(brief, plan, options);
  Object.assign(plan, reconcilePlan(brief, plan, options.existing));
  await repairReferences(plan, brief, options);
  await repairGraph(plan, brief, "environment", options);
  await repairGraph(plan, brief, "tasks", options);
  plan.briefRevision = brief.revision;
  await options.save?.({ brief, plan });
  // Oversized packets are refined before BUILD receives them; no fake character ceiling expansion.
  const contextRecovery = new PlanningProgress("plan-context");
  for (;;) {
    let oversized: ContextTooLarge | null = null;
    for (const task of plan.tasks) {
      try { contextForTask(brief, plan, task, limit); }
      catch (error) { if (!(error instanceof ContextTooLarge)) throw error; oversized = error; break; }
    }
    if (!oversized) break;
    contextRecovery.requireChange({task: oversized.taskId, tasks: plan.tasks}, oversized.message, plan.tasks.find(task=>task.id===oversized!.taskId)?.requirementIds.slice().sort().join(","));
    const repaired = await repairWorkPlan({ ...options, brief, plan, taskId: oversized.taskId, problem: oversized.message, finalize: false });
    plan.tasks = repaired.tasks; plan.environment = repaired.environment; plan.contracts = repaired.contracts; plan.revision = repaired.revision;
  }
  await repairPlanIssues(brief, plan, options);
  assertValidPlan(brief, plan);
  plan.status = "ready";
  delete plan.planning;
  await options.save?.({ brief, plan });
  emitEvent(options.onEvent, { type: "complete", message: "Dependências, contratos e fragmentos de desenvolvimento estão estruturados.", subject: "plan" });
  return plan;
}

export interface RepairPlanOptions extends DomainHooks {
  brief: ProductBrief;
  plan: DevelopmentPlan;
  taskId: string;
  problem: string;
  finalize?: boolean;
  /** Instrument and provider incidents cannot redefine the product delivery. */
  repairScope?: "verification" | "environment" | "delivery" | "authority";
}

async function repairSourceAuthority(options:RepairPlanOptions,task:WorkUnit):Promise<DevelopmentPlan>{
  const requirements=options.brief.requirements.filter(requirement=>task.requirementIds.includes(requirement.id));
  const prompt=[
    'Correct only a derived planning fragment that contradicts an unchanged literal product obligation. Do not implement code, alter the brief or replace deliveries. Return JSON.',
    'Shape: {"amendments":[{"taskId":"affected existing task ID","field":"criteria|instructions","index":0,"original":"exact original derived criterion or unique instruction fragment","replacement":"source-supported corrected text, or null to remove that derived fragment","requirementId":"active requirement covered by this task","quote":"exact words from that requirement source","reason":"concrete conflict between the derived fragment and its unchanged source"}]}. For criteria, index and original identify the whole criterion. For instructions, omit index and select only the unique conflicting substring; all surrounding text remains unchanged. Literal user criteria cannot be deleted or rewritten. Omit unchanged fields and do not create new tasks, requirements, checks or file ownership.',
    `Affected task: ${JSON.stringify({id:task.id,goal:task.goal,instructions:task.instructions,criteria:task.criteria.map((text,index)=>({index,text})),requirementIds:task.requirementIds})}`,
    `Unchanged authoritative obligations: ${JSON.stringify(requirements.map(({id,statement,source})=>({id,statement,source})))}`,
    `Observed planning conflict: ${options.problem}`,
  ].join('\n\n');
  const response=await requestObject({...options,operation:'repair',prompt});
  const {plan,corrections}=applyAuthorityAmendments(options.brief,options.plan,response.amendments,task.id);
  plan.obligations=derivePlanObligations(options.brief,plan);
  plan.revision=options.plan.revision+1;
  plan.briefId=options.brief.id;plan.briefRevision=options.brief.revision;
  if(options.finalize===false)plan.status='planning';
  await options.save?.({brief:options.brief,plan});
  emitEvent(options.onEvent,{type:'replanned',subject:task.id,message:'Fragmento derivado corrigido contra a fonte literal; pedido, entregas e provas preservados.',detail:{authorityCorrections:corrections}});
  return plan;
}

/** Restore immutable definitions by reference before decoding an engineering
 * split. The model assigns responsibilities; it does not have to retranscribe
 * long recipes or acceptance criteria to keep them alive. */
function decompositionTasks(value:unknown,original:WorkUnit):Record<string,unknown>[] {
  const checks=new Map(original.checks.map(check=>[check.id,check]));
  const indexed=(item:Record<string,unknown>,key:string,source:readonly string[]):string[]=>{
    if(item[key]===undefined)return[];
    if(!Array.isArray(item[key])||item[key].some(index=>!Number.isInteger(index)||Number(index)<0||Number(index)>=source.length))throw new PlanningFailure('invalid-plan',[`Referência ${key} inválida na decomposição de ${original.id}.`],original.id);
    return(item[key] as number[]).map(index=>source[index]!);
  };
  return records(value).map(item=>{
    const checkIds=strings(item.checkIds);
    if(checkIds.some(id=>!checks.has(id)))throw new PlanningFailure('invalid-plan',[`Receita original desconhecida na decomposição de ${original.id}.`],original.id);
    const definitions=[...records(item.checks),...checkIds.map(id=>structuredClone(checks.get(id)!))];
    return{...item,criteria:uniqueStrings([...strings(item.criteria),...indexed(item,'criterionIndexes',original.criteria)]),
      checks:definitions.map(check=>checks.has(string(check.id))?structuredClone(checks.get(string(check.id))!):check),
      inputs:uniqueStrings([...strings(item.inputs),...indexed(item,'inputIndexes',original.inputs??[])]),
      resources:uniqueStrings([...strings(item.resources),...indexed(item,'resourceIndexes',original.resources??[])]),
      exclusiveContracts:uniqueStrings([...strings(item.exclusiveContracts),...indexed(item,'exclusiveContractIndexes',original.exclusiveContracts??[])])};
  });
}

function decompositionIssues(original:WorkUnit,replacements:WorkUnit[],plan:DevelopmentPlan):string[]{
  const issues:string[]=[];
  if(!replacements.length)return['A proposta não contém responsabilidades executáveis.'];
  const keep=(label:string,values:readonly string[],selected:readonly string[])=>{const missing=values.filter(value=>!selected.includes(value));if(missing.length)issues.push(`${label} originais sem atribuição: ${JSON.stringify(missing)}.`);};
  keep('Requisitos',original.requirementIds,replacements.flatMap(task=>task.requirementIds));
  keep('Critérios',original.criteria,replacements.flatMap(task=>task.criteria));
  keep('Receitas',original.checks.map(check=>check.id),replacements.flatMap(task=>task.checks.map(check=>check.id)));
  keep('Contratos',original.contractIds,replacements.flatMap(task=>task.contractIds));
  keep('Dependências do ambiente',original.environmentIds,replacements.flatMap(task=>task.environmentIds));
  keep('Entradas',original.inputs??[],replacements.flatMap(task=>task.inputs??[]));
  keep('Recursos exclusivos',original.resources??[],replacements.flatMap(task=>task.resources??[]));
  keep('Contratos exclusivos',original.exclusiveContracts??[],replacements.flatMap(task=>task.exclusiveContracts??[]));
  const scope=(value:string)=>value.replaceAll('\\','/').replace(/^\.\//,'').replace(/\/$/,'');
  const covers=(parent:string,child:string)=>{parent=scope(parent);child=scope(child);return parent===child||matchesGlob(child,parent)||(!/[?*{[\]()]/.test(parent)&&child.startsWith(`${parent}/`));};
  const assigned=replacements.flatMap(task=>task.files);
  for(const path of original.files)if(!assigned.some(candidate=>covers(path,candidate)||covers(candidate,path)))issues.push(`Escopo original sem atribuição: ${path}.`);
  for(const task of replacements){
    // Re-emitting an existing prerequisite is reconciled with that owner later.
    if(plan.tasks.some(existing=>existing.id!==original.id&&sameDelivery(existing,task)))continue;
    for(const path of task.files)if(original.files.length&&!original.files.some(parent=>covers(parent,path)))issues.push(`Escopo novo fora da responsabilidade original: ${path}.`);
    task.checks=task.checks.map(check=>structuredClone(original.checks.find(previous=>previous.id===check.id)??check));
  }
  return issues;
}

async function repairRestrictedWorkPlan(options: RepairPlanOptions, task: WorkUnit, scope: "verification" | "environment"): Promise<DevelopmentPlan> {
  const plan=structuredClone(options.plan),brief=options.brief;
  const verificationTransformations:{taskId:string;checkId:string;before:Verification|undefined;after:Verification}[]=[];
  const result=await requestObject({...options,operation:'repair',prompt:[
    `Repair the ${scope} contract only. The executor locks the delivery identity, goal, instructions, product criteria, requirement IDs, owned files and task dependencies. Do not replace a product delivery with recording, reviewing or documenting verification work. Return JSON.`,
    scope==='verification'
      ? 'Shape: {"checks":[{"id":"existing proof id","kind":"command|cli|tui|web|desktop","command":"actual invocation","args":[],"expected":"human criterion","assertion":{"type":"contains","source":"stdout","value":"concrete observable value"},"expectedExitCode":0,"inputs":[],"requirementIds":[],"requiredCapabilities":[],"level":"behavior","conformance":{"requirementId":"existing stack obligation","capability":"selected operational capability","kind":"cli|library|driver|service|runtime|sdk","provider":"literal required provider","productInputs":[]}}],"inputs":[],"environmentIds":[],"environment":[],"acceptance":[]}. Existing IDs accept partial technical patches; omitted recipes and fields remain intact. Original proof coverage and the human criterion remain intact. Additional requirement IDs must already belong to this delivery. Optional conformance metadata may be corrected to the selected operational provider while literal user restrictions remain authoritative; metadata is never proof. A mismatch in report spelling does not authorize changing the implementation or the delivery.'
      : 'Shape: {"environment":[{"id":"existing or necessary provider id","name":"provider","kind":"runtime|sdk|tool|package|service|database","identity":{"capability":"consumed capability","kind":"cli|library|driver|service|runtime|sdk","provider":"provider"},"dependsOn":[],"check":{"command":"usable readiness probe","args":[]},"prepare":[],"provides":{"command":[],"paths":[],"env":{},"modules":[{"protocol":"node|python","specifier":"actual import specifier","runtimeCommand":["actual runtime"]}]}}],"environmentIds":[]}. Only provider definitions and references may change; do not modify delivery or verification contracts.',
    `Locked delivery: ${JSON.stringify(task)}`,
    `Available environment: ${JSON.stringify(plan.environment)}`,
    `Incident: ${options.problem}`,
  ].join('\n\n')});
  const nodes=await executableEnvironment(result.environment,brief,options);
  const changedNodes=new Set(nodes.map(node=>node.id));
  plan.environment=normalizeEnvironment([...plan.environment.filter(node=>!changedNodes.has(node.id)),...nodes],brief);
  const proposals=records(result.tasks);
  const proposal=proposals.find(candidate=>candidate.id===task.id)??(proposals.length===1?proposals[0]:undefined);
  const technical=proposal??(object(result.task)?result.task:result);
  const target=plan.tasks.find(candidate=>candidate.id===task.id)!;
  const environmentIds=technical.environmentIds??result.environmentIds;
  if(Array.isArray(environmentIds))target.environmentIds=strings(environmentIds);
  if(scope==='verification'){
    const scopedChecks=(values:unknown,originals:Verification[],owner=task.id):Verification[]=>{
      const raw=records(values);
      if(!raw.length&&originals.length)throw new PlanningFailure('invalid-plan',['A correção de verificação não pode apagar as receitas originais.'],task.id);
      const selected=new Set(target.environmentIds);
      for(;;){const size=selected.size;for(const node of plan.environment)if(selected.has(node.id))node.dependsOn.forEach(id=>selected.add(id));if(size===selected.size)break;}
      const prepared=raw.map(candidate=>{
        const original=originals.find(check=>check.id===candidate.id)??(originals.length===1&&raw.length===1?originals[0]:undefined);
        const claim=candidate.conformance===undefined?original?.conformance:object(candidate.conformance)?{...original?.conformance,...candidate.conformance}:null;
        if(candidate.conformance!==undefined&&!claim)throw new PlanningFailure('invalid-plan',['A correção não pode remover ou tornar ilegível uma declaração de conformidade.'],task.id);
        const proposed={...original,...candidate,...(original?{id:original.id,...(original.expected!==undefined?{expected:original.expected}:{})}:{}),requirementIds:uniqueStrings([...(original?.requirementIds??[]),...strings(candidate.requirementIds).map(id=>resolveRequirementAlias(brief,id)).filter(id=>task.requirementIds.includes(id))]),...(claim?{conformance:claim}:{})};
        if(candidate.conformance!==undefined){
          const normalized=normalizeChecks([proposed],brief)[0];
          const conformance=normalized?.conformance;
          const requirement=brief.requirements.find(item=>item.id===conformance?.requirementId);
          if(!conformance||!conformance.productInputs.length||!requirement||!task.requirementIds.includes(requirement.id)||!plan.environment.some(node=>selected.has(node.id)&&obligationMatchesProvider(requirement,node.identity)&&matchesOperationalClaim(requirement,conformance,node.identity)))throw new PlanningFailure('invalid-plan',['A conformidade proposta não corresponde à obrigação literal e ao provedor operacional consumido pela unidade. Nenhuma declaração ou prova foi adotada.'],task.id);
        }
        return proposed;
      });
      const updates=normalizeChecks(prepared,brief).map(check=>{
        const original=originals.find(item=>item.id===check.id),candidate=raw.find(item=>item.id===check.id)??(originals.length===1&&raw.length===1?raw[0]:undefined);
        const sameInvocation=original&&stableJson([original.command,original.args??[],original.cwd??'.'])===stableJson([check.command,check.args??[],check.cwd??'.']);
        return{...check,...(sameInvocation&&original.instrument?{instrument:structuredClone(original.instrument)}:{}),...(sameInvocation&&original.recipeCandidate?{recipeCandidate:structuredClone(original.recipeCandidate)}:{}),...(original?.assertionIssue&&candidate?.assertion===undefined?{assertionIssue:original.assertionIssue}:{})};
      });
      const byId=new Map(updates.map(check=>[check.id,check])),originalIds=new Set(originals.map(check=>check.id));
      const checks=[...originals.map(check=>byId.get(check.id)??check),...updates.filter(check=>!originalIds.has(check.id))];
      const covered=new Set(checks.flatMap(check=>check.requirementIds));
      const missing=uniqueStrings(originals.flatMap(check=>check.requirementIds)).filter(id=>!covered.has(id));
      if(missing.length)throw new PlanningFailure('invalid-plan',[`A correção de verificação removeu cobertura obrigatória: ${missing.join(', ')}. A entrega original foi preservada.`],task.id);
      for(const after of updates){const before=originals.find(check=>check.id===after.id);if(stableJson(before)!==stableJson(after))verificationTransformations.push({taskId:owner,checkId:after.id,before:before?structuredClone(before):undefined,after:structuredClone(after)});}
      return checks;
    };
    const checks=technical.checks??result.checks;
    if(Array.isArray(checks))target.checks=scopedChecks(checks,task.checks);
    const inputs=technical.inputs??result.inputs;
    if(Array.isArray(inputs))target.inputs=safePaths(inputs);
    if(Array.isArray(result.acceptance)){
      for(const candidate of records(result.acceptance)){
        const original=plan.acceptance?.find(check=>check.id===candidate.id);
        if(original&&!original.requirementIds.some(id=>task.requirementIds.includes(id)))throw new PlanningFailure('invalid-plan',['A correção local tentou alterar uma prova de aceite sem relação com a entrega afetada.'],task.id);
        const checks=scopedChecks([candidate],original?[original]:[],'$acceptance');
        const ids=new Set(checks.map(check=>check.id));
        plan.acceptance=[...(plan.acceptance??[]).filter(check=>!ids.has(check.id)),...checks];
      }
    }
  }
  if(JSON.stringify({environment:plan.environment,tasks:plan.tasks,acceptance:plan.acceptance})===JSON.stringify({environment:options.plan.environment,tasks:options.plan.tasks,acceptance:options.plan.acceptance}))throw new PlanningFailure('no-progress',[`O reparo ${scope} não alterou nenhuma receita ou capacidade executável. Mudanças de título ou objetivo não podem substituir a entrega.`],task.id);
  await repairGraph(plan,brief,'environment',options);
  assertValidPlan(brief,plan);
  plan.revision+=1;plan.briefId=brief.id;plan.briefRevision=brief.revision;
  plan.status=options.finalize===false?'planning':'ready';
  await options.save?.({brief,plan});
  emitEvent(options.onEvent,{type:'replanned',message:`Contrato técnico de ${scope} corrigido; identidade, critérios e código da entrega preservados.`,subject:task.id,detail:{verificationTransformations}});
  return plan;
}

/** Repair only the affected engineering unit; product restrictions retain their original authority. */
export async function repairWorkPlan(options: RepairPlanOptions): Promise<DevelopmentPlan> {
  let plan = structuredClone(options.plan);
  plan.status = "planning";
  const task = plan.tasks.find((candidate) => candidate.id === options.taskId);
  if (!task) return options.plan;
  if(options.repairScope==='authority')return repairSourceAuthority(options,task);
  if(options.repairScope==='verification'||options.repairScope==='environment')return repairRestrictedWorkPlan(options,task,options.repairScope);
  const progress = { id: `plan:repair:${task.id}`, label: `Revisão do plano: ${task.title}`, stage: "plan" };
  emitProgress(options.onEvent, { ...progress, status: "running" });
  const brief = options.brief;
  const requirements = brief.requirements.filter((requirement) => task.requirementIds.includes(requirement.id));
  if (!requirements.length) throw new PlanningFailure("missing-requirement", ["A unidade afetada não está vinculada a nenhum resultado obrigatório do pedido."], task.id);
  const limit = options.contextChars ?? 24_000;
  let repairProblem=options.problem;
  let replacements: WorkUnit[] = [];
  const repairRecovery = new PlanningProgress(`repair:${task.id}`);
  for (;;) {
    cancelled(options.signal);
    const prompt=engineeringRepairContext({brief,plan,task,problem:repairProblem,limit});
    const repaired=await requestObject({...options,operation:'repair',prompt});
    const candidate=structuredClone(plan);
    candidate.environment=normalizeEnvironment([...candidate.environment,...records(repaired.environment)],brief);
    candidate.contracts=unique([...candidate.contracts,...contractsFrom(repaired.contracts,brief.requirements)]);
    let issues:string[]=[];
    try{
      replacements=normalizeTasks(decompositionTasks(repaired.tasks,task),brief,candidate.environment,candidate.contracts,requirements);
      issues=decompositionIssues(task,replacements,plan);
    }catch(error){
      if(!(error instanceof PlanningFailure))throw error;
      issues=error.details;
    }
    if(issues.length){
      emitEvent(options.onEvent,{type:'recovering',message:'A decomposição perdeu obrigações ou escopos; proposta recusada e tarefa original preservada.',subject:task.id,detail:{issues}});
      repairRecovery.requireChange({repaired,issues},'A decomposição de engenharia não preservou a responsabilidade original.');
      repairProblem=`${options.problem}\nPrevious proposal was not adopted. Correct its concrete omissions; original definitions remain available by indexed reference. ${JSON.stringify(issues)}`;
      continue;
    }
    await resolveQuestions(brief,records(repaired.questions),options);
    candidate.environment=normalizeEnvironment([...plan.environment,...await executableEnvironment(repaired.environment,brief,options)],brief);
    plan=candidate;
    emitEvent(options.onEvent,{type:'replanned',message:'Decomposição por responsabilidades de engenharia adotada; critérios e receitas originais preservados por referência.',subject:task.id,detail:{sourceTaskId:task.id,replacements:replacements.map(item=>({id:item.id,files:item.files,originalScopes:task.files}))}});
    break;
  }
  await repairGraph(plan, brief, "environment", options);
  const replacementAliases = new Map<string, string>();
  for (const replacement of replacements) {
    const existing = plan.tasks.find(candidate => candidate.id !== task.id && sameDelivery(candidate, replacement));
    if (existing) { replacementAliases.set(replacement.id, existing.id); replacement.id = existing.id; }
  }
  for (const replacement of replacements) replacement.dependsOn = replacement.dependsOn.map(id => replacementAliases.get(id) ?? id);
  const ids = new Set(replacements.map((replacement) => replacement.id));
  replacements = replacements.map((replacement) => ({ ...replacement, dependsOn: uniqueStrings([...task.dependsOn.filter(id => id !== replacement.id), ...replacement.dependsOn.filter((id) => id !== task.id || ids.has(task.id))]) }));
  const consumed = new Set(replacements.flatMap((replacement) => replacement.dependsOn).filter((id) => ids.has(id)));
  const terminal = replacements.filter((replacement) => !consumed.has(replacement.id)).map((replacement) => replacement.id);
  const index = plan.tasks.findIndex((candidate) => candidate.id === task.id);
  plan.tasks.splice(index, 1, ...replacements);
  for (const candidate of plan.tasks) if (!ids.has(candidate.id) && candidate.dependsOn.includes(task.id)) candidate.dependsOn = uniqueStrings(candidate.dependsOn.flatMap((id) => id === task.id ? terminal : [id]));
  await ensureCoverage(brief, plan, options);
  Object.assign(plan, reconcilePlan(brief, plan, options.plan));
  await repairReferences(plan, brief, options);
  await repairGraph(plan, brief, "environment", options);
  await repairGraph(plan, brief, "tasks", options);
  plan.revision += 1;
  plan.briefId = brief.id;
  plan.briefRevision = brief.revision;
  if (options.finalize !== false) {
    const contextRecovery = new PlanningProgress(`repair-context:${task.id}`);
    for (;;) {
      let oversized: ContextTooLarge | null = null;
      for (const candidate of plan.tasks) {
        try { contextForTask(brief, plan, candidate, limit); }
        catch (error) { if (!(error instanceof ContextTooLarge)) throw error; oversized = error; break; }
      }
      if (!oversized) break;
      contextRecovery.requireChange({task: oversized.taskId, tasks: plan.tasks}, oversized.message, plan.tasks.find(task=>task.id===oversized!.taskId)?.requirementIds.slice().sort().join(","));
      plan = await repairWorkPlan({ ...options, plan, taskId: oversized.taskId, problem: oversized.message, finalize: false });
    }
  }
  await repairPlanIssues(brief, plan, options);
  assertValidPlan(brief, plan);
  plan.status = options.finalize === false ? "planning" : "ready";
  await options.save?.({ brief, plan });
  emitProgress(options.onEvent, { ...progress, status: "complete" });
  emitEvent(options.onEvent, { type: "replanned", message: "Premissa técnica corrigida na origem; trabalho independente preservado.", subject: task.id });
  return plan;
}
