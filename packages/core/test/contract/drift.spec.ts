/**
 * A deriva de uma emenda.
 *
 * Instrução de prompt não é garantia: "mude só o que os findings citam" estava
 * escrito e o modelo reescrevia a fase inteira. O que é verificável em código é
 * conferido em código.
 */

import { describe, expect, it } from "vitest";
import { checkRewriteDrift, parsePhaseFragment } from "../../src/contract/index.js";

function fase(tasks: { titulo: string; criterios: number; traces?: string }[]): string {
  return [
    "## Phase 1: Fundação",
    "",
    "**Goal:** base · **Depends on:** none · **Covers:** statuses",
    "",
    ...tasks.flatMap((task) => [
      `- [ ] **Task:** ${task.titulo}`,
      "  - **Acceptance criteria:**",
      ...Array.from({ length: task.criterios }, (_unused, posicao) => `    - condição ${posicao + 1}`),
      "  - **Feature tests:** t → t",
      `  - **Traces:** ${task.traces ?? "statuses"}`,
      "",
    ]),
  ].join("\n");
}

const tasksDe = (markdown: string) => parsePhaseFragment(markdown)?.tasks ?? [];

const findingSobre = (titulo: string) => [
  { where: "Phase 1", problem: `a task "${titulo}" tem critério vago`, fix: "torne-o observável" },
];

describe("deriva da emenda", () => {
  it("emenda cirúrgica não acusa nada", () => {
    const antes = fase([{ titulo: "Criar a tabela", criterios: 2 }, { titulo: "Semear os status", criterios: 2 }]);
    const depois = fase([{ titulo: "Criar a tabela", criterios: 3 }, { titulo: "Semear os status", criterios: 2 }]);

    const desvios = checkRewriteDrift({
      before: tasksDe(antes),
      after: tasksDe(depois),
      findings: findingSobre("Criar a tabela"),
    });
    expect(desvios).toEqual([]);
  });

  it("task não citada que muda de tamanho é deriva", () => {
    const antes = fase([{ titulo: "Criar a tabela", criterios: 2 }, { titulo: "Semear os status", criterios: 2 }]);
    const depois = fase([{ titulo: "Criar a tabela", criterios: 2 }, { titulo: "Semear os status", criterios: 5 }]);

    const desvios = checkRewriteDrift({
      before: tasksDe(antes),
      after: tasksDe(depois),
      findings: findingSobre("Criar a tabela"),
    });
    expect(desvios).toHaveLength(1);
    expect(desvios[0]).toContain("Semear os status");
    expect(desvios[0]).toContain("sem nenhum finding citá-la");
  });

  it("task que some sem ninguém pedir é deriva", () => {
    const antes = fase([{ titulo: "Criar a tabela", criterios: 2 }, { titulo: "Semear os status", criterios: 2 }]);
    const depois = fase([{ titulo: "Criar a tabela", criterios: 2 }]);

    const desvios = checkRewriteDrift({
      before: tasksDe(antes),
      after: tasksDe(depois),
      findings: [{ where: "Phase 1", problem: "o texto está ambíguo", fix: "nomeie o alvo da comparação" }],
    });
    expect(desvios[0]).toContain("desapareceu");
  });

  it("finding que pede divisão autoriza mexer na estrutura", () => {
    // O piloto 3 devolveu "16 tasks é demais": acrescentar e remover task ali é
    // exatamente o que foi pedido.
    const antes = fase([{ titulo: "Fazer tudo", criterios: 4 }]);
    const depois = fase([{ titulo: "Fazer uma coisa", criterios: 2 }, { titulo: "Fazer outra", criterios: 2 }]);

    const desvios = checkRewriteDrift({
      before: tasksDe(antes),
      after: tasksDe(depois),
      findings: [{ where: "Phase 1", problem: "a task declara 9 critérios", fix: "divida-a em tasks que façam uma coisa cada" }],
    });
    expect(desvios).toEqual([]);
  });

  it("Traces alterados sem pedido também contam", () => {
    const antes = fase([{ titulo: "Criar a tabela", criterios: 2 }, { titulo: "Semear", criterios: 2, traces: "statuses" }]);
    const depois = fase([{ titulo: "Criar a tabela", criterios: 2 }, { titulo: "Semear", criterios: 2, traces: "US-9.9" }]);

    const desvios = checkRewriteDrift({
      before: tasksDe(antes),
      after: tasksDe(depois),
      findings: findingSobre("Criar a tabela"),
    });
    expect(desvios[0]).toContain("Traces");
  });

  it("fase que o parser não lê não inventa deriva", () => {
    expect(parsePhaseFragment("isto não é uma fase")).toBeNull();
  });
});
