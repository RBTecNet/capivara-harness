/**
 * A regra de idioma, prefixada em TODOS os prompts de TODOS os papéis.
 *
 * O corte não é entre "prompt" e "resposta": é entre máquina e humano. As
 * perguntas da entrevista são saída do modelo — a TUI apenas as apresenta —,
 * então elas caem no idioma do usuário, junto com a prosa dos documentos, os
 * findings e as mensagens de erro. Em inglês ficam só as instruções internas e
 * as chaves que o parser casa literalmente.
 */

import { STAMP_MARKER, STRUCTURAL_LABELS } from "../contract/templates.js";

export const PROTOCOL_KEYS: readonly string[] = [
  "CAPIVARA_AUDIT_STATUS",
  "CAPIVARA_FINDING",
  "CAPIVARA_REMARK",
  "CAPIVARA_REASON",
  "CAPIVARA_ANSWER",
  "CAPIVARA_BUILDER_STATUS",
  "TASK <n>: DONE",
  "TASK <n>: INCOMPLETE",
];

export function languageBlock(language: string): string {
  return [
    "## Language",
    `Every word the developer will read must be written in ${language}: interview questions,`,
    "their options, recommendations and consequences, all document prose, phase titles, acceptance",
    "criteria, findings, remarks, reasons and error messages.",
    "",
    "Keep these in English, byte for byte, and never translate them:",
    `protocol keys (${PROTOCOL_KEYS.join(", ")}), structural labels (${STRUCTURAL_LABELS.join(", ")}),`,
    `identifiers (US-N.M), and the ${STAMP_MARKER} stamp.`,
    "",
    "A translated protocol key or structural label is an invalid response.",
  ].join("\n");
}
