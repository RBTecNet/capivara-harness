/**
 * O reparo pelo auditor (§121).
 *
 * A separação entre quem escreve e quem audita protege o VEREDITO, não proíbe
 * que o papel auditor execute um reparo quando o escritor demonstrou que não
 * fecha o ponto. O que não pode acontecer é o reparador aprovar o que reparou:
 * a validação de um reparo é de outro papel, em outra sessão.
 *
 * Este bloco vai ANEXADO ao prompt que o escritor recebia — o mesmo documento,
 * as mesmas fontes, os mesmos limites —, para que o reparador produza o mesmo
 * tipo de saída, e não uma opinião sobre ela.
 */
export interface RepairContext {
  /** O documento ou parte em reparo, como o log o chama. */
  document: string;
  /** Os achados materiais pendentes, já consolidados. */
  findings: readonly { where: string; problem: string; fix: string }[];
  /** O histórico compacto das tentativas que não fecharam. */
  history: readonly string[];
  /** O que o reparador não pode mudar. */
  limits?: readonly string[];
}

export function repairBlock(context: RepairContext): string {
  return [
    "## You are repairing, not auditing",
    `The writer did not close the findings below on ${context.document} and the harness handed the repair`,
    "to you. Produce the CORRECTED document in the exact output shape the instructions above require —",
    "not a review, not a list of suggestions, not a message. Someone else validates what you return;",
    "you do not approve your own work.",
    "",
    "## What must be closed",
    ...(context.findings.length > 0
      ? context.findings.map((finding) => `- ${finding.where}: ${finding.problem}\n  what to do: ${finding.fix}`)
      : ["- the structure itself: the previous outputs did not parse; return a valid one"]),
    "",
    "## What was tried and did not close it",
    ...(context.history.length > 0 ? context.history.map((entry) => `- ${entry}`) : ["- (no earlier attempt recorded)"]),
    "",
    "## Limits",
    "- Change only what the findings name; everything else comes back as it is.",
    "- Never add, drop or weaken a requirement, a rule, a confirmed decision or a story of the product:",
    "  authority is the request, the decisions and the skeleton, in that order.",
    "- Never open a product decision: if a finding cannot be closed without one, keep the text as it",
    "  is on that point and close the rest.",
    "- Prefer the simplest correct change over a redesign.",
    ...(context.limits ?? []).map((limit) => `- ${limit}`),
  ].join("\n");
}

export const REPAIR_MARKER = "## You are repairing, not auditing";
