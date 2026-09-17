/**
 * O ciclo de devolução.
 *
 * O auditor descreve o defeito e a correção; quem aplica é o escritor, em sessão
 * nova. Se o auditor corrigisse, seria escritor e auditor ao mesmo tempo e a
 * independência do veredito acabaria.
 *
 * Esgotado o teto, o run NÃO desiste em silêncio nem aceita o documento: ele
 * para e mostra ao desenvolvedor, lado a lado, o que o auditor rejeita e o que o
 * escritor insiste em fazer. Na prática isso é quase sempre um gap de entrevista
 * disfarçado de desacordo, e uma resposta humana resolve.
 */

import type { AuditVerdict, Finding } from "./protocol.js";

export const DEFAULT_MAX_RETURNS = 3;

export interface AuditAttempt {
  /** 1 para a primeira auditoria do documento. */
  attempt: number;
  verdict: AuditVerdict;
  /** Resumo do que o escritor fez nesta tentativa, para a comparação final. */
  writerSummary: string;
}

export interface AuditCycleState {
  document: string;
  history: AuditAttempt[];
  maxReturns: number;
}

export type AuditAction =
  | { action: "publish"; remarks: AuditVerdict["remarks"] }
  | { action: "return-to-writer"; findings: Finding[]; attempt: number }
  | { action: "ask-developer"; standoff: Standoff };

export interface Standoff {
  document: string;
  returns: number;
  /** O que o auditor continua rejeitando, sem duplicatas. */
  auditorInsists: Finding[];
  /** O que o escritor fez a cada tentativa. */
  writerDid: string[];
  question: string;
}

function fingerprint(finding: Finding): string {
  return `${finding.where}::${finding.problem}`.toLowerCase();
}

/** Findings que sobreviveram a todas as devoluções, sem repetir o equivalente. */
export function persistentFindings(history: readonly AuditAttempt[]): Finding[] {
  const seen = new Map<string, Finding>();
  for (const attempt of history) {
    for (const finding of attempt.verdict.findings) seen.set(fingerprint(finding), finding);
  }
  return [...seen.values()];
}

export function nextAuditAction(state: AuditCycleState): AuditAction {
  const last = state.history.at(-1);
  if (!last) throw new Error("o ciclo de auditoria precisa de ao menos uma auditoria realizada");

  if (last.verdict.status === "APPROVED") {
    return { action: "publish", remarks: last.verdict.remarks };
  }

  const returns = state.history.filter((attempt) => attempt.verdict.status === "REJECTED").length;
  if (returns < state.maxReturns) {
    return { action: "return-to-writer", findings: last.verdict.findings, attempt: last.attempt + 1 };
  }

  return {
    action: "ask-developer",
    standoff: {
      document: state.document,
      returns,
      auditorInsists: persistentFindings(state.history),
      writerDid: state.history.map((attempt) => attempt.writerSummary),
      question:
        `O auditor devolveu ${state.document} ${returns} vezes e o escritor não fechou o ponto. ` +
        "Isso costuma ser um gap de entrevista disfarçado de desacordo. O que vale?",
    },
  };
}

export function renderStandoff(standoff: Standoff): string {
  const lines: string[] = [
    `Impasse em ${standoff.document} após ${standoff.returns} devoluções.`,
    "",
    "O auditor insiste em:",
  ];
  for (const finding of standoff.auditorInsists) {
    lines.push(`  · ${finding.where}: ${finding.problem}`);
    lines.push(`    correção pedida: ${finding.fix}`);
  }
  lines.push("", "O escritor fez:");
  standoff.writerDid.forEach((summary, index) => lines.push(`  ${index + 1}. ${summary}`));
  lines.push("", standoff.question);
  return lines.join("\n");
}
