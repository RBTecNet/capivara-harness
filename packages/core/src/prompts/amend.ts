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

export interface AmendContext {
  language: string;
  /** O texto exato que precisa voltar, com as correções aplicadas. */
  current: string;
  findings: { where: string; problem: string; fix: string }[];
  /** O que a tentativa anterior mudou sem ter sido pedido, quando houve. */
  drift?: string[];
}

export function amendPhasePrompt(context: AmendContext): string {
  return [
    languageBlock(context.language),
    "",
    "You are amending a phase of an execution plan. You are not writing one.",
    "",
    "## What you must return",
    "The phase below, complete, with the corrections applied and NOTHING else changed.",
    "",
    "Every task the findings do not name comes back byte-identical: same title, same criteria, same",
    "feature tests, same traces, same order. Do not renumber. Do not merge tasks. Do not add tasks.",
    "Do not reword what is already correct. Do not improve anything you were not asked to improve.",
    "",
    "This is checked mechanically after you answer. A task that changed without a finding naming it",
    "sends this back to you.",
    "",
    "## Why it matters",
    "The auditor reads the result again. If the phase comes back rewritten instead of amended, it",
    "reads a different document, finds different defects, and the cycle never closes — the plan gets",
    "returned forever while the same points stay open.",
    "",
    "## What the audit found",
    ...context.findings.map((finding) => `- ${finding.where}: ${finding.problem}\n  what to do: ${finding.fix}`),
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
