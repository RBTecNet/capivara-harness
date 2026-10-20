import { STRUCTURAL_LABELS, affectedPhases, phaseReferences } from "../contract/index.js";
import type { PhaseBlock } from "../contract/index.js";
import type { AuditVerdict } from "./protocol.js";

export interface MaterialityInput {
  items: { id: string; kind: "finding" | "decision"; where: string; claim: string; proposed: string[]; phase?: number }[];
  sources: { id: string; content: string }[];
}

export function materialityInput(verdict: AuditVerdict, context: {
  request: string; decisions: readonly string[]; phases: readonly PhaseBlock[]; skeleton?: string;
}): MaterialityInput {
  const items: MaterialityInput["items"] = [
    ...verdict.findings.map((finding, index) => ({ id: `F${index + 1}`, kind: "finding" as const,
      where: finding.where, claim: finding.problem, proposed: [finding.fix], ...(finding.phase === undefined ? {} : { phase: finding.phase }) })),
    ...(verdict.decisions ?? []).map((decision, index) => ({ id: `D${index + 1}`, kind: "decision" as const,
      where: decision.where, claim: decision.decision, proposed: decision.options })),
  ];
  const related = new Set<number>();
  /*
   * A fase do achado E as que o endereço cita (§124). `affectedPhases` para na
   * fase declarada por quem chamou — certo para a emenda, que vai a uma fase
   * só; errado para a triagem, que precisa ver os dois lados de "T1.C1 vs
   * P1.T1.C1" para poder dizer que não há conflito. No `haiku` os auditores
   * por fase também apontaram a escrita concorrente em `modulos.ts`, e a
   * fundação acusada nunca chegava à mesa.
   */
  for (const finding of verdict.findings) {
    for (const number of affectedPhases([finding], context.phases.length)) related.add(number);
    for (const number of phaseReferences(finding.where)) if (number >= 1 && number <= context.phases.length) related.add(number);
  }
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
    "KEEP also when the documents, AS WRITTEN, order or permit incompatible behaviour even though a careful implementer",
    "could avoid it: a task told to add or register an entry a dependency phase already delivers; two phases with no",
    "order between them told to edit the same file; an undefined owner of a shared file; a replacement between phases",
    "that no task orders. A possible implementation is not a correction. The executor follows the text literally, so",
    "the text must change — that is a localized documentary fix, and it is KEEP, never ADVISORY.",
    "ADVISORY is for a false positive only: the accused passage does not say what the finding claims, or an explicit",
    "contract in the documents already settles it. Quote THAT passage. Never dismiss on an interpretation the documents",
    "do not state, and never on the architecture's intention alone when the phase text contradicts it.",
    "A finding that names two or more phases is a contradiction between them: to dismiss it, quote each of those phases.",
    "The harness refuses an ADVISORY that quotes only one side or only the skeleton/architecture.",
    "Compare allowed sets, not preferred choices: 204 is compatible with '200 or 204', even across modules.",
    "Validation before POST and showing errors after GET are different operations and may coexist.",
    "An empty database fixture and persistence in another test scenario may coexist; do not assume tests share state or ordering.",
    "A foundation page/component and its later extension or replacement are a sequence, not simultaneous alternatives,",
    "when the later phase's task says it replaces or edits it and the later phase depends on the earlier one; a",
    "replacement nobody orders is not a sequence.",
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

/** Um trecho que é só rótulo estrutural não prova nada: o rótulo dos critérios existe em toda fase. */
function citacaoSubstantiva(quote: string): boolean {
  let texto = normalized(quote);
  for (const label of STRUCTURAL_LABELS) texto = texto.split(label).join(" ");
  return normalized(texto.replace(/^[-*\s]+/u, "")).length >= 12;
}

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
        || !citacaoSubstantiva(evidence.quote) || !sources.get(evidence.source)?.includes(normalized(evidence.quote))) {
        defects.push(`${raw.id}: a citação da triagem não existe na fonte indicada`);
        break;
      }
      quotes.push(`${evidence.source}: ${evidence.quote}`);
    }
    if (quotes.length !== raw.evidence.length) continue;
    /*
     * Um conflito entre fases só é falso positivo com o texto das duas na mesa (§124).
     *
     * No `haiku` a triagem descartou, três rodadas seguidas, "P1.T6.C1 vs
     * P3.T4.C1, P4.T5.C1, P5.T4.C1 e P6.T2.C1" citando a fundação e a frase
     * de intenção da arquitetura — nunca as tasks acusadas, que mandavam
     * acrescentar o que a fundação já entregava. Uma solução possível não é
     * uma correção realizada: para dizer que a fase acusada não ordena o que
     * o achado afirma, é preciso citá-la. Sem a citação de cada fase citada
     * no endereço, o parecer não remove o bloqueio.
     */
    const item = input.items.find((candidate) => candidate.id === raw.id);
    if (item?.kind === "finding") {
      const citadas = [...new Set([...(item.phase === undefined ? [] : [item.phase]), ...phaseReferences(item.where)])]
        .filter((numero) => sources.has(`P${numero}`))
        .sort((left, right) => left - right);
      if (citadas.length >= 2) {
        const citadasNaEvidencia = new Set((raw.evidence as { source: string }[]).map((evidence) => evidence.source));
        const faltam = citadas.filter((numero) => !citadasNaEvidencia.has(`P${numero}`));
        if (faltam.length > 0) {
          defects.push(`${raw.id}: a triagem descartou um conflito entre as fases ${citadas.join(", ")} sem citar o texto da(s) fase(s) ${faltam.join(", ")}`);
          continue;
        }
      }
    }
    advisory.set(raw.id, `${raw.reason.trim()} Evidência: ${quotes.join("; ")}`);
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
