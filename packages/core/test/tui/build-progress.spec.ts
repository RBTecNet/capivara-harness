/**
 * O estado da tela do build, alimentado pelos eventos do loop.
 *
 * O que este teste protege é o ciclo de correção: uma fase que volta do gate 2
 * não pode continuar mostrando o gate 3 da passagem anterior.
 */

import { describe, expect, it } from "vitest";
import { BuildPhaseTracker } from "../../src/tui/index.js";
import type { BuildProgress } from "../../src/loop/index.js";

const plano = [
  { id: "P01", title: "Fundação do parser" },
  { id: "P02", title: "Backend e endpoints" },
  { id: "P03", title: "Frontend" },
];

function tracker(...eventos: BuildProgress[]): BuildPhaseTracker {
  const t = new BuildPhaseTracker();
  t.plan(plano);
  for (const evento of eventos) t.apply(evento);
  return t;
}

describe("a lista nasce do plano, não do que já aconteceu", () => {
  it("todas as fases aparecem antes de qualquer uma começar", () => {
    const linhas = tracker().rows();
    expect(linhas.map((row) => row.id)).toEqual(["P01", "P02", "P03"]);
    expect(linhas.every((row) => row.state === "aguardando")).toBe(true);
  });

  it("o resumo conta sobre o plano inteiro", () => {
    expect(tracker().summary()).toBe("0/3 fases");
  });
});

describe("os gates da fase corrente", () => {
  const emAndamento: BuildProgress = { kind: "phase", id: "P01", state: "em andamento", cycle: 1, detail: "implementação" };

  it("o gate corrente fica amarelo e os seguintes continuam apagados", () => {
    const linha = tracker(emAndamento, { kind: "gate", id: "P01", gate: "G0", state: "corrente", cycle: 1 }).rows()[0];
    expect(linha?.gates.G0).toBe("corrente");
    expect(linha?.gates.G3).toBe("aguardando");
  });

  it("gate aprovado fica verde, reprovado fica vermelho", () => {
    const linha = tracker(
      emAndamento,
      { kind: "gate", id: "P01", gate: "G0", state: "verde", cycle: 1 },
      { kind: "gate", id: "P01", gate: "G2", state: "vermelho", cycle: 1 },
    ).rows()[0];
    expect(linha?.gates.G0).toBe("verde");
    expect(linha?.gates.G2).toBe("vermelho");
  });

  /*
   * O caso que importa. Sem zerar, a fase que voltou do gate 2 continuaria
   * mostrando o gate 3 verde de uma passagem que já não vale, e a tela diria
   * que ela está mais adiantada do que está.
   */
  it("ciclo novo zera os gates da fase", () => {
    const t = tracker(
      emAndamento,
      { kind: "gate", id: "P01", gate: "G0", state: "verde", cycle: 1 },
      { kind: "gate", id: "P01", gate: "G3", state: "verde", cycle: 1 },
      { kind: "phase", id: "P01", state: "em andamento", cycle: 2, detail: "ciclo 2/3" },
    );
    const linha = t.rows()[0];
    expect(linha?.gates.G3).toBe("aguardando");
    expect(linha?.gates.G0).toBe("aguardando");
    expect(linha?.detail).toBe("ciclo 2/3");
  });

  /*
   * Os gates são a explicação do resultado. Apagá-los no desfecho joga fora
   * exatamente o que quem olha procura: a fase vermelha sem o gate vermelho não
   * diz por que parou.
   */
  it("fase que falhou preserva o gate que a reprovou", () => {
    const t = tracker(
      { kind: "phase", id: "P02", state: "em andamento", cycle: 3, detail: "ciclo 3/3" },
      { kind: "gate", id: "P02", gate: "G0", state: "verde", cycle: 3 },
      { kind: "gate", id: "P02", gate: "G2", state: "vermelho", cycle: 3 },
      { kind: "phase", id: "P02", state: "falhou", cycle: 3, detail: "gate 2" },
    );
    expect(t.rows()[1]?.gates.G2).toBe("vermelho");
    expect(t.rows()[1]?.gates.G0).toBe("verde");
  });

  it("fase concluída preserva os quatro gates verdes que a fizeram passar", () => {
    const eventos: BuildProgress[] = [{ kind: "phase", id: "P01", state: "em andamento", cycle: 1, detail: "implementação" }];
    for (const gate of ["G0", "G1", "G2", "G3"] as const) {
      eventos.push({ kind: "gate", id: "P01", gate, state: "verde", cycle: 1 });
    }
    eventos.push({ kind: "phase", id: "P01", state: "concluído", cycle: 1, detail: "commitada" });
    const linha = tracker(...eventos).rows()[0];
    expect(Object.values(linha?.gates ?? {})).toEqual(["verde", "verde", "verde", "verde"]);
  });

  it("gates de uma fase não vazam para outra", () => {
    const t = tracker(
      { kind: "gate", id: "P01", gate: "G0", state: "verde", cycle: 1 },
      { kind: "gate", id: "P02", gate: "G0", state: "vermelho", cycle: 1 },
    );
    expect(t.rows()[0]?.gates.G0).toBe("verde");
    expect(t.rows()[1]?.gates.G0).toBe("vermelho");
  });
});

describe("desfechos", () => {
  it("fase concluída conta no resumo e some da execução", () => {
    const t = tracker({ kind: "phase", id: "P01", state: "concluído", cycle: 1, detail: "commitada" });
    expect(t.summary()).toBe("1/3 fases");
    expect(t.current()).toBeNull();
  });

  it("fase que falhou aparece no resumo sem ser confundida com concluída", () => {
    const t = tracker({ kind: "phase", id: "P02", state: "falhou", cycle: 3, detail: "gate 2 — suíte do projeto" });
    expect(t.summary()).toContain("1 falhou");
    expect(t.summary()).toContain("0/3");
  });

  it("a fase em execução é identificável para o painel dizer o que acontece agora", () => {
    const t = tracker({ kind: "phase", id: "P02", state: "em andamento", cycle: 1, detail: "implementação" });
    expect(t.current()?.id).toBe("P02");
  });

  /*
   * Um build retomado conta o que já fez antes de anunciar o plano. O evento não
   * pode se perder por chegar cedo demais.
   */
  it("evento de fase que ainda não foi planejada cria a linha em vez de sumir", () => {
    const t = new BuildPhaseTracker();
    t.apply({ kind: "phase", id: "P09", state: "concluído", cycle: 1, detail: "retomada" });
    expect(t.rows().map((row) => row.id)).toEqual(["P09"]);
  });
});
