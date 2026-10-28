import type { ContextPacket, DevelopmentPlan, ProductBrief, WorkUnit } from "./types.js";
import { boundedReferences, relevantReferences } from "./material.js";

export class ContextTooLarge extends Error {
  readonly taskId: string;
  readonly size: number;
  readonly limit: number;
  constructor(taskId: string, size: number, limit: number) {
    super(`A tarefa ${taskId} precisa ser dividida: pacote ${size} caracteres, capacidade ${limit}.`);
    this.name = "ContextTooLarge";
    this.taskId = taskId;
    this.size = size;
    this.limit = limit;
  }
}

export function packetText(packet: ContextPacket): string {
  const reference = (text: string): string => {
    const requirement = packet.requirements.find((item) => item.statement === text || item.source.text === text);
    return requirement ? `requirement ${requirement.id} below` : text;
  };
  return [
    `Project: ${packet.project.name}; interfaces: ${packet.project.modes.join(", ")}; targets: ${packet.project.targets.join(", ") || "not restricted"}.`,
    `Work unit ${packet.task.id}: ${packet.task.title}\nGoal: ${reference(packet.task.goal)}\n${reference(packet.task.instructions)}`,
    `Required outcomes:\n${packet.task.criteria.map((criterion) => `- ${reference(criterion)}`).join("\n")}`,
    `Requirements for this unit:\n${packet.requirements.map((requirement) => `${requirement.id}: ${requirement.statement}${requirement.binding ? `\nMandatory capability/provider: ${JSON.stringify(requirement.binding)}` : ""}\nSource (${requirement.source.reference}): ${requirement.source.text === requirement.statement ? "same literal statement" : requirement.source.text}${requirement.source.localPath ? `\nOriginal selected input: ${requirement.source.localPath}` : ""}`).join("\n")}`,
    `Product restrictions (an instrument cannot override them):\n${packet.constraints.map((constraint) => `${constraint.id}: ${constraint.statement}; forbidden capabilities=${constraint.forbiddenCapabilities.join(",") || "none"}; required=${constraint.requiredCapabilities.join(",") || "none"}`).join("\n")}`,
    `Complete capability limits enforced by the executor: forbidden=${packet.capabilityLimits.forbidden.join(",") || "none"}; required=${packet.capabilityLimits.required.join(",") || "none"}. Original restriction details can be retrieved by their recorded identifiers.`,
    packet.decisions.length ? `Relevant decisions:\n${packet.decisions.map((decision) => `${decision.fact}: ${decision.answer}`).join("\n")}` : "",
    packet.contracts.length ? `Integration contracts:\n${JSON.stringify(packet.contracts)}` : "",
    packet.environment.length ? `Prepared technical requirements:\n${packet.environment.map((node) => `${node.id}: ${node.name} (${node.kind}); ${node.reason}${node.identity ? `; capability/provider=${JSON.stringify(node.identity)}` : ""}${node.provides?.command ? `; invocation=${JSON.stringify(node.provides.command)}` : ""}`).join("\n")}` : "",
    packet.task.files.length ? `Relevant paths: ${packet.task.files.join(", ")}` : "",
    packet.task.inputs?.length ? `Read dependencies: ${packet.task.inputs.join(", ")}` : "",
    packet.task.resources?.length ? `Exclusive resources: ${packet.task.resources.join(", ")}` : "",
    packet.references?.length ? `Selected reference files for this unit (read relevant details at the recorded paths; these are supporting material, not additional required outcomes):\n${JSON.stringify(packet.references)}` : "",
    packet.task.checks.length ? `Focused verification recipes:\n${JSON.stringify(packet.task.checks)}` : "",
  ].filter(Boolean).join("\n\n");
}

export function contextForTask(brief: ProductBrief, plan: DevelopmentPlan, task: WorkUnit, limitChars = 24_000): ContextPacket {
  const requirements = brief.requirements.filter((requirement) => task.requirementIds.includes(requirement.id));
  const words = new Set(`${task.title} ${task.goal} ${requirements.map((requirement) => requirement.statement).join(" ")}`.toLowerCase().split(/\W+/).filter((word) => word.length > 3));
  const decisions = brief.decisions.filter((decision) => task.blockedBy.includes(decision.questionId) || `${decision.fact} ${decision.answer}`.toLowerCase().split(/\W+/).some((word) => words.has(word)));
  const relevance = (text: string): number => text.toLowerCase().split(/\W+/).filter((word) => words.has(word)).length;
  const constraints = [...brief.constraints].sort((left, right) => relevance(right.statement) - relevance(left.statement));
  const selectedConstraints: ContextPacket["constraints"] = [];
  let restrictionRoom = Math.max(600, Math.floor(limitChars / 5));
  for (const constraint of constraints) {
    const statement = constraint.statement.slice(0, 900);
    const cost = statement.length + 180;
    if (cost > restrictionRoom) continue;
    selectedConstraints.push({ ...constraint, statement });
    restrictionRoom -= cost;
  }
  const ids = new Set(task.environmentIds);
  for (;;) {
    const before = ids.size;
    for (const node of plan.environment) if (ids.has(node.id)) node.dependsOn.forEach((id) => ids.add(id));
    if (ids.size === before) break;
  }
  const packet: ContextPacket = {
    task,
    project: { name: brief.name, modes: brief.modes, targets: brief.targets },
    requirements,
    constraints: selectedConstraints,
    decisions: decisions.filter((decision) => !requirements.some((requirement) => requirement.source.kind === "answer" && requirement.source.reference === decision.questionId)).map((decision) => ({ ...decision, answer: decision.answer.slice(0, 1_200) })),
    contracts: plan.contracts.filter((contract) => task.contractIds.includes(contract.id)),
    environment: plan.environment.filter((node) => ids.has(node.id)),
    capabilityLimits: { forbidden: [...new Set(brief.constraints.flatMap((constraint) => constraint.forbiddenCapabilities))], required: [...new Set(brief.constraints.flatMap((constraint) => constraint.requiredCapabilities))] },
  };
  const size = packetText(packet).length;
  if (size > limitChars) throw new ContextTooLarge(task.id, size, limitChars);
  const referenceText = [task.title, task.goal, task.instructions, ...task.files, ...task.criteria, ...requirements.map(requirement => requirement.statement)].join(" ");
  packet.references = boundedReferences(relevantReferences(brief, referenceText, requirements.map(requirement => requirement.source.reference)), Math.min(1_800, Math.floor(limitChars / 5), limitChars - size - 200));
  return packet;
}

/** Stable topological order for consumers; unresolved dependencies remain explicit. */
export function ordered<T extends { id: string; dependsOn: string[] }>(nodes: T[]): { ready: T[]; unresolved: T[] } {
  const remaining = new Map(nodes.map((node) => [node.id, node]));
  const done = new Set<string>();
  const ready: T[] = [];
  for (;;) {
    const next = [...remaining.values()].filter((node) => node.dependsOn.every((id) => done.has(id)));
    if (next.length === 0) break;
    for (const node of next) { ready.push(node); done.add(node.id); remaining.delete(node.id); }
  }
  return { ready, unresolved: [...remaining.values()] };
}
