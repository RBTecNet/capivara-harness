import { describe, expect, it } from "vitest";

import { renderConclusao, renderParada } from "../../src/tui/parada.js";

describe("relatório de parada", () => {
  it("responde às quatro perguntas em uma leitura", () => {
    const texto = renderParada({
      natureza: "ambiente",
      oQue: "o binário `sqlite3` não existe nesta máquina",
      custou: "nenhuma sessão gasta; as 3 fases fechadas continuam fechadas",
      evidencia: [".capivara/runs/2026-09-23/logs/P04.gate2.log"],
      paraSeguir: ["instale o sqlite3", "rode `capivara build` — retoma da fase 4"],
    });

    expect(texto).toContain("PAROU — dependência de ambiente");
    expect(texto).toContain("o quê");
    expect(texto).toContain("de quem");
    expect(texto).toContain("custou");
    expect(texto).toContain("evidência");
    expect(texto).toContain("para seguir");
    expect(texto).toContain("1. instale o sqlite3");
    expect(texto).toContain("2. rode `capivara build` — retoma da fase 4");
  });

  it("diz de quem é o defeito sem que ninguém precise perguntar", () => {
    const ambiente = renderParada({ natureza: "ambiente", oQue: "x", custou: "nada", paraSeguir: [] });
    const harness = renderParada({ natureza: "harness", oQue: "x", custou: "nada", paraSeguir: [] });

    expect(ambiente).toContain("seu código não foi tocado");
    expect(harness).toContain("nosso — do harness");
  });

  it("aceita a frase de responsabilidade escrita à mão", () => {
    const texto = renderParada({
      natureza: "produto",
      oQue: "a suíte falhou",
      deQuem: "do produto — 2 testes de P03 quebraram",
      custou: "1 sessão",
      paraSeguir: [],
    });

    expect(texto).toContain("do produto — 2 testes de P03 quebraram");
  });

  it("alinha várias evidências sob a primeira, sem repetir o rótulo", () => {
    const texto = renderParada({
      natureza: "modelo",
      oQue: "x",
      custou: "2 sessões",
      evidencia: ["a.log", "b.log"],
      paraSeguir: [],
    });

    const linhas = texto.split("\n").filter((linha) => linha.includes(".log"));
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toContain("evidência");
    expect(linhas[1]).not.toContain("evidência");
    expect(linhas[0]!.indexOf("a.log")).toBe(linhas[1]!.indexOf("b.log"));
  });

  it("omite a seção de evidência quando não há prova a apontar", () => {
    const texto = renderParada({ natureza: "decisão", oQue: "x", custou: "nada", paraSeguir: ["escolha"] });
    expect(texto).not.toContain("evidência");
  });

  it("indenta a continuação de um passo sob o texto, não sob o número", () => {
    const texto = renderParada({
      natureza: "ambiente",
      oQue: "x",
      custou: "nada",
      paraSeguir: ["primeira linha\nsegunda linha"],
    });

    expect(texto).toContain("    1. primeira linha\n       segunda linha");
  });

  it("não emite escape ANSI quando a cor está desligada", () => {
    const texto = renderParada({ natureza: "harness", oQue: "x", custou: "nada", paraSeguir: [] });
    expect(texto).not.toContain("\u001B[");
  });

  it("pinta quando a cor está ligada", () => {
    const texto = renderParada({ natureza: "harness", oQue: "x", custou: "nada", paraSeguir: [] }, { enabled: true });
    expect(texto).toContain("\u001B[");
  });

  it("leva o detalhe longo para o rodapé, indentado", () => {
    const texto = renderParada({
      natureza: "modelo",
      oQue: "saída inválida",
      custou: "2 sessões",
      paraSeguir: [],
      detalhe: "linha um\nlinha dois",
    });

    expect(texto).toContain("o que veio");
    expect(texto).toContain("    linha um\n    linha dois");
  });

  it("ignora um detalhe vazio", () => {
    const texto = renderParada({ natureza: "modelo", oQue: "x", custou: "nada", paraSeguir: [], detalhe: "   " });
    expect(texto).not.toContain("o que veio");
  });
});

describe("relatório de conclusão", () => {
  it("usa o mesmo formato, sem atribuir defeito a ninguém", () => {
    const texto = renderConclusao({
      oQue: "8 fases fechadas",
      custou: "11 sessões",
      evidencia: [".capivara/runs/2026-09-23/"],
      paraSeguir: ["rode `npm start`"],
    });

    expect(texto).toContain("CONCLUÍDO");
    expect(texto).toContain("o quê");
    expect(texto).toContain("custou");
    expect(texto).not.toContain("de quem");
  });
});
