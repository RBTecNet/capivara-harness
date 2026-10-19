import { describe, expect, it } from "vitest";

import { opcoesDoImpasse, paradaDeProntidao, paradaDoEstagio } from "../../src/commands/paradas.js";

describe("parada dos estágios documentais", () => {
  it("teto de geração orienta orçamento sem culpar a credencial", () => {
    const parada = paradaDoEstagio(new Error("A geração de writer em phase-p01 atingiu o limite de tokens.\n\nopenrouter: a geração atingiu o limite de tokens; o documento ficou incompleto e não foi aprovado."), "plan");
    expect(parada.natureza).toBe("modelo");
    expect(parada.deQuem).toContain("orçamento");
    expect(parada.paraSeguir.join(" ")).toContain("CAPIVARA_API_MAX_OUTPUT_TOKENS");
    expect(parada.paraSeguir.join(" ")).not.toContain("credencial");
    expect(parada.paraSeguir.join(" ")).not.toContain("troque o modelo");
  });
  it("processo falhou antes de responder: não atribui saída vazia ao modelo", () => {
    const parada = paradaDoEstagio(new Error("O papel writer falhou com código 9 em skeleton.\nNode: bad option"), "init");
    expect(parada.natureza).toBe("ambiente");
    expect(parada.deQuem).not.toContain("o texto que ele devolveu não serve");
    expect(parada.detalhe).toContain("bad option");
  });
  it("cobra do modelo quando o auditor devolveu lixo, e diz o que fazer", () => {
    const parada = paradaDoEstagio(
      new Error("o auditor de project-phases.md#P6 devolveu saída inválida duas vezes: falta CAPIVARA_AUDIT\n\nO que ele respondeu:\n  ..."),
      "plan",
      "init-abc",
    );

    expect(parada.natureza).toBe("modelo");
    expect(parada.oQue).toContain("devolveu saída inválida duas vezes");
    expect(parada.custou).toContain("cache");
    expect(parada.custou).not.toContain("continuam publicadas");
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

describe("controles do impasse", () => {
  it("contagem oferece controle de execução, sem pedir decisão de produto", () => {
    const choices = opcoesDoImpasse(true);
    expect(choices.map(choice => choice.resposta)).toEqual(["reiniciar", "publicar", "abortar"]);
    expect(choices[0]?.choice.label).toContain("corrigir");
    expect(choices[1]?.choice.hint).toContain("limites");
    expect(choices.some(choice => choice.resposta === null)).toBe(false);
  });

  it("desacordo semântico continua aceitando uma decisão escrita", () => {
    const choices = opcoesDoImpasse(false);
    expect(choices[0]?.resposta).toBeNull();
    expect(choices[0]?.choice.label).toContain("decisão");
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

  it("rascunho acima dos limites continua identificado como falha do modelo", () => {
    const result = paradaDeProntidao({ ready: false, contractErrors: [], checks: [{ id: "dimensionamento", title: "Dimensionamento", passed: false, detail: "P1.T2: 5 critérios; limite 4" }] }, "plan");
    expect(result.natureza).toBe("modelo");
    expect(result.deQuem).toContain("sessão do modelo");
  });

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
