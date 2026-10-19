import { affectedPhases } from "../contract/index.js";
import type { PhaseBlock } from "../contract/index.js";
import type { AuditVerdict } from "./protocol.js";

export interface MaterialityInput {
  items: { id: string; kind: "finding" | "decision"; where: string; claim: string; proposed: string[] }[];
  sources: { id: string; content: string }[];
}

export function materialityInput(verdict: AuditVerdict, context: {
  request: string; decisions: readonly string[]; phases: readonly PhaseBlock[]; skeleton?: string;
}): MaterialityInput {
  const items: MaterialityInput["items"] = [
    ...verdict.findings.map((finding, index) => ({ id: `F${index + 1}`, kind: "finding" as const,
      where: finding.where, claim: finding.problem, proposed: [finding.fix] })),
    ...(verdict.decisions ?? []).map((decision, index) => ({ id: `D${index + 1}`, kind: "decision" as const,
      where: decision.where, claim: decision.decision, proposed: decision.options })),
  ];
  const related = new Set<number>();
  for (const finding of verdict.findings) for (const number of affectedPhases([finding], context.phases.length)) related.add(number);
  for (const decision of verdict.decisions ?? []) {
    for (const number of affectedPhases([{ where: decision.where, problem: "", fix: "" }], context.phases.length)) related.add(number);
  }
  return {
    items,
    sources: [
      { id: "request", content: context.request },
      { id: "decisions", content: context.decisions.join("\n") },
      ...(context.skeleton ? [{ id: "skeleton", content: context.skeleton }] : []),
      ...context.phases.filter(phase => related.has(phase.number)).map(phase => ({ id: `P${phase.number}`, content: phase.markdown })),
    ],
  };
}

export const MATERIALITY_INPUT_MARKER = "## Review input (JSON)\n";

export function materialityPrompt(input: MaterialityInput): string {
  return [
    "You independently review proposed blockers of an execution PLAN. You do not write the plan or the product.",
    "The previous auditor is fallible. Its claims and proposed fixes are NOT authority; only sources are.",
    "Review every item once. Do not create new requirements, findings, decisions or tests.",
    "KEEP real missing requested behavior, incompatible obligations in the same operation, entity, scenario and moment,",
    "unauthorized product scope, and a material business decision the sources genuinely cannot settle.",
    "A contradiction requires disjoint obligations: if any valid implementation satisfies both, use ADVISORY.",
    "Compare allowed sets, not preferred choices: 204 is compatible with '200 or 204', even across modules.",
    "Validation before POST and showing errors after GET are different operations and may coexist.",
    "An empty database fixture and persistence in another test scenario may coexist; do not assume tests share state or ordering.",
    "A foundation page/component and its later extension or replacement are a sequence, not simultaneous alternatives.",
    "Do not demand an extra test for every sentence or an exact constructor/signature/setup technique when compatible implementations exist.",
    "A task description is evidence too; acceptance criteria need not duplicate every descriptive sentence.",
    "Unspecified implementation details with a compatible choice (sidebar initial mode, function vs class, test organization)",
    "are ADVISORY, not business decisions for the developer. Do not reopen a choice already settled by sources.",
    "Never dismiss required behavior or choose an unresolved business policy on the developer's behalf.",
    "",
    "Return only JSON: {\"reviews\":[{\"id\":\"F1\",\"disposition\":\"KEEP\"|\"ADVISORY\",\"reason\":\"em português\",",
    "\"evidence\":[{\"source\":\"P1\",\"quote\":\"exact source quotation\"}]}]}.",
    "Include exactly one review per input id, in order. No extra ids. KEEP needs no evidence.",
    "ADVISORY requires a concrete reason and at least one exact quotation of 12+ characters from a source,",
    "sufficient to explain the compatible implementation or why the claimed obligation is not required.",
    "The harness checks quotations. Invented, truncated or inaccurate source text cannot remove a blocker.",
    "No tools, commands, files or browser. Decide from these supplied sources only.",
    "",
    MATERIALITY_INPUT_MARKER + JSON.stringify(input),
  ].join("\n");
}

const normalized = (text: string): string => text.replace(/\s+/g, " ").trim();
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Ausência ou prova inválida conserva o bloqueio original; nunca aprova por omissão. */
export function applyMaterialityReview(original: AuditVerdict, input: MaterialityInput, output: string): {
  verdict: AuditVerdict; defects: string[]; advisory: number;
} {
  const invalid = (problem: string) => ({ verdict: original, defects: [problem], advisory: 0 });
  let parsed: unknown;
  try { parsed = JSON.parse(output.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
  catch { return invalid("a triagem não devolveu JSON válido"); }
  if (!record(parsed) || !Array.isArray(parsed.reviews) || parsed.reviews.length !== input.items.length) return invalid("a triagem não julgou todos os itens");
  const sources = new Map(input.sources.map(source => [source.id, normalized(source.content)]));
  const advisory = new Map<string, string>();
  const seen = new Set<string>();
  const defects: string[] = [];
  for (const raw of parsed.reviews) {
    if (!record(raw) || typeof raw.id !== "string" || seen.has(raw.id) || !input.items.some(item => item.id === raw.id)) return invalid("ID desconhecido ou repetido na triagem");
    seen.add(raw.id);
    if (raw.disposition === "KEEP") continue;
    if (raw.disposition !== "ADVISORY" || typeof raw.reason !== "string" || raw.reason.trim().length === 0 || !Array.isArray(raw.evidence) || raw.evidence.length === 0) {
      defects.push(`${raw.id}: triagem sem decisão ou evidência fundamentada`);
      continue;
    }
    const quotes: string[] = [];
    for (const evidence of raw.evidence) {
      if (!record(evidence) || typeof evidence.source !== "string" || typeof evidence.quote !== "string"
        || normalized(evidence.quote).length < 12 || !sources.get(evidence.source)?.includes(normalized(evidence.quote))) {
        defects.push(`${raw.id}: a citação da triagem não existe na fonte indicada`);
        break;
      }
      quotes.push(`${evidence.source}: ${evidence.quote}`);
    }
    if (quotes.length === raw.evidence.length) advisory.set(raw.id, `${raw.reason.trim()} Evidência: ${quotes.join("; ")}`);
  }
  if (advisory.size === 0) return { verdict: original, defects, advisory: 0 };
  const findings = original.findings.filter((_finding, index) => !advisory.has(`F${index + 1}`));
  const decisions = (original.decisions ?? []).filter((_decision, index) => !advisory.has(`D${index + 1}`));
  return {
    verdict: {
      ...original, status: findings.length ? "REJECTED" : "APPROVED", findings, decisions,
      remarks: [...original.remarks, ...input.items.flatMap(item => {
        const reason = advisory.get(item.id);
        return reason ? [{ where: item.where, observation: `${item.claim} (triagem de materialidade: ${reason})` }] : [];
      })],
      reason: findings.length ? original.reason : "nenhum bloqueio material permanece após a triagem fundamentada",
    },
    defects, advisory: advisory.size,
  };
}
