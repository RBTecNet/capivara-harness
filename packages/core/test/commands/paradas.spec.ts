import { describe, expect, it } from "vitest";

import { paradaDeProntidao, paradaDoEstagio } from "../../src/commands/paradas.js";

describe("parada dos estágios documentais", () => {
  it("cobra do modelo quando o auditor devolveu lixo, e diz o que fazer", () => {
    const parada = paradaDoEstagio(
      new Error("o auditor de project-phases.md#P6 devolveu saída inválida duas vezes: falta CAPIVARA_AUDIT\n\nO que ele respondeu:\n  ..."),
      "plan",
      "init-abc",
    );

    expect(parada.natureza).toBe("modelo");
    expect(parada.oQue).toContain("devolveu saída inválida duas vezes");
    expect(parada.custou).toContain("continuam publicadas");
    expect(parada.paraSeguir.at(-1)).toContain("capivara plan");
    expect(parada.detalhe).toContain("O que ele respondeu");
  });

  it("cobra do ambiente quando a chamada estourou o tempo", () => {
    const parada = paradaDoEstagio(new Error("A chamada de writer em skeleton.md estourou o tempo duas vezes."), "init");
    expect(parada.natureza).toBe("ambiente");
    expect(parada.deQuem).toContain("provider ou da rede");
  });

  it("assume o defeito quando ele é nosso", () => {
    const parada = paradaDoEstagio(new Error("o plano não passa no parser na hora de auditar"), "plan");
    expect(parada.natureza).toBe("harness");
    expect(parada.paraSeguir[0]).toContain("defeito nosso");
  });

  it("não chama de falha o que é etapa fora de ordem", () => {
    const parada = paradaDoEstagio(new Error("não há esqueleto publicado neste projeto. Rode `capivara init` primeiro"), "plan");
    expect(parada.natureza).toBe("decisão");
  });

  it("respeita quem mandou abortar", () => {
    const parada = paradaDoEstagio(new Error("impasse\n\nDecisão do desenvolvedor: abortar"), "init");
    expect(parada.natureza).toBe("decisão");
  });

  it("guarda o run como evidência quando há um", () => {
    expect(paradaDoEstagio(new Error("x"), "init", "init-9").evidencia).toEqual([".capivara/runs/init-9"]);
    expect(paradaDoEstagio(new Error("x"), "init").evidencia).toBeUndefined();
  });
});

describe("parada por prontidão", () => {
  const readiness = {
    ready: false,
    contractErrors: [],
    checks: [
      { id: "a", title: "esqueleto publicado", passed: true, detail: "" },
      { id: "b", title: "sem decisões pendentes", passed: false, detail: "2 [NEEDS DECISION] no esqueleto" },
      { id: "c", title: "ensaio do verificador", passed: false, detail: "3 critérios bloqueados" },
    ],
  };

  it("nomeia a primeira verificação que falta e conta as outras", () => {
    const parada = paradaDeProntidao(readiness, "init", "init-1");
    expect(parada.oQue).toContain("sem decisões pendentes");
    expect(parada.paraSeguir[0]).toContain("2 verificação");
    expect(parada.detalhe).toContain("ensaio do verificador");
    expect(parada.natureza).toBe("decisão");
  });

  it("não chama de defeito o que é trabalho a terminar", () => {
    expect(paradaDeProntidao(readiness, "plan").deQuem).toContain("de ninguém");
  });
});
