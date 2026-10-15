import { describe, expect, it } from "vitest";
import { escolhaDaMudanca, escolhaDeColisao, respostaDaMudanca } from "../../src/commands/escolhas-sem-painel.js";
import { lerResposta } from "../../src/change/orchestrator.js";
import type { ChangeQuestion } from "../../src/contract/change.js";

const question: ChangeQuestion = {
  id: "Q-01",
  topic: "relatório",
  decision: "O relatório sai em PDF ou em planilha?",
  why: "Muda a dependência e o teste de aceitação.",
  options: [
    { label: "PDF", consequence: "Acrescenta um gerador de PDF." },
    { label: "Planilha", consequence: "Exporta CSV, sem dependência nova." },
  ],
  recommended: "Planilha",
};

describe("change por lista", () => {
  it("cada opção da lista vira, pelo leitor do change, a opção da mesma posição", () => {
    const { choices } = escolhaDaMudanca(question, 1, 2);
    expect(choices).toHaveLength(3);
    expect(lerResposta(question, respostaDaMudanca(question, 0)!)).toBe("PDF");
    expect(lerResposta(question, respostaDaMudanca(question, 1)!)).toBe("Planilha");
    expect(respostaDaMudanca(question, 2)).toBeNull();
  });

  it("o cursor começa na recomendada, marcada, e o texto livre fica no fim", () => {
    const escolha = escolhaDaMudanca(question, 1, 2);
    expect(escolha.defaultIndex).toBe(1);
    expect(escolha.choices[1]!.label).toBe("Planilha ← recomendada");
    expect(escolha.choices[2]!.label).toBe("responder com texto livre");
  });

  it("o tópico vai para o título, e o texto mantém a decisão, o porquê e as consequências", () => {
    const escolha = escolhaDaMudanca(question, 1, 2);
    expect(escolha.title).toBe("PERGUNTA 1/2 · relatório");
    const texto = escolha.text.join("\n");
    expect(texto.startsWith("O relatório sai em PDF ou em planilha?")).toBe(true);
    expect(texto).toContain("por quê: Muda a dependência");
    expect(texto).toContain("Exporta CSV, sem dependência nova.");
    expect(texto).not.toContain("Pergunta 1 de 2");
  });
});

describe("colisão do survey por lista", () => {
  it("as três linhas são as três decisões, na ordem de antes, e o padrão é atualizar", () => {
    const escolha = escolhaDeColisao("biblioteca");
    expect(escolha.decisoes).toEqual(["atualizar", "novo", "local"]);
    expect(escolha.choices).toHaveLength(3);
    expect(escolha.defaultIndex).toBe(0);
    expect(escolha.choices[0]!.label).toContain('"biblioteca"');
  });
});
