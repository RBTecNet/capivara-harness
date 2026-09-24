/**
 * A tela de fases do `plan`.
 *
 * O `build` sempre teve as bolinhas; o `plan` — que é o estágio longo, dezenas
 * de chamadas, minutos calado dentro de cada uma — só tinha log passando. Quem
 * olhava não sabia em que fase ele estava nem quantas faltavam.
 */

import { describe, expect, it } from "vitest";

import { PLAN_COLUMNS, PlanPhaseTracker } from "../../src/tui/plan-progress.js";
import { renderPhaseRows } from "../../src/tui/build-phases.js";

const plano = (quantas = 3) => {
  const fases = new PlanPhaseTracker();
  fases.apply({
    kind: "planned",
    phases: Array.from({ length: quantas }, (_, indice) => ({ number: indice + 1, title: `Fase ${indice + 1}` })),
  });
  return fases;
};

describe("rastreador de fases do plan", () => {
  it("nasce com uma linha por fase, tudo aguardando", () => {
    const fases = plano(18);
    expect(fases.rows()).toHaveLength(18);
    expect(fases.rows()[0]?.id).toBe("P01");
    expect(fases.rows()[17]?.id).toBe("P18");
    expect(fases.rows().every((linha) => linha.state === "aguardando")).toBe(true);
  });

  it("duas colunas, e não os cinco gates do build", () => {
    expect([...PLAN_COLUMNS]).toEqual(["E", "A"]);
    expect(Object.keys(plano().rows()[0]!.gates).sort()).toEqual(["A", "E"]);
  });

  it("acende a escrita e depois a auditoria", () => {
    const fases = plano();
    fases.apply({ kind: "authoring", number: 2, state: "corrente" });
    expect(fases.rows()[1]?.gates.E).toBe("corrente");
    expect(fases.rows()[1]?.detail).toBe("escrevendo");

    fases.apply({ kind: "authoring", number: 2, state: "pronta" });
    expect(fases.rows()[1]?.gates.E).toBe("verde");

    fases.apply({ kind: "audit", number: 2, state: "corrente" });
    expect(fases.rows()[1]?.gates.A).toBe("corrente");

    fases.apply({ kind: "audit", number: 2, state: "aprovada" });
    expect(fases.rows()[1]?.state).toBe("concluído");
    expect(fases.rows()[1]?.gates.A).toBe("verde");
  });

  it("fase reaproveitada é verde: ela ESTÁ escrita, o que não houve foi a chamada", () => {
    const fases = plano();
    fases.apply({ kind: "authoring", number: 1, state: "reused" });
    expect(fases.rows()[0]?.gates.E).toBe("verde");
    expect(fases.rows()[0]?.detail).toBe("reaproveitada");
  });

  it("devolvida diz quantos achados vieram — é o que a pessoa quer saber", () => {
    const fases = plano();
    fases.apply({ kind: "audit", number: 3, state: "devolvida", findings: 4 });
    expect(fases.rows()[2]?.gates.A).toBe("vermelho");
    expect(fases.rows()[2]?.detail).toContain("4 finding");
    // Devolvida não é concluída: ela volta para a fila.
    expect(fases.rows()[2]?.state).toBe("em andamento");
  });

  it("a etapa do documento entra no resumo, sem virar linha de fase", () => {
    const fases = plano();
    fases.apply({ kind: "authoring", number: 1, state: "pronta" });
    fases.apply({ kind: "audit", number: 1, state: "aprovada" });
    fases.apply({ kind: "documento", etapa: "ensaio do verificador" });

    expect(fases.summary()).toContain("1 escrita(s) · 1 aprovada(s) de 3");
    expect(fases.summary()).toContain("ensaio do verificador");
    expect(fases.rows()).toHaveLength(3);
  });

  it("evento de fase que ninguém planejou cria a linha em vez de se perder", () => {
    const fases = new PlanPhaseTracker();
    expect(fases.vazio).toBe(true);
    fases.apply({ kind: "authoring", number: 7, state: "corrente" });
    expect(fases.vazio).toBe(false);
    expect(fases.rows()[0]?.id).toBe("P07");
  });

  it("desenha com o mesmo código do build, só que com duas colunas", () => {
    const fases = plano();
    fases.apply({ kind: "authoring", number: 1, state: "pronta" });
    fases.apply({ kind: "audit", number: 1, state: "corrente" });

    const linhas = renderPhaseRows(fases.rows(), 10, 100, { enabled: false }, { columns: PLAN_COLUMNS });
    expect(linhas[0]).toContain("P01");
    expect(linhas[0]).toContain("E●");
    expect(linhas[0]).toContain("A●");
    expect(linhas[0]).not.toContain("G0");
  });
});

/*
 * A tela real, no `assitencia`: doze fases escritas em paralelo, todas "em
 * andamento", e a janela presa na P01 dizendo "↓ 6 fase(s) abaixo" — justamente
 * onde o trabalho estava acontecendo. A âncora do build, que é a primeira fase
 * em execução, engana quando doze executam ao mesmo tempo.
 */
describe("a janela olha para onde o trabalho está", () => {
  const dezoito = () => {
    const fases = new PlanPhaseTracker();
    fases.apply({
      kind: "planned",
      phases: Array.from({ length: 18 }, (_, indice) => ({ number: indice + 1, title: `Fase ${indice + 1}` })),
    });
    return fases;
  };

  it("segue a última fase que mudou, e não a primeira em andamento", () => {
    const fases = dezoito();
    for (let numero = 1; numero <= 12; numero += 1) fases.apply({ kind: "authoring", number: numero, state: "pronta" });
    fases.apply({ kind: "authoring", number: 15, state: "corrente" });

    expect(fases.foco).toBe("P15");
    const linhas = renderPhaseRows(fases.rows(), 12, 120, { enabled: false }, { columns: PLAN_COLUMNS, anchorId: fases.foco });
    expect(linhas.join("\n")).toContain("P15");
  });

  it("centra a âncora: as vizinhas são o contexto de onde o trabalho está", () => {
    const fases = dezoito();
    fases.apply({ kind: "audit", number: 10, state: "corrente" });

    const linhas = renderPhaseRows(fases.rows(), 6, 120, { enabled: false }, { columns: PLAN_COLUMNS, anchorId: "P10" });
    const texto = linhas.join("\n");
    expect(texto).toContain("P08");
    expect(texto).toContain("P10");
    expect(texto).toContain("P12");
  });

  it("o que está escondido diz o que é, não só quanto é", () => {
    const fases = dezoito();
    for (let numero = 1; numero <= 8; numero += 1) {
      fases.apply({ kind: "authoring", number: numero, state: "pronta" });
      fases.apply({ kind: "audit", number: numero, state: "aprovada" });
    }
    fases.apply({ kind: "authoring", number: 14, state: "corrente" });

    const texto = renderPhaseRows(fases.rows(), 6, 120, { enabled: false }, { columns: PLAN_COLUMNS, anchorId: "P14" }).join("\n");
    expect(texto).toContain("concluído");
    expect(texto).toContain("aguardando");
  });

  it("o resumo conta as duas etapas: zero aprovadas com doze escritas parece run parado", () => {
    const fases = dezoito();
    for (let numero = 1; numero <= 12; numero += 1) fases.apply({ kind: "authoring", number: numero, state: "pronta" });

    expect(fases.summary()).toContain("12 escrita(s)");
    expect(fases.summary()).toContain("0 aprovada(s) de 18");
  });
});
