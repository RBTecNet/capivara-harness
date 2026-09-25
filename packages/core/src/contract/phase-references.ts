/**
 * Fases citadas pelo auditor — ou declaradas por quem o chamou.
 *
 * `phase` vem do harness e vence a prosa: a auditoria por fase sabe de qual fase
 * se trata, e o auditor, que já sabe disso, escreve o endereço como título de
 * task. Medido no `assistencia2`: 24 de 25 achados não citavam a fase, e o
 * fallback de "todas as fases" nunca era alcançado porque UM achado a citava —
 * então uma fase era reescrita e os outros 24 defeitos não chegavam a ninguém.
 */
export function affectedPhases(
  findings: readonly { where: string; problem: string; fix: string; phase?: number }[],
  total: number,
): number[] {
  const named = new Set<number>();
  for (const finding of findings) {
    if (finding.phase !== undefined && finding.phase >= 1 && finding.phase <= total) {
      named.add(finding.phase);
      continue;
    }
    const text = `${finding.where} ${finding.problem} ${finding.fix}`;
    // O auditor de coerência usa P2.T2.C1; o auditor local também usa Phase 2
    // ou Fase 2. Ignorar o primeiro formato mandou a correção do cron5 só para
    // a fase 1, embora o defeito e a orientação apontassem para a fase 2.
    for (const match of text.matchAll(/\b(?:phase|fase)\s*(\d+)\b|\bP(\d+)(?:\.T\d+(?:\.C\d+)?)?\b/gi)) {
      const phase = Number(match[1] ?? match[2]);
      if (phase >= 1 && phase <= total) named.add(phase);
    }
  }
  // Sem referência utilizável, preserva o fallback conservador existente.
  return named.size > 0 ? [...named].sort((left, right) => left - right) : Array.from({ length: total }, (_, index) => index + 1);
}
