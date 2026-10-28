import { allowedCapabilities, identity, inferredCapabilities, normalize } from "./authority.js";
import { contextForTask, ContextTooLarge, ordered } from "./context.js";
import { applyRepositoryConstraints, resolveQuestions, splitText } from "./init.js";
import { cancelled, object, records, requestObject, string, strings } from "./json.js";
import { boundedReferences } from "./material.js";
import type { CommandRecipe, DevelopmentPlan, DomainHooks, EnvironmentNode, IntegrationContract, PlanOptions, ProductBrief, Requirement, Verification, WorkUnit } from "./types.js";
import { emitEvent, emitProgress } from "../telemetry/progress.js";
import { PlanningFailure, PlanningProgress } from "./control.js";
import { assertValidPlan, reconcileChecks, reconcilePlan, sameDelivery, validatePlan } from "./reconcile.js";

const cleanId = (value: unknown, fallback: string): string => string(value).replace(/[^a-zA-Z0-9_.:-]+/g, "-") || fallback;
const unique = <T extends { id: string }>(items: T[]): T[] => [...new Map(items.map((item) => [item.id, item])).values()];
const uniqueStrings = (items: string[]): string[] => [...new Set(items)];
const argv = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

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

export function normalizeEnvironment(value: unknown, brief: ProductBrief): EnvironmentNode[] {
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
    if (Array.isArray(item.requirementIds)) node.requirementIds = strings(item.requirementIds).filter(id => brief.requirements.some(requirement => requirement.id === id));
    if (object(item.provides)) {
      const provided: NonNullable<EnvironmentNode["provides"]> = {};
      const command = argv(item.provides.command); if (command.length) provided.command = command;
      if (object(item.provides.env)) provided.env = Object.fromEntries(Object.entries(item.provides.env).filter((entry): entry is [string, string] => typeof entry[1] === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry[0])));
      if (Array.isArray(item.provides.paths)) provided.paths = strings(item.provides.paths);
      if (Array.isArray(item.provides.inputs)) provided.inputs = safePaths(item.provides.inputs);
      if (Object.keys(provided).length) node.provides = provided;
    }
    result.push(node);
  }
  const byName = new Map<string, EnvironmentNode>();
  const aliases = new Map<string, string>();
  for (const node of result) {
    const key = normalize(node.identity ? `${node.identity.capability}:${node.identity.kind}:${node.identity.provider}` : `${node.kind}:${node.name}`);
    const earlier = byName.get(key);
    if (earlier) {
      aliases.set(node.id, earlier.id);
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

export function normalizeChecks(value: unknown, brief: ProductBrief): Verification[] {
  const result: Verification[] = [];
  for (const item of records(value)) {
    const kind = ["command", "cli", "tui", "web", "desktop"].includes(string(item.kind)) ? string(item.kind) as Verification["kind"] : "command";
    const command = string(item.command);
    const capabilities = uniqueStrings([...strings(item.requiredCapabilities), ...inferredCapabilities(`${command} ${argv(item.args).join(" ")}`), ...(kind === "web" ? ["browser"] : [])]);
    if (!allowedCapabilities(brief, capabilities)) continue;
    if (kind === "desktop" && !brief.modes.includes("desktop")) continue;
    const check: Verification = { id: cleanId(item.id, identity("check", `${kind}:${command}:${string(item.expected)}`)), kind, requirementIds: strings(item.requirementIds), requiredCapabilities: capabilities };
    if (command) check.command = command;
    const args = argv(item.args);
    if (args.length) check.args = args;
    const expected = string(item.expected);
    if (expected) check.expected = expected;
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
    if (object(item.conformance) && string(item.conformance.requirementId) && string(item.conformance.capability) && string(item.conformance.provider) && ["cli", "library", "driver", "service", "runtime", "sdk"].includes(string(item.conformance.kind))) {
      check.conformance = { requirementId: string(item.conformance.requirementId), capability: string(item.conformance.capability), kind: string(item.conformance.kind) as NonNullable<Verification["conformance"]>["kind"], provider: string(item.conformance.provider), productInputs: safePaths(item.conformance.productInputs), ...(Array.isArray(item.conformance.providerCommand) ? {providerCommand:argv(item.conformance.providerCommand)} : {}), ...(Array.isArray(item.conformance.providerInputs) ? {providerInputs:safePaths(item.conformance.providerInputs)} : {}), ...(Array.isArray(item.conformance.artifacts) ? {artifacts:safePaths(item.conformance.artifacts)} : {}) };
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
    const requirementIds = strings(item.requirementIds).filter((id) => available.has(id));
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

/** Repair explicit invariant violations once per changed state, never approve around them. */
async function repairPlanIssues(brief: ProductBrief, plan: DevelopmentPlan, hooks: DomainHooks): Promise<void> {
  const recovery = new PlanningProgress("plan-invariants");
  for (;;) {
    const issues = validatePlan(brief, plan);
    if (!issues.length) return;
    const issue = issues[0]!;
    recovery.requireChange({ issues, tasks: plan.tasks, environment: plan.environment, acceptance: plan.acceptance }, "O plano viola invariantes de cobertura, capacidade ou conformidade.", `${issue.code}:${issue.subject}`);
    const limit = hooks.contextChars ?? 24_000;
    const task = plan.tasks.find(candidate => candidate.id === issue.subject || candidate.requirementIds.includes(issue.subject));
    const requirementIds = new Set([issue.subject, ...(task?.requirementIds ?? [])]);
    const result = await requestObject({...hooks, operation: "repair", prompt: [
      "Repair the concrete structural defect below. Preserve mandatory user choices and all unaffected deliveries. A passing syntax check cannot replace production build or behavior proof. Return only changed complete definitions, not another parallel plan.",
      'Shape: {"tasks":[],"environment":[],"contracts":[],"acceptance":[],"reason":"causal correction"}. Definitions with existing IDs replace those definitions. Mandatory requirement.binding is matched by environment.identity={capability,kind,provider}; provide executable readiness and acceptance recipes with requirementIds and level=build|behavior. A driver does not satisfy a CLI capability.',
      'A mandatory binding needs dedicated acceptance.conformance={requirementId,capability,kind,provider,productInputs:["actual product paths"],artifacts:[]}. Runtime conformance executes product source with that actual runtime and an observed behavior assertion. SDK build conformance records outputs/artifacts and another behavior check with dependsOn:["producer-check-id"] consumes that exact produced artifact. --version/help and labels are not product usage.',
      `Invariant: ${JSON.stringify(issue)}`,
      `Relevant mandatory requirements: ${metadataList(brief.requirements.filter(requirement=>requirementIds.has(requirement.id)), Math.floor(limit / 4))}`,
      `Affected delivery: ${metadataList(task ? [task] : [], Math.floor(limit / 4))}`,
      `Relevant capabilities: ${metadataList(plan.environment.filter(node=>task?.environmentIds.includes(node.id) || node.requirementIds?.some(id=>requirementIds.has(id)) || brief.requirements.some(requirement=>requirementIds.has(requirement.id) && requirement.binding?.capability===node.identity?.capability)), Math.floor(limit / 5))}`,
      `Known identifiers: ${metadataList(plan.tasks.map(({id,requirementIds})=>({id,requirementIds})), Math.floor(limit / 10))}`,
    ].join("\n\n")});
    const nodes = await executableEnvironment(result.environment, brief, hooks);
    const changedEnvironment = new Set(nodes.map(node=>node.id));
    plan.environment = normalizeEnvironment([...plan.environment.filter(node=>!changedEnvironment.has(node.id)), ...nodes], brief);
    const changedContracts = contractsFrom(result.contracts, brief.requirements);
    plan.contracts = unique([...plan.contracts, ...changedContracts]);
    const tasks = normalizeTasks(result.tasks, brief, plan.environment, plan.contracts, []);
    const changedTasks = new Set(tasks.map(unit=>unit.id));
    plan.tasks = [...plan.tasks.filter(unit=>!changedTasks.has(unit.id)), ...tasks];
    const acceptance = normalizeChecks(result.acceptance, brief);
    const changedChecks = new Set(acceptance.map(check=>check.id));
    plan.acceptance = reconcileChecks([...(plan.acceptance ?? []).filter(check=>!changedChecks.has(check.id)), ...acceptance]);
    Object.assign(plan, reconcilePlan(brief, plan));
    await hooks.save?.({brief, plan});
  }
}

export async function runPlan(options: PlanOptions): Promise<DevelopmentPlan> {
  const brief = options.brief;
  applyRepositoryConstraints(brief, options.repositoryConstraints);
  await resolveQuestions(brief, [], options);
  applyRepositoryConstraints(brief, options.repositoryConstraints);
  if (options.existing?.status === "ready" && options.existing.briefId === brief.id && options.existing.briefRevision === brief.revision && !validatePlan(brief, options.existing).length) return reconcilePlan(brief, options.existing, options.existing);
  const limit = options.contextChars ?? 24_000;
  const facts = productFacts(brief, Math.floor(limit / 8));
  const groups = requirementGroups(brief, Math.max(400, Math.floor(limit / 4)));
  const environmentScopes: Set<string>[] = [];
  const plan: DevelopmentPlan = { schema: "capivara/plan/1", status: "planning", revision: (options.existing?.revision ?? 0) + 1, briefId: brief.id, briefRevision: brief.revision, environment: [], contracts: [], tasks: [] };
  const environmentProgress = { id: "plan:environment", label: "Grupos de pré-requisitos", total: groups.length, stage: "plan", unit: "grupos" };
  const outlineProgress = { id: "plan:outline", label: "Grupos de tarefas", total: groups.length, stage: "plan", unit: "grupos" };
  emitProgress(options.onEvent, { ...environmentProgress, completed: 0, status: groups.length ? "running" : "complete" });
  // Environment is generated and persisted before requesting any construction tasks.
  for (const [groupIndex, requirements] of groups.entries()) {
    cancelled(options.signal);
    const result = await requestObject({ ...options, operation: "environment", prompt: [
      "Plan executable technical prerequisites before implementation. Do not edit files. Return JSON.",
      'Shape: {"environment":[{"id":"stable-id","name":"runtime SDK tool package service or database","kind":"runtime|sdk|tool|package|service|database","dependsOn":[],"targets":[],"reason":"consumer and reason","check":{"command":"executable or shell command","args":[],"capabilities":[]},"prepare":[{"command":"preparation command","args":[],"system":false,"capabilities":[]}]}],"questions":[]}',
      "Include only prerequisites of these actual requirements. Selected reference metadata is supporting material, not required product outcomes; read applicable local paths before architectural choices. Runtime of the harness is not the product runtime. Browser tooling is appropriate only for a browser interface. Prefer local preparation over host mutation. A missing product fact may be asked with fact/question/reason/impact/category/modes/options/blocks; otherwise questions=[].",
      'Mandatory requirement.binding must match node.identity={capability,kind,provider}. Publish usable node.provides={command:[],env:{},paths:[],inputs:[]} for consumers and a concrete readiness probe. A CLI, library, driver, service and runtime are distinct capabilities.',
      `Product facts:\n${facts}`,
      `Requirements:\n${JSON.stringify(requirements)}`,
      options.repository ? `Repository facts:\n${options.repository.slice(0, Math.min(2_000, Math.floor(limit / 8)))}` : "",
    ].filter(Boolean).join("\n\n") });
    await resolveQuestions(brief, records(result.questions), options);
    const additions = await executableEnvironment(result.environment, brief, options);
    environmentScopes.push(new Set(additions.map((node) => normalize(`${node.kind}:${node.name}`))));
    plan.environment = normalizeEnvironment([...plan.environment, ...additions], brief);
    await options.save?.({ brief, plan });
    emitProgress(options.onEvent, { ...environmentProgress, completed: groupIndex + 1, status: groupIndex + 1 === groups.length ? "complete" : "running" });
  }
  await repairGraph(plan, brief, "environment", options);
  await options.save?.({ brief, plan });
  emitEvent(options.onEvent, { type: "environment", message: "Árvore de preparação registrada antes das tarefas.", subject: "plan" });
  emitProgress(options.onEvent, { ...outlineProgress, completed: 0, status: groups.length ? "running" : "complete" });
  for (const [index, requirements] of groups.entries()) {
    const scopedIds = new Set(plan.environment.filter((node, nodeIndex) => environmentScopes[index]?.has(normalize(`${node.kind}:${node.name}`)) || nodeIndex < 2 && ["runtime", "sdk"].includes(node.kind)).map((node) => node.id));
    for (;;) {
      const before = scopedIds.size;
      for (const node of plan.environment) if (scopedIds.has(node.id)) node.dependsOn.forEach((id) => scopedIds.add(id));
      if (before === scopedIds.size) break;
    }
    const result = await requestObject({ ...options, operation: "outline", prompt: [
      "Structure small executable work units and their integration contracts for these requirements. Return JSON; do not edit code.",
      'Shape: {"contracts":[{"id":"contract-id","name":"name","description":"precise behavior/interface","inputs":[],"outputs":[],"requirementIds":[]}],"tasks":[{"id":"task-id","title":"capability","goal":"observable outcome","instructions":"local implementation work","requirementIds":[],"dependsOn":[],"environmentIds":[],"contractIds":[],"files":[],"criteria":["necessary observable results"],"checks":[{"id":"check-id","kind":"command|cli|tui|web|desktop","command":"actual invocation with arguments when needed","expected":"observable outcome","expectedExitCode":0,"requirementIds":[],"requiredCapabilities":[],"steps":[{"waitFor":"ready screen"},{"input":"key bytes","waitFor":"changed screen"}],"closeInput":"exit key"}],"risk":"low|normal|high","blockedBy":[]}],"questions":[]}',
      "There is no task, test or criterion quota. Each unit must fit one small context. Only relevant verification is useful. Define contracts before consumers. No server or browser for a terminal product unless explicitly required. TUI checks use synchronized steps: wait for readiness, send keys, wait for the observed state change, close input; pipes are not an interactive terminal. Omit steps for other kinds. CLI input[] contains literal bytes; include newline explicitly when needed. expectedExitCode is the actual successful outcome of that scenario, including a nonzero code when testing an expected rejection. Ask only a missing product fact with concrete impact; library and installer choices are engineering work.",
      'Declare task.inputs (read dependencies), files (owned outputs), resources (exclusive names), and exclusiveContracts when a unit changes a shared interface. Checks declare inputs, cwd, level=syntax|build|behavior and requirementIds. Final acceptance=[] contains the concrete mandatory stack/interface/behavior proof recipes; syntax does not prove a production build or interaction.',
      'For every mandatory requirement.binding, acceptance has a dedicated conformance={requirementId,capability,kind,provider,productInputs:["real product paths"],artifacts:[]}. The real bound runtime executes product source; a compiled SDK build must produce declared outputs and a dependent functional recipe (dependsOn:["producer-check-id"]) consumes those exact artifacts. A ready tool or version probe cannot establish product conformance.',
      "Selected references support implementation; do not turn their code or every line into tasks. Read applicable skills/examples and cite their local paths in the instructions of units that need them, including globally applicable guidance.",
      `Product facts:\n${productFacts(brief, Math.floor(limit / 8))}`,
      `Requirements of this slice:\n${JSON.stringify(requirements)}`,
      `Technical prerequisites available in this slice (the full tree is recorded separately):\n${metadataList(plan.environment.filter((node) => scopedIds.has(node.id)).map(({ id, name, kind }) => ({ id, name: name.slice(0, 180), kind })), Math.floor(limit / 8))}`,
      plan.tasks.length ? `Earlier foundations and relevant unit identifiers:\n${metadataList(plan.tasks.filter((task, unitIndex) => unitIndex === 0 || task.requirementIds.some((id) => requirements.some((requirement) => requirement.id === id))).map(({ id, title }) => ({ id, title: title.slice(0, 120) })), Math.floor(limit / 12))}` : "",
      plan.contracts.length ? `Relevant existing contract identifiers (details are stored in the plan):\n${metadataList(plan.contracts.filter((contract) => contract.requirementIds.some((id) => requirements.some((requirement) => requirement.id === id))).map(({ id, name }) => ({ id, name: name.slice(0, 120) })), Math.floor(limit / 12))}` : "",
    ].filter(Boolean).join("\n\n") });
    await resolveQuestions(brief, records(result.questions), options);
    const contracts = contractsFrom(result.contracts, brief.requirements);
    plan.contracts = unique([...plan.contracts, ...contracts]);
    const tasks = normalizeTasks(result.tasks, brief, plan.environment, plan.contracts, requirements);
    plan.tasks.push(...tasks);
    plan.acceptance = reconcileChecks([...(plan.acceptance ?? []), ...normalizeChecks(result.acceptance, brief)]);
    Object.assign(plan, reconcilePlan(brief, plan, options.existing));
    await options.save?.({ brief, plan });
    emitProgress(options.onEvent, { ...outlineProgress, completed: index + 1, status: index + 1 === groups.length ? "complete" : "running" });
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
      try { contextForTask(brief, plan, task, Math.floor(limit / 2)); }
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
}

/** Repair only the affected engineering unit; product restrictions retain their original authority. */
export async function repairWorkPlan(options: RepairPlanOptions): Promise<DevelopmentPlan> {
  let plan = structuredClone(options.plan);
  plan.status = "planning";
  const task = plan.tasks.find((candidate) => candidate.id === options.taskId);
  if (!task) return options.plan;
  const progress = { id: `plan:repair:${task.id}`, label: `Revisão do plano: ${task.title}`, stage: "plan" };
  emitProgress(options.onEvent, { ...progress, status: "running" });
  const brief = options.brief;
  const requirements = brief.requirements.filter((requirement) => task.requirementIds.includes(requirement.id));
  if (!requirements.length) throw new PlanningFailure("missing-requirement", ["A unidade afetada não está vinculada a nenhum resultado obrigatório do pedido."], task.id);
  const prompt = [
    "Repair this local engineering work plan. The product intent and restrictions are authoritative. Return a JSON object; do not edit files.",
    'Shape: {"tasks":[{"id":"replacement-id","title":"small capability","goal":"observable outcome","instructions":"local work","requirementIds":[],"dependsOn":[],"environmentIds":[],"contractIds":[],"files":[],"criteria":[],"checks":[],"risk":"normal","blockedBy":[]}],"environment":[{"id":"new-id","name":"only necessary new prerequisite","kind":"tool","dependsOn":[],"targets":[],"check":{"command":"availability command"},"prepare":[]}],"contracts":[{"id":"new-interface","name":"name","description":"precise integration interface","inputs":[],"outputs":[],"requirementIds":[]}],"questions":[]}',
    "Split the unit if its context is too large. Keep the required behavior; do not change the product to satisfy an inappropriate validation tool. Replacement tasks must preserve all requirement IDs. Do not repeat already completed independent work. Questions are only for a missing product fact with concrete impact, never to settle an installer preference.",
    `Authoritative product facts and capability limits: ${productFacts(brief, Math.floor((options.contextChars ?? 24_000) / 5))}`,
    `Affected work unit: ${JSON.stringify(task)}`,
    `Relevant requirements: ${JSON.stringify(requirements)}`,
    `Contracts: ${JSON.stringify(plan.contracts.filter((contract) => task.contractIds.includes(contract.id)))}`,
    `Environment identifiers: ${plan.environment.map((node) => `${node.id}:${node.name}`).join(", ")}`,
    `Incident: ${options.problem}`,
  ].join("\n\n");
  const limit = options.contextChars ?? 24_000;
  const chunks = splitText(prompt, Math.max(2_000, limit - 2_000));
  let repaired: Record<string, unknown>;
  let replacements: WorkUnit[] = [];
  const repairRecovery = new PlanningProgress(`repair:${task.id}`);
  for (;;) {
    cancelled(options.signal);
    if (chunks.length === 1) repaired = await requestObject({ ...options, operation: "repair", prompt });
    else {
      // Reduce only the affected source packet, preserving each requirement and its literal content.
      const pieces = requirements.map((requirement) => ({ text: requirement.statement, requirementIds: [requirement.id] }));
      const taskCopies = pieces.map((piece, index): WorkUnit => ({ ...task, id: `${task.id}.${index + 1}`, title: piece.text.slice(0, 120), requirementIds: piece.requirementIds, goal: piece.text, instructions: `Implement the local outcome; preserve the consumed integration contracts.`, criteria: [piece.text], dependsOn: index === 0 ? task.dependsOn : [`${task.id}.${index}`], contractIds: task.contractIds.filter((id) => plan.contracts.some((contract) => contract.id === id && (contract.requirementIds.length === 0 || contract.requirementIds.some((requirementId) => piece.requirementIds.includes(requirementId))))), checks: task.checks.filter((check) => check.requirementIds.some((id) => piece.requirementIds.includes(id)) || check.requirementIds.length === 0 && index === pieces.length - 1) }));
      repaired = { tasks: taskCopies };
    }
    await resolveQuestions(brief, records(repaired.questions), options);
    plan.environment = normalizeEnvironment([...plan.environment, ...await executableEnvironment(repaired.environment, brief, options)], brief);
    plan.contracts = unique([...plan.contracts, ...contractsFrom(repaired.contracts, brief.requirements)]);
    replacements = normalizeTasks(repaired.tasks, brief, plan.environment, plan.contracts, requirements);
    if (replacements.length) break;
    emitEvent(options.onEvent, { type: "recovering", message: "O reparo local não trouxe unidades executáveis; preservando a tarefa e buscando uma decomposição útil.", subject: task.id });
    repairRecovery.requireChange({repaired, task}, "O reparo local não produziu uma decomposição executável.");
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
        try { contextForTask(brief, plan, candidate, Math.floor(limit / 2)); }
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
