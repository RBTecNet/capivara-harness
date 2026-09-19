/**
 * Alocação de partes.
 *
 * Uma parte escreve exatamente uma fase. Uma parte nomeada por intervalo —
 * `phases-p01-p04` — estoura o limite de contexto e o run morre ali, e essa é a
 * forma mais comum de um plano grande se tornar inescrevível. Por isso o
 * intervalo é recusado pelo runtime, não pela disciplina do modelo.
 */

export class IntervalPartError extends Error {
  constructor(id: string) {
    super(
      `a parte "${id}" nomeia um intervalo de fases; uma parte escreve exatamente uma fase. ` +
        "Uma parte que carrega várias fases estoura o contexto e o run morre nela — aloque uma parte por fase.",
    );
    this.name = "IntervalPartError";
  }
}

/** `phase-p01-p04`, `phases-1-4`, `p01..p04`: qualquer forma de intervalo. */
const INTERVAL = /(?:^|[^0-9])p?0*\d+[\s_-]*(?:\.\.|-{1,2}|a|to|até)[\s_-]*p?0*\d+(?:$|[^0-9])/i;

export function assertSinglePhasePart(id: string): void {
  if (INTERVAL.test(id)) throw new IntervalPartError(id);
}

export function partId(phaseNumber: number): string {
  return `phase-p${String(phaseNumber).padStart(2, "0")}`;
}

