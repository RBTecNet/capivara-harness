/**
 * A insistência: nenhuma decisão material morre por falta de ter sido perguntada.
 *
 * O harness tinha três tetos de entrevista e os três terminavam igual — a decisão
 * que ninguém fechou virava `[NEEDS DECISION]` no plano e NOT READY no gate. Visto
 * de fora, isso é o harness desistindo: ele sabia o que faltava e tinha quem
 * responder na frente do terminal.
 */

import { describe, expect, it } from "vitest";
import {
  DELEGAR,
  FORA_DO_ESCOPO,
  leituraInsistente,
  perguntaDeLacuna,
  perguntaInsistente,
  suposicaoDelegada,
} from "../../src/interview/index.js";
import type { Question } from "../../src/interview/index.js";

const pergunta: Question = {
  id: "Q-01",
  topic: "prazo de garantia",
  evidence: "O pedido fala em garantia e nunca diz por quanto tempo.",
  decision: "Qual é o prazo de garantia?",
  why: "muda o que a tela mostra e o que o teste verifica",
  options: [
    { label: "90 dias", consequence: "o prazo padrão do varejo" },
    { label: "1 ano", consequence: "o prazo da indústria" },
  ],
  recommended: "90 dias",
  recommendationBasis: "é o que o pedido sugere no resto do texto",
};

describe("a pergunta que insiste", () => {
  it("mantém as opções originais e acrescenta as duas saídas que a fecham", () => {
    const insistente = perguntaInsistente(pergunta, "falta dizer o prazo");
    expect(insistente.options.slice(0, 2)).toEqual(pergunta.options);
    expect(insistente.options.map((opcao) => opcao.label)).toContain(DELEGAR);
    expect(insistente.options.map((opcao) => opcao.label)).toContain(FORA_DO_ESCOPO);
    // O que ficou aberto aparece na tela: repetir a pergunta idêntica faz quem
    // responde achar que não foi lido.
    expect(insistente.pending).toBe("falta dizer o prazo");
  });

  it("delegar não é decidir: o que fica gravado diz o que passou a valer, e vira suposição", () => {
    const leitura = leituraInsistente(perguntaInsistente(pergunta, ""), DELEGAR);
    expect(leitura.tipo).toBe("delegada");
    if (leitura.tipo !== "delegada") return;
    // Nunca o rótulo do botão: este texto vai ao escritor, ao auditor e ao relatório.
    expect(leitura.decisao).not.toBe(DELEGAR);
    expect(leitura.decisao).toContain("90 dias");
    expect(suposicaoDelegada(pergunta, leitura.decisao).basis).toContain("autorizou o harness a decidir");
  });

  it("sem recomendação, delegar vale pela alternativa de menor escopo", () => {
    const semRecomendacao = { ...pergunta, options: [], recommended: "" };
    const leitura = leituraInsistente(perguntaInsistente(semRecomendacao, ""), DELEGAR);
    if (leitura.tipo !== "delegada") throw new Error("deveria delegar");
    expect(leitura.decisao).toContain("MENOR ESCOPO");
  });

  it("fora do escopo é escrito como não-objetivo, para o auditor não voltar a cobrar", () => {
    const leitura = leituraInsistente(perguntaInsistente(pergunta, ""), FORA_DO_ESCOPO);
    expect(leitura.tipo).toBe("fora");
    if (leitura.tipo !== "fora") return;
    expect(leitura.decisao).toContain("FORA DO ESCOPO");
    expect(leitura.decisao).toContain("prazo de garantia");
  });

  it("escolher uma das opções originais é decidir, e nada é reinterpretado", () => {
    expect(leituraInsistente(perguntaInsistente(pergunta, ""), "1 ano").tipo).toBe("decidida");
  });
});

describe("a pergunta do harness para um marcador", () => {
  const marcador = "o que acontece quando a data de cobrança não existe no mês";

  it("mostra o marcador com as palavras de quem parou, e oferece as duas saídas", () => {
    const lacuna = perguntaDeLacuna(marcador, 3);
    expect(lacuna.decision).toBe(marcador);
    expect(lacuna.evidence).toContain(marcador);
    expect(lacuna.options).toHaveLength(2);
    expect(lacuna.recommended).toBe(DELEGAR);
  });

  /*
   * Duas opções, sempre: a rede embaixo do lote malformado não pode ser uma
   * pergunta discursiva, que é o defeito que ela existe para não repetir.
   */
  it("nunca é discursiva, mesmo sendo montada sem saber as alternativas", () => {
    expect(perguntaDeLacuna(marcador, 1).options.length).toBeGreaterThanOrEqual(2);
    expect(perguntaDeLacuna(marcador, 1).options.every((opcao) => opcao.consequence !== "")).toBe(true);
  });

  it("o id fica fora da faixa da entrevista, para não colidir no handoff", () => {
    expect(perguntaDeLacuna(marcador, 7).id).toMatch(/^Q-8/);
  });
});
