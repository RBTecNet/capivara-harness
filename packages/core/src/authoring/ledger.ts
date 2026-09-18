/**
 * O ledger de coordenação.
 *
 * Antes de escrever a primeira fase, o modelo aloca a lista final de fases e o
 * mapa de cobertura. Sem isso, cada parte inventaria sua própria numeração e a
 * cobertura só seria descoberta no fim, depois de todas as chamadas pagas.
 */

export const LEDGER_CONTRACT = "capivara-ledger/v1" as const;

export interface LedgerPhase {
  number: number;
  title: string;
  goal: string;
  dependsOn: string;
  covers: string[];
  taskCount: number;
}

export interface LedgerCoverage {
  stories: Record<string, number[] | string>;
  entities: Record<string, number[] | string>;
  workflows: Record<string, number[] | string>;
}

export interface Ledger {
  contract: typeof LEDGER_CONTRACT;
  phases: LedgerPhase[];
  mvpCutPhase: number;
  coverage: LedgerCoverage;
}

export interface LedgerDefect {
  problem: string;
  hint: string;
}

export type LedgerResult = { ok: true; ledger: Ledger } | { ok: false; defects: LedgerDefect[] };

/** Teto de tasks por fase: acima disso a fase não cabe numa sessão de agente. */
export const MAX_TASKS_PER_PHASE = 15;

/**
 * Teto de critérios por fase.
 *
 * Contar tasks mede a coisa errada. Os três pilotos que fecharam ficaram entre
 * 2,1 e 2,5 critérios por task, com no máximo 46 critérios numa fase. O piloto 3
 * saiu com 84 numa fase só — o mesmo número de tasks, o dobro do trabalho, e uma
 * sessão de agente que ninguém nunca testou desse tamanho.
 *
 * O número é empírico e revisável: 60 fica acima de tudo o que já funcionou e
 * abaixo do que nunca foi tentado. Quando houver evidência de fase maior
 * fechando, ele sobe.
 */
export const MAX_CRITERIA_PER_PHASE = 60;

export function parseLedger(source: string): LedgerResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(source));
  } catch {
    return { ok: false, defects: [{ problem: "a resposta não é JSON válido", hint: `devolva { "contract": "${LEDGER_CONTRACT}", "phases": [...], "mvpCutPhase": N, "coverage": {...} }` }] };
  }

  const root = (parsed ?? {}) as Record<string, unknown>;
  const defects: LedgerDefect[] = [];

  if (root.contract !== LEDGER_CONTRACT) {
    defects.push({ problem: `contrato ausente ou diferente de ${LEDGER_CONTRACT}`, hint: `declare "contract": "${LEDGER_CONTRACT}"` });
  }

  const rawPhases = Array.isArray(root.phases) ? root.phases : [];
  if (rawPhases.length === 0) defects.push({ problem: "nenhuma fase alocada", hint: "aloque ao menos uma fase, começando pela fundação de dados" });

  const phases: LedgerPhase[] = rawPhases.map((entry, index) => {
    const record = (entry ?? {}) as Record<string, unknown>;
    const phase: LedgerPhase = {
      number: typeof record.number === "number" ? record.number : index + 1,
      title: typeof record.title === "string" ? record.title.trim() : "",
      goal: typeof record.goal === "string" ? record.goal.trim() : "",
      dependsOn: typeof record.dependsOn === "string" ? record.dependsOn.trim() : "none",
      covers: Array.isArray(record.covers) ? record.covers.filter((item): item is string => typeof item === "string") : [],
      taskCount: typeof record.taskCount === "number" ? record.taskCount : 0,
    };
    if (phase.number !== index + 1) {
      defects.push({ problem: `a fase na posição ${index + 1} declara number ${phase.number}`, hint: "numere as fases de 1 a N, contíguas e em ordem" });
    }
    if (phase.title === "") defects.push({ problem: `a fase ${phase.number} não tem título`, hint: "dê à fase um título que nomeie a fatia entregue" });
    if (phase.goal === "") defects.push({ problem: `a fase ${phase.number} não tem goal`, hint: "declare o resultado observável que a fase entrega" });
    if (phase.taskCount > MAX_TASKS_PER_PHASE) {
      defects.push({
        problem: `a fase ${phase.number} aloca ${phase.taskCount} tasks`,
        hint: `uma fase é uma sessão de agente e comporta até ${MAX_TASKS_PER_PHASE} tasks; divida em mais fases de topo em vez de sobrecarregar esta`,
      });
    }
    if (phase.taskCount <= 0) defects.push({ problem: `a fase ${phase.number} não aloca nenhuma task`, hint: "toda fase entrega pelo menos uma task, ou não deveria existir" });
    return phase;
  });

  const coverage = (root.coverage ?? {}) as Record<string, unknown>;
  for (const dimension of ["stories", "entities", "workflows"]) {
    if (typeof coverage[dimension] !== "object" || coverage[dimension] === null) {
      defects.push({ problem: `o mapa de cobertura não traz ${dimension}`, hint: `declare "coverage.${dimension}" mapeando cada item às fases que o cobrem, ou à exclusão que o desenvolvedor declarou` });
    }
  }

  if (defects.length > 0) return { ok: false, defects };

  return {
    ok: true,
    ledger: {
      contract: LEDGER_CONTRACT,
      phases,
      mvpCutPhase: typeof root.mvpCutPhase === "number" ? root.mvpCutPhase : phases.length,
      coverage: coverage as unknown as LedgerCoverage,
    },
  };
}

function stripFence(source: string): string {
  const trimmed = source.trim();
  return /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(trimmed)?.[1] ?? trimmed;
}
