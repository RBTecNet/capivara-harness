import { describe, expect, it } from "vitest";
import { buildAnswer, classifyLocally, parseClassification } from "../../src/interview/index.js";
import type { Question } from "../../src/interview/index.js";

const question: Question = {
  id: "Q-01",
  topic: "stack",
  evidence: "diretório vazio",
  decision: "Qual stack o projeto usa?",
  why: "define build e teste",
  options: [
    { label: "Node + Vitest", consequence: "rápido" },
    { label: "Python + pytest", consequence: "dados" },
  ],
  recommended: "Node + Vitest",
  recommendationBasis: "stack dos seus projetos",
};

describe("camada determinística", () => {
  it("escolher pelo número aceita a opção", () => {
    expect(classifyLocally(question, "2")).toMatchObject({ disposition: "ACCEPTED", decision: "Python + pytest", settled: true });
  });

  it("escolher pelo rótulo aceita a opção, sem ligar para maiúsculas", () => {
    expect(classifyLocally(question, "node + vitest").decision).toBe("Node + Vitest");
  });

  it("'use as recomendações' aceita o que estava na tela", () => {
    expect(classifyLocally(question, "use as recomendações")).toMatchObject({ disposition: "ACCEPTED", decision: "Node + Vitest" });
  });

  it("'não sei' é DEFERRED e NUNCA confirma a recomendação", () => {
    for (const resposta of ["não sei", "nao sei", "sei lá", "tanto faz", "depois", "not sure"]) {
      const classification = classifyLocally(question, resposta);
      expect(classification.disposition, resposta).toBe("DEFERRED");
      expect(classification.decision, resposta).toBe("");
    }
  });

  it("resposta vazia é DEFERRED", () => {
    expect(classifyLocally(question, "   ").disposition).toBe("DEFERRED");
  });

  it("'use as recomendações' sem recomendação na tela vira DEFERRED", () => {
    const aberta = { ...question, options: [], recommended: "" };
    expect(classifyLocally(aberta, "use as recomendações").disposition).toBe("DEFERRED");
  });

  it("número fora da faixa não é aceito como escolha", () => {
    expect(classifyLocally(question, "9").settled).toBe(false);
  });

  it("texto livre exige o classificador do modelo", () => {
    expect(classifyLocally(question, "acho que algo em javascript mesmo")).toMatchObject({ settled: false, disposition: "PARTIAL" });
  });
});

describe("protocolo do classificador do modelo", () => {
  it("lê uma linha por pergunta", () => {
    const output = [
      "CAPIVARA_ANSWER: Q-01 | ACCEPTED | Node 22 com Vitest",
      "CAPIVARA_ANSWER: Q-02 | PARTIAL | falta dizer se há autenticação",
    ].join("\n");
    expect(parseClassification(output)).toEqual([
      { questionId: "Q-01", disposition: "ACCEPTED", text: "Node 22 com Vitest" },
      { questionId: "Q-02", disposition: "PARTIAL", text: "falta dizer se há autenticação" },
    ]);
  });

  it("ignora prosa em volta e tolera CRLF", () => {
    expect(parseClassification("blá blá\r\nCAPIVARA_ANSWER: Q-01 | DEFERRED | \r\nmais prosa")).toHaveLength(1);
  });

  it("ignora disposição inventada", () => {
    expect(parseClassification("CAPIVARA_ANSWER: Q-01 | TALVEZ | x")).toEqual([]);
  });
});

describe("buildAnswer", () => {
  it("preserva a resposta crua junto da decisão normalizada", () => {
    const answer = buildAnswer(question, "pode ser node mesmo", { disposition: "ACCEPTED", decision: "Node + Vitest", open: "" }, 1);
    expect(answer.raw).toBe("pode ser node mesmo");
    expect(answer.decision).toBe("Node + Vitest");
  });

  it("disposição diferente de ACCEPTED nunca carrega decisão", () => {
    for (const disposition of ["PARTIAL", "AMBIGUOUS", "DEFERRED", "CONTRADICTED"] as const) {
      const answer = buildAnswer(question, "x", { disposition, decision: "Node + Vitest", open: "falta X" }, 1);
      expect(answer.decision, disposition).toBe("");
      expect(answer.open, disposition).not.toBe("");
    }
  });
});
