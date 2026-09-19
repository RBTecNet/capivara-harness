/**
 * O segundo estágio do ciclo.
 *
 * `init` entrega as fases; `plan` detalha cada uma até o plano que o loop
 * executa. São o mesmo orquestrador com estágios diferentes — não duas
 * implementações — porque tudo o que protege a execução é comum aos dois:
 * dimensionamento, cobertura, auditoria, ensaio.
 *
 * O que muda é o que cada estágio enxerga. O `init` olha o produto inteiro uma
 * vez; o `plan` olha uma fase de cada vez, com a fatia dela.
 */

import { runInit, type InitOptions, type InitOutcome } from "./orchestrator.js";

export type PlanOptions = Omit<InitOptions, "mode" | "stage">;

export async function runPlan(options: PlanOptions): Promise<InitOutcome> {
  return runInit({ ...options, mode: "skeleton", stage: "plan" });
}
