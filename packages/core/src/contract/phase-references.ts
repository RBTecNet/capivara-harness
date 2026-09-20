/** Fases citadas pelo auditor, inclusive nos endereços dos critérios. */
export function affectedPhases(
  findings: readonly { where: string; problem: string; fix: string }[],
  total: number,
): number[] {
  const named = new Set<number>();
  for (const finding of findings) {
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
