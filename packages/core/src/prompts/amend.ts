/**
 * Emenda de uma fase, em oposição a reescrevê-la.
 *
 * A devolução de auditoria usava o MESMO prompt de escrita, acrescido da lista
 * de findings. O resultado era previsível em retrospecto: o modelo lia "escreva
 * uma fase" e escrevia uma fase nova. Medido ao vivo no piloto 3 — o finding
 * dizia "16 tasks é demais" e a resposta voltou com 13 tasks e 64 critérios,
 * números que ninguém pediu.
 *
 * É a explicação do que parecia teimosia do auditor: a cada volta ele recebia um
 * documento diferente, com superfície nova para morder, e por isso achava defeito
 * novo indefinidamente. Não havia convergência possível, porque não havia
 * estabilidade.
 *
 * Aqui o pedido é outro: devolva ESTE texto com as correções aplicadas. O que
 * nenhum finding citou volta idêntico — e isso é conferido em código, não pedido
 * por favor.
 */

import { languageBlock } from "./language.js";
import { planningScopeBlock } from "./planning-scope.js";
import { MAX_CRITERIA_PER_TASK, MAX_TASKS_PER_PHASE } from "../authoring/ledger.js";

export interface AmendContext {
  language: string;
  /** O texto exato que precisa voltar, com as correções aplicadas. */
  current: string;
  findings: { where: string; problem: string; fix: string }[];
  /** O pedido do desenvolvedor, verbatim. Ausente mantém o comportamento antigo. */
  request?: string;
  /** Autoridade atual, inclusive respostas obtidas durante auditoria e ensaio. */
  decisions?: string[];
  slice?: string;
  /** A fatia da arquitetura desta fase: componentes, contratos e infraestrutura. */
  architecture?: string;
  phaseNumber?: number;
  grammar?: string;
  /** O que a tentativa anterior mudou sem ter sido pedido, quando houve. */
  drift?: string[];
  relatedPhases?: readonly string[];
}

export function amendPhasePrompt(context: AmendContext): string {
  return [
    languageBlock(context.language),
    planningScopeBlock(),
    "",
    "You are amending a phase of an execution plan. You are not writing one.",
    ...(context.request
      ? [
          "",
          /*
           * A emenda tem a mesma assimetria que a escrita tinha: ela fecha achados
           * que citam o pedido — "o campo não tem as quatro linhas exigidas no
           * pedido" — sem nunca ter visto o pedido. Fechar isso às cegas é
           * adivinhar qual era a exigência.
           */
          "## The developer's original request (verbatim)",
          "",
          "Authority above everything. The findings below often cite a demand from it — a field's size,",
          "an exact list of values, what a screen shows. Read it to close the finding with what the",
          "request actually says, instead of guessing. You still change ONLY what the findings name.",
          "",
          context.request,
        ]
      : []),
    "",
    ...(context.decisions ? [
      "## Confirmed decisions",
      "These are ACCEPTED answers, including decisions made after the skeleton. Where a decision",
      "and the slice disagree, the confirmed decision wins. Do not reopen or undo it.",
      ...context.decisions.map(decision => `- ${decision}`),
      "",
    ] : []),
    ...(context.slice ? ["## This phase's slice", context.slice, ""] : []),
    ...(context.architecture
      ? [
          "## This phase's architecture slice",
          "The components, contracts and infrastructure this phase implements or consumes. A correction",
          "that contradicts a contract here is wrong even when it closes the finding.",
          context.architecture,
          "",
        ]
      : []),
    ...(context.relatedPhases?.length ? [
      "## Related phases (read-only)",
      "These are the CURRENT contracts named by the findings. Reuse their exports, paths and types.",
      "They are references, not output: return only the phase being amended. Keep its other tasks unchanged.",
      ...context.relatedPhases,
      "",
    ] : []),
    ...(context.grammar ? [
      "## Task grammar and limits",
      `You are correcting phase ${context.phaseNumber}. Return only its tasks; the harness owns its envelope.`,
      `At most ${MAX_TASKS_PER_PHASE} tasks in this phase and ${MAX_CRITERIA_PER_TASK} criteria per task.`,
      "Keep the structural labels byte-exact. Do not introduce an extra level of sub-phase numbering.",
      "The following is a grammar example, not an extra task to include:",
      context.grammar,
      "",
    ] : []),
    "## What you must return",
    "The phase below, complete, with the corrections applied and NOTHING else changed.",
    "",
    "Every task the findings do not name comes back byte-identical: same title, same criteria, same",
    "traces, same order. Do not reword what is already correct. Do not improve",
    "anything you were not asked to improve, and never add, drop, merge or renumber tasks on your",
    "own initiative.",
    "",
    "When a finding asks for a task to be SPLIT, splitting it IS the correction: write the tasks it",
    "becomes, keeping every verifiable condition, and leave the rest of the phase untouched. Same for",
    "a finding that asks for tasks to be merged. The rule above protects what the findings do not",
    "name — it never forbids the very change a finding asks for.",
    "",
    "This is checked mechanically after you answer. A task that changed without a finding naming it",
    "sends this back to you.",
    "",
    "## Why it matters",
    "The auditor reads the result again. If the phase comes back rewritten instead of amended, it",
    "reads a different document, finds different defects, and the cycle never closes — the plan gets",
    "returned forever while the same points stay open.",
    "",
    "## Nobody reads a message you write here",
    "What you return REPLACES the phase in the document. It is not read by a person: it is parsed,",
    "audited and executed. A question addressed to the developer, a list of options, an explanation",
    "of what you would need — none of that reaches anyone, and the phase it replaced is gone.",
    "",
    "When a finding cannot be closed because nobody ever decided something, say so IN THE TASK:",
    "",
    "  [NEEDS DECISION] <the open decision, in one line>",
    "",
    "on its own line inside the task it belongs to, keeping every other task exactly as it is. That",
    "line does reach the developer, before anything is published, and comes back answered. It is the",
    "one way out that works — and dropping the tasks is never one, whatever the reason.",
    "",
    "## What the audit found",
    ...context.findings.map((finding) => `- ${finding.where}: ${finding.problem}\n  what to do: ${finding.fix}`),
    "Read the whole list before changing anything, then apply ALL of it in this one answer: where two",
    "findings touch the same task, correct it once so the result satisfies both.",
    ...(context.drift && context.drift.length > 0
      ? [
          "",
          "## Your previous attempt changed what nobody asked for",
          ...context.drift.map((entry) => `- ${entry}`),
          "Apply the corrections again, and this time leave everything else exactly as it is.",
        ]
      : []),
    "",
    "## Output",
    "Emit the raw bytes of the amended phase and nothing else. No preamble, no explanation, no",
    "markdown fence wrapping it, no summary of what you changed.",
    "",
    "## The phase to amend",
    context.current,
  ].join("\n");
}
