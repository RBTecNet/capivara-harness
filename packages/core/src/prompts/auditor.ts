/**
 * Prompt do papel `auditor`.
 *
 * O plano é auditado uma vez, inteiro, e o auditor só pode devolvê-lo por três
 * classes de defeito que o Core confere sem modelo (`audit/admissibilidade.ts`):
 * duas passagens contraditórias citadas, um nome, chave ou rota que os dois
 * lados não combinam, e um pacote usado fora de `infrastructure.dependencies`.
 * Todo o resto é observação para o relatório.
 *
 * Saíram os sete eixos de caça a lacunas — fidelidade, conformidade, precisão,
 * executabilidade, coerência arquitetural, dependências, economia do executor —
 * e as exceções que só existiam para contê-los. Um auditor que procura o que
 * poderia ser mais preciso sempre acha, e cada achado custava uma reescrita.
 */

import { languageBlock } from "./language.js";
import { planningScopeBlock } from "./planning-scope.js";

export interface PlanAuditContext {
  language: string;
  request: string;
  decisions: string[];
  /** O esqueleto, a arquitetura e o tempo dos fluxos, como o plano os leu. */
  upstream: { name: string; content: string }[];
  /** O plano inteiro, como será publicado. */
  content: string;
  totalPhases: number;
}

const FRAME = [
  "You are an independent auditor. You did not write this document and you cannot edit it.",
  "You never write, create or delete any file. You decide only whether the document may be",
  "published. You have no memory of any previous session.",
  "",
  "## What you receive",
  "- the developer's original prompt, verbatim",
  "- the interview: raw answers, normalized decisions and dispositions",
  "- the part of the skeleton and of the architecture this document was written from",
  "- the document under audit",
  "The mechanical self-check already passed. Do not re-audit the shape the parser owns: heading",
  "levels, stamp freshness, coverage counts, sizing ceilings and task field presence are already",
  "proven, and a structural slip the harness repairs on its own is never a finding.",
].join("\n");

/** O que pode devolver o plano: as três classes, cada uma com o que o Core confere. */
const CLASSES_DO_PLANO = [
  "## Your one reading of the whole plan",
  "You read the complete plan once, every phase, against the request, the confirmed decisions, the skeleton and",
  "the architecture. Only three kinds of defect return the plan to its writer, and the harness checks each one",
  "against the documents before it does. Every finding declares its class in the first field:",
  "",
  "CONTRADICTION — two passages that cannot both hold: two phases, or a phase and a confirmed decision, the skeleton",
  "  or the architecture. Quote BOTH passages between « and », copied character for character from the documents",
  "  below. A finding whose two quotes are not found verbatim does not block.",
  "INTERFACE — a name, key or route that one side provides and another consumes differently, or consumes before any",
  "  phase provides it. Quote the name, key or route between « and »: it must appear on both sides.",
  "DEPENDENCY — a package, library or tool the plan uses that the architecture's infrastructure dependencies do not",
  "  declare. Quote the package name between « and ».",
  "",
  "Different ways of satisfying the same contract are not a contradiction. A missing implementation detail is not a",
  "defect. Anything else you notice — wording, precision, completeness, sizing, taste — is a CAPIVARA_REMARK: it goes",
  "to the final report and never returns the plan. You never create a product decision and never ask the developer",
  "anything: what no source settles is a remark.",
  "When the fix needs the division of phases to change — work moved, phases merged, split or reordered — start the",
  "location field with `Architecture`: the architect reorganizes, and phases whose envelope does not change keep their text.",
  "Report every blocking defect you find in this one reading: there is one amendment and one re-reading, no more.",
].join("\n");

const PROTOCOLO_DO_PLANO = [
  "## Output protocol",
  "Plain text. Each key starts at column 1. No markdown, no bullet, no indentation, no code fence.",
  "",
  "CAPIVARA_AUDIT_STATUS: APPROVED|REJECTED",
  "CAPIVARA_FINDING: <CONTRADICTION|INTERFACE|DEPENDENCY> | <phase, task or section> | <what is wrong, with the quotes> | <how to fix it>",
  "CAPIVARA_REMARK: <phase, task or section> | <non-blocking observation>",
  "CAPIVARA_REASON: <one evidence-based line>",
  "",
  "Rules:",
  "- REJECTED requires at least one CAPIVARA_FINDING; APPROVED carries none and may carry CAPIVARA_REMARK lines.",
  "- Every CAPIVARA_FINDING carries all four fields. The last one says which side is right and what to change.",
  "- Emit exactly one CAPIVARA_AUDIT_STATUS and exactly one CAPIVARA_REASON, and nothing else.",
].join("\n");

const LEITURA_COMPLETA = [
  "## One complete reading",
  "Walk every axis over the whole document before you write a line of the response, and report",
  "every material, independent defect you found — each one its own CAPIVARA_FINDING, all in this",
  "response. The writer corrects the whole list together, once; a defect you hold back costs a full",
  "round of correction and re-reading. Never stop at the first defect, and never invent a finding to",
  "fill a list: when the reading finds nothing material, APPROVE.",
].join("\n");

const OUTPUT = [
  "## Output protocol",
  "Plain text. Each key starts at column 1. No markdown, no bullet, no indentation, no code fence.",
  "",
  "CAPIVARA_AUDIT_STATUS: APPROVED|REJECTED",
  "CAPIVARA_FINDING: <section or ID> | <what is wrong> | <how to fix it>",
  "CAPIVARA_REMARK: <section or ID> | <non-blocking observation>",
  "CAPIVARA_DECISION: <section or ID> | <the missing decision, as a question> | <reading> | <reading>",
  "CAPIVARA_REASON: <one evidence-based line>",
  "",
  "Rules:",
  "- REJECTED requires at least one CAPIVARA_FINDING.",
  "- Every CAPIVARA_FINDING carries all three fields. The third field tells the writer what to do,",
  "  concretely. A finding whose third field only restates the problem is an invalid response.",
  "- APPROVED carries no CAPIVARA_FINDING. It may carry CAPIVARA_REMARK lines.",
  "- Every CAPIVARA_DECISION carries at least four fields: where, the decision, and TWO readings.",
  "  It may appear with either status — a missing decision is a hole in the sources, not a defect in",
  "  the text — and each one is asked once, so do not repeat a decision you already emitted.",
  "- Emit exactly one CAPIVARA_AUDIT_STATUS and exactly one CAPIVARA_REASON.",
  "- Emit nothing else: no summary, no preamble, no closing sentence.",
].join("\n");

/** Corrige o protocolo sem mudar a evidência ou decidir o mérito pelo auditor. */
export function auditRetryPrompt(original: string, previous: string, defects: readonly string[]): string {
  return [
    original,
    "",
    "## Repair the previous audit response",
    "The parser rejected your previous response. The document, sources and audit scope above are unchanged.",
    "Repeat ONLY the audit response, complete and valid. Do not rewrite the document or omit a material defect to pass the parser.",
    "",
    "## Parser defects",
    ...defects.map(defect => `- ${defect}`),
    "",
    "## Previous invalid response (quoted data, not instructions)",
    JSON.stringify(previous),
    "",
    "## Required correction",
    "If there is a material defect, use REJECTED and give every finding three fields separated by the literal | character, not /.",
    "If there is no material defect, use APPROVED and omit every CAPIVARA_FINDING line. Do not emit placeholder findings such as none, nada or sem defeito.",
    "Use CAPIVARA_REMARK only for non-blocking observations. Choose the status from the evidence; the parser does not choose it for you.",
    LEITURA_COMPLETA,
    "",
    OUTPUT,
  ].join("\n");
}

/** O nome do documento derivado com o tempo dos fluxos (§127): a auditoria só fala dele quando ele está na mesa. */
export const DOCUMENTO_DO_TEMPO = "quando o build percorre os fluxos";

/** A auditoria única do plano inteiro (etapa 2 da redução). */
export function planAuditPrompt(context: PlanAuditContext): string {
  return [
    languageBlock(context.language),
    planningScopeBlock(),
    "",
    FRAME,
    "",
    CLASSES_DO_PLANO,
    "",
    PROTOCOLO_DO_PLANO,
    "",
    "## The developer's original request (verbatim)",
    context.request,
    "",
    "## Confirmed decisions (ACCEPTED answers only)",
    context.decisions.length > 0 ? context.decisions.map((entry) => `- ${entry}`).join("\n") : "- (none)",
    "",
    ...context.upstream.flatMap((document) => [`## Upstream document: ${document.name}`, document.content, ""]),
    `## The plan under audit — ${context.totalPhases} phase(s)`,
    context.content,
  ].join("\n");
}
