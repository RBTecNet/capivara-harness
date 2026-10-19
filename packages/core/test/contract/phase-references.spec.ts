import { describe, expect, it } from "vitest";
import { affectedPhases } from "../../src/contract/index.js";

describe("fases citadas nos findings", () => {
  it("endereço preciso não transforma exemplos da explicação em alvos de emenda", () => {
    expect(affectedPhases([{
      where: "P1.T4.C1 vs P1.T5.C1",
      problem: "P1 monta rotas que o exemplo atribui à fase 3 e à fase 5",
      fix: "retire de P1.T4.C1 os exemplos de Phase 3 e Phase 5",
    }], 9)).toEqual([1]);
  });
  it.each(["Phase 2", "Fase 2", "phase 2.3", "P2", "P2.T1", "P2.T1.C3"])("preserva o destino de %s", (where) => {
    expect(affectedPhases([{ where, problem: "critério vago", fix: "declare o resultado" }], 3)).toEqual([2]);
  });

  it("prioriza o endereço e usa prosa como fallback, sem incluir fases fora do plano", () => {
    expect(affectedPhases([
      { where: "P2.T1.C3", problem: "contradiz a Fase 1", fix: "alinhe Phase 2 e P1.T1.C1" },
      { where: "P99.T1.C1", problem: "P0.T1.C1", fix: "altere P3.T1.C1" },
    ], 3)).toEqual([2, 3]);
  });

  it("sem fase identificável, inclusive referência fora do plano, revisa todas", () => {
    expect(affectedPhases([{ where: "Overview", problem: "ordem incorreta", fix: "corrigir" }], 3)).toEqual([1, 2, 3]);
    expect(affectedPhases([{ where: "P20.T1.C1", problem: "", fix: "" }], 3)).toEqual([1, 2, 3]);
  });
});
