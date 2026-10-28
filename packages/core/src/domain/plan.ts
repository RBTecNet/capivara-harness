import { allowedCapabilities, identity, inferredCapabilities, normalize } from "./authority.js";
import { contextForTask, ContextTooLarge, ordered } from "./context.js";
import { applyRepositoryConstraints, resolveQuestions, splitText } from "./init.js";
import { cancelled, object, pause, records, requestObject, string, strings } from "./json.js";
import { boundedReferences } from "./material.js";
import type { CommandRecipe, DevelopmentPlan, DomainHooks, EnvironmentNode, IntegrationContract, PlanOptions, ProductBrief, Requirement, Verification, WorkUnit } from "./types.js";

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
    const capabilities = uniqueStrings([...inferredCapabilities(name), ...prepare.flatMap((command) => command.capabilities ?? [])]);
    if (kind === "package") capabilities.push("external-package");
    if (!allowedCapabilities(brief, capabilities)) { incompatible.add(cleanId(item.id, identity("env", normalize(name)))); continue; }
    result.push({ id: cleanId(item.id, identity("env", normalize(name))), name, kind, dependsOn: strings(item.dependsOn), targets: strings(item.targets), reason: string(item.reason, `Preparar ${name} para o comportamento pedido.`), check, prepare });
  }
  const byName = new Map<string, EnvironmentNode>();
  const aliases = new Map<string, string>();
  for (const node of result) {
    const key = normalize(`${node.kind}:${node.name}`);
    const earlier = byName.get(key);
    if (earlier) {
      aliases.set(node.id, earlier.id);
      earlier.dependsOn = uniqueStrings([...earlier.dependsOn, ...node.dependsOn]);
    } else byName.set(key, node);
  }
  const nodes = [...byName.values()];
  // A removed incompatible browser tool cannot remain a prerequisite of a terminal task.
  for (const node of nodes) node.dependsOn = uniqueStrings(node.dependsOn.map((id) => aliases.get(id) ?? id)).filter((id) => id !== node.id && !incompatible.has(id));
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
    result.push(check);
  }
  return result;
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
      requirementIds: requirementIds.length ? requirementIds : fallbackRequirements.map((requirement) => requirement.id),
      dependsOn: strings(item.dependsOn), environmentIds: strings(item.environmentIds).map((id) => environments.get(id.toLowerCase()) ?? id),
      contractIds: strings(item.contractIds).map((id) => contractIds.get(id.toLowerCase()) ?? id), files: safePaths(item.files),
      criteria: criteria.length ? criteria : [goal], checks: normalizeChecks(item.checks, brief),
      risk: ["low", "normal", "high"].includes(string(item.risk)) ? string(item.risk) as WorkUnit["risk"] : "normal",
      blockedBy: strings(item.blockedBy).filter((id) => brief.gaps.some((gap) => gap.id === id && gap.status === "pending")),
    };
  }).filter((task) => task.goal !== "");
}

/** Resolve missing prerequisites and real cycles, rather than deleting edges to obtain a green DAG. */
async function repairGraph(plan: DevelopmentPlan, brief: ProductBrief, kind: "environment" | "tasks", hooks: DomainHooks): Promise<void> {
  let previous = "";
  let repeated = 0;
  for (;;) {
    cancelled(hooks.signal);
    const nodes: (EnvironmentNode | WorkUnit)[] = plan[kind];
    const ids = new Set(nodes.map((node) => node.id));
    const lowerIds = new Map(nodes.map((node) => [node.id.toLowerCase(), node.id]));
    for (const node of nodes) node.dependsOn = uniqueStrings(node.dependsOn.map((id) => lowerIds.get(id.toLowerCase()) ?? id)).filter((id) => id !== node.id);
    const sorted = ordered(nodes);
    if (!sorted.unresolved.length) {
      if (kind === "environment") plan.environment = sorted.ready.filter((node): node is EnvironmentNode => "kind" in node);
      else plan.tasks = sorted.ready.filter((node): node is WorkUnit => "goal" in node);
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
    repeated = description === previous ? repeated + 1 : 0;
    previous = description;
    if (repeated > 0) await pause(Math.min(30_000, repeated * 2_000), hooks.signal);
    hooks.onEvent?.({ type: "recovering", message: "Corrigindo dependência ausente ou circular na origem, preservando o trabalho válido.", subject: kind });
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
  const repeats = new Map<string, number>();
  while (pending.length) {
    cancelled(hooks.signal);
    const candidate = pending.shift();
    if (object(candidate) && string(candidate.name) && recipe(candidate.check)) {
      const nodes = normalizeEnvironment([candidate], brief);
      if (!nodes.length) hooks.onEvent?.({ type: "recovering", message: "Pré-requisito incompatível com o produto rejeitado antes de preparar o ambiente.", subject: string(candidate.id) });
      complete.push(...nodes);
      continue;
    }
    const serialized = JSON.stringify(candidate) ?? "null";
    const repeated = repeats.get(serialized) ?? 0;
    repeats.set(serialized, repeated + 1);
    if (repeated) await pause(Math.min(30_000, repeated * 2_000), hooks.signal);
    hooks.onEvent?.({ type: "recovering", message: "Completando a receita executável de um pré-requisito, sem perder a dependência.", subject: "environment" });
    const result = await requestObject({ ...hooks, operation: "repair", prompt: [
      "Repair this incomplete technical prerequisite. An environment node needs a real availability check and preparation recipes, not a prose placeholder. Do not edit files.",
      'Return {"environment":[{"id":"stable id","name":"prerequisite","kind":"runtime|sdk|tool|package|service|database","dependsOn":[],"targets":[],"reason":"actual consumer","check":{"command":"availability command","args":[]},"prepare":[{"command":"preparation command","args":[],"system":false}]}],"unnecessary":false,"reason":"technical explanation"}. Use unnecessary=true and environment=[] only if this is actually an optional or forbidden instrument.',
      `Product: ${productFacts(brief, Math.min(1_500, Math.floor((hooks.contextChars ?? 24_000) / 5)))}`,
      `Incomplete prerequisite: ${serialized}`,
    ].join("\n\n") });
    const corrected = Array.isArray(result.environment) ? result.environment : [];
    if (corrected.length) pending.unshift(...corrected);
    else if (result.unnecessary === true && string(result.reason)) hooks.onEvent?.({ type: "replanned", message: `Pré-requisito dispensado com justificativa técnica: ${string(result.reason)}`, subject: "environment" });
    else pending.unshift(candidate);
  }
  return normalizeEnvironment(complete, brief);
}

/** Preserve unresolved references until they have a real dependency or a justified engineering correction. */
async function repairReferences(plan: DevelopmentPlan, brief: ProductBrief, hooks: DomainHooks): Promise<void> {
  let previous = "";
  let repeated = 0;
  for (;;) {
    const task = plan.tasks.find((unit) => unit.environmentIds.some((id) => !plan.environment.some((node) => node.id === id)) || unit.contractIds.some((id) => !plan.contracts.some((contract) => contract.id === id)));
    if (!task) return;
    cancelled(hooks.signal);
    const missingEnvironment = task.environmentIds.filter((id) => !plan.environment.some((node) => node.id === id));
    const missingContracts = task.contractIds.filter((id) => !plan.contracts.some((contract) => contract.id === id));
    const state = JSON.stringify([task.id, missingEnvironment, missingContracts]);
    repeated = previous === state ? repeated + 1 : 0; previous = state;
    if (repeated) await pause(Math.min(30_000, repeated * 2_000), hooks.signal);
    hooks.onEvent?.({ type: "recovering", message: "Resolvendo pré-requisito ou contrato citado por uma tarefa antes da construção.", subject: task.id });
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

function ensureCoverage(brief: ProductBrief, plan: DevelopmentPlan): void {
  const covered = new Set(plan.tasks.flatMap((task) => task.requirementIds));
  for (const requirement of brief.requirements) {
    if (covered.has(requirement.id)) continue;
    plan.tasks.push({ id: identity("task", requirement.id), title: requirement.statement.slice(0, 120), goal: requirement.statement, instructions: `Implementar o requisito ${requirement.id}, mantendo os contratos existentes pertinentes.`, requirementIds: [requirement.id], dependsOn: [], environmentIds: plan.environment.map((node) => node.id), contractIds: plan.contracts.filter((contract) => contract.requirementIds.includes(requirement.id)).map((contract) => contract.id), files: [], criteria: [requirement.statement], checks: [], risk: "normal", blockedBy: [] });
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

export async function runPlan(options: PlanOptions): Promise<DevelopmentPlan> {
  const brief = options.brief;
  applyRepositoryConstraints(brief, options.repositoryConstraints);
  await resolveQuestions(brief, [], options);
  applyRepositoryConstraints(brief, options.repositoryConstraints);
  if (options.existing?.status === "ready" && options.existing.briefId === brief.id && options.existing.briefRevision === brief.revision) return structuredClone(options.existing);
  const limit = options.contextChars ?? 24_000;
  const facts = productFacts(brief, Math.floor(limit / 8));
  const groups = requirementGroups(brief, Math.max(400, Math.floor(limit / 4)));
  const environmentScopes: Set<string>[] = [];
  const plan: DevelopmentPlan = { schema: "capivara/plan/1", status: "planning", revision: (options.existing?.revision ?? 0) + 1, briefId: brief.id, briefRevision: brief.revision, environment: [], contracts: [], tasks: [] };
  // Environment is generated and persisted before requesting any construction tasks.
  for (const requirements of groups) {
    cancelled(options.signal);
    const result = await requestObject({ ...options, operation: "environment", prompt: [
      "Plan executable technical prerequisites before implementation. Do not edit files. Return JSON.",
      'Shape: {"environment":[{"id":"stable-id","name":"runtime SDK tool package service or database","kind":"runtime|sdk|tool|package|service|database","dependsOn":[],"targets":[],"reason":"consumer and reason","check":{"command":"executable or shell command","args":[],"capabilities":[]},"prepare":[{"command":"preparation command","args":[],"system":false,"capabilities":[]}]}],"questions":[]}',
      "Include only prerequisites of these actual requirements. Selected reference metadata is supporting material, not required product outcomes; read applicable local paths before architectural choices. Runtime of the harness is not the product runtime. Browser tooling is appropriate only for a browser interface. Prefer local preparation over host mutation. A missing product fact may be asked with fact/question/reason/impact/category/modes/options/blocks; otherwise questions=[].",
      `Product facts:\n${facts}`,
      `Requirements:\n${JSON.stringify(requirements)}`,
      options.repository ? `Repository facts:\n${options.repository.slice(0, Math.min(2_000, Math.floor(limit / 8)))}` : "",
    ].filter(Boolean).join("\n\n") });
    await resolveQuestions(brief, records(result.questions), options);
    const additions = await executableEnvironment(result.environment, brief, options);
    environmentScopes.push(new Set(additions.map((node) => normalize(`${node.kind}:${node.name}`))));
    plan.environment = normalizeEnvironment([...plan.environment, ...additions], brief);
    await options.save?.({ brief, plan });
  }
  await repairGraph(plan, brief, "environment", options);
  await options.save?.({ brief, plan });
  options.onEvent?.({ type: "environment", message: "Árvore de preparação registrada antes das tarefas.", subject: "plan" });
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
    const used = new Set(plan.tasks.map((task) => task.id));
    const aliases = new Map<string, string>();
    for (const task of tasks) if (used.has(task.id)) { const old = task.id; task.id = `${task.id}-${index + 1}`; aliases.set(old, task.id); }
    for (const task of tasks) task.dependsOn = task.dependsOn.map((id) => aliases.get(id) ?? id);
    plan.tasks.push(...tasks);
    await options.save?.({ brief, plan });
  }
  ensureCoverage(brief, plan);
  plan.tasks = unique(plan.tasks);
  await repairReferences(plan, brief, options);
  await repairGraph(plan, brief, "environment", options);
  await repairGraph(plan, brief, "tasks", options);
  plan.briefRevision = brief.revision;
  await options.save?.({ brief, plan });
  // Oversized packets are refined before BUILD receives them; no fake character ceiling expansion.
  for (;;) {
    let oversized: ContextTooLarge | null = null;
    for (const task of plan.tasks) {
      try { contextForTask(brief, plan, task, Math.floor(limit / 2)); }
      catch (error) { if (!(error instanceof ContextTooLarge)) throw error; oversized = error; break; }
    }
    if (!oversized) break;
    const repaired = await repairWorkPlan({ ...options, brief, plan, taskId: oversized.taskId, problem: oversized.message, finalize: false });
    plan.tasks = repaired.tasks; plan.environment = repaired.environment; plan.contracts = repaired.contracts; plan.revision = repaired.revision;
  }
  plan.status = "ready";
  await options.save?.({ brief, plan });
  options.onEvent?.({ type: "complete", message: "Dependências, contratos e fragmentos de desenvolvimento estão estruturados.", subject: "plan" });
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
  const brief = options.brief;
  const requirements = brief.requirements.filter((requirement) => task.requirementIds.includes(requirement.id));
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
  let emptyResponses = 0;
  for (;;) {
    cancelled(options.signal);
    if (chunks.length === 1) repaired = await requestObject({ ...options, operation: "repair", prompt });
    else {
      // Reduce only the affected source packet, preserving each requirement and its literal content.
      const pieces = requirements.length ? requirements.map((requirement) => ({ text: requirement.statement, requirementIds: [requirement.id] })) : splitText(task.instructions || task.goal, Math.max(200, Math.floor(limit / 8))).map((text) => ({ text, requirementIds: [] as string[] }));
      const taskCopies = pieces.map((piece, index): WorkUnit => ({ ...task, id: `${task.id}.${index + 1}`, title: piece.text.slice(0, 120), requirementIds: piece.requirementIds, goal: piece.text, instructions: `Implement the local outcome; preserve the consumed integration contracts.`, criteria: [piece.text], dependsOn: index === 0 ? task.dependsOn : [`${task.id}.${index}`], contractIds: task.contractIds.filter((id) => plan.contracts.some((contract) => contract.id === id && (contract.requirementIds.length === 0 || contract.requirementIds.some((requirementId) => piece.requirementIds.includes(requirementId))))), checks: task.checks.filter((check) => check.requirementIds.some((id) => piece.requirementIds.includes(id)) || check.requirementIds.length === 0 && index === pieces.length - 1) }));
      repaired = { tasks: taskCopies };
    }
    await resolveQuestions(brief, records(repaired.questions), options);
    plan.environment = normalizeEnvironment([...plan.environment, ...await executableEnvironment(repaired.environment, brief, options)], brief);
    plan.contracts = unique([...plan.contracts, ...contractsFrom(repaired.contracts, brief.requirements)]);
    replacements = normalizeTasks(repaired.tasks, brief, plan.environment, plan.contracts, requirements);
    if (replacements.length) break;
    options.onEvent?.({ type: "recovering", message: "O reparo local não trouxe unidades executáveis; preservando a tarefa e buscando uma decomposição útil.", subject: task.id });
    emptyResponses += 1;
    await pause(Math.min(30_000, emptyResponses * 2_000), options.signal);
  }
  await repairGraph(plan, brief, "environment", options);
  const covered = new Set(replacements.flatMap((replacement) => replacement.requirementIds));
  for (const requirement of requirements) if (!covered.has(requirement.id)) replacements.push({ ...task, id: `${task.id}.${identity("missing", requirement.id)}`, requirementIds: [requirement.id], goal: requirement.statement, criteria: [requirement.statement] });
  const ids = new Set(replacements.map((replacement) => replacement.id));
  replacements = replacements.map((replacement) => ({ ...replacement, dependsOn: uniqueStrings([...task.dependsOn, ...replacement.dependsOn.filter((id) => id !== task.id || ids.has(task.id))]).filter((id) => id !== replacement.id) }));
  const consumed = new Set(replacements.flatMap((replacement) => replacement.dependsOn).filter((id) => ids.has(id)));
  const terminal = replacements.filter((replacement) => !consumed.has(replacement.id)).map((replacement) => replacement.id);
  const index = plan.tasks.findIndex((candidate) => candidate.id === task.id);
  plan.tasks.splice(index, 1, ...replacements);
  for (const candidate of plan.tasks) if (!ids.has(candidate.id) && candidate.dependsOn.includes(task.id)) candidate.dependsOn = uniqueStrings(candidate.dependsOn.flatMap((id) => id === task.id ? terminal : [id]));
  ensureCoverage(brief, plan);
  plan.tasks = unique(plan.tasks);
  await repairReferences(plan, brief, options);
  await repairGraph(plan, brief, "environment", options);
  await repairGraph(plan, brief, "tasks", options);
  plan.revision += 1;
  plan.briefId = brief.id;
  plan.briefRevision = brief.revision;
  if (options.finalize !== false) {
    for (;;) {
      let oversized: ContextTooLarge | null = null;
      for (const candidate of plan.tasks) {
        try { contextForTask(brief, plan, candidate, Math.floor(limit / 2)); }
        catch (error) { if (!(error instanceof ContextTooLarge)) throw error; oversized = error; break; }
      }
      if (!oversized) break;
      plan = await repairWorkPlan({ ...options, plan, taskId: oversized.taskId, problem: oversized.message, finalize: false });
    }
  }
  plan.status = options.finalize === false ? "planning" : "ready";
  await options.save?.({ brief, plan });
  options.onEvent?.({ type: "replanned", message: "Premissa técnica corrigida na origem; trabalho independente preservado.", subject: task.id });
  return plan;
}
