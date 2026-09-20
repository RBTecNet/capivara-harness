/**
 * A lista de fases do build.
 *
 * O painel mostrava a fase corrente e mais nada: num plano de sete fases, quem
 * olhava não sabia quantas faltavam nem em que gate a corrente estava parada —
 * e é no gate que a informação mora. "Escreveu mas a suíte reprovou" e "o engine
 * morreu" são diagnósticos opostos, e a tela dizia a mesma coisa para os dois.
 */

import { describe, expect, it } from "vitest";
import { emptyGates, phaseSummary, phaseWindow, renderPhaseRows, type BuildPhaseRow } from "../../src/tui/index.js";

const semCor = { enabled: false };

function fase(id: string, state: BuildPhaseRow["state"], detail = ""): BuildPhaseRow {
  return { id, title: `fase ${id}`, state, gates: emptyGates(), detail };
}

const seteFases = (executando: number): BuildPhaseRow[] =>
  Array.from({ length: 7 }, (_, index) =>
    fase(
      `P0${index + 1}`,
      index < executando ? "concluído" : index === executando ? "em andamento" : "aguardando",
    ),
  );

describe("a janela de fases", () => {
  it("cabendo tudo, mostra tudo", () => {
    const janela = phaseWindow(seteFases(2), 10);
    expect(janela.visible).toHaveLength(7);
    expect(janela.hiddenBefore).toBe(0);
    expect(janela.hiddenAfter).toBe(0);
  });

  /*
   * A prioridade é uma só: a fase em execução nunca some. O que sai primeiro
   * são as concluídas — elas já entregaram a informação que tinham.
   */
  it("não cabendo, a fase em execução fica, e as concluídas saem", () => {
    const janela = phaseWindow(seteFases(4), 3);
    expect(janela.visible.map((row) => row.id)).toEqual(["P05", "P06", "P07"]);
    expect(janela.hiddenBefore).toBe(4);
    expect(janela.hiddenAfter).toBe(0);
  });

  it("a janela sobe sozinha conforme o build anda", () => {
    const cedo = phaseWindow(seteFases(0), 3).visible.map((row) => row.id);
    const tarde = phaseWindow(seteFases(5), 3).visible.map((row) => row.id);
    expect(cedo).toEqual(["P01", "P02", "P03"]);
    expect(tarde).toEqual(["P05", "P06", "P07"]);
  });

  /*
   * Com a execução no fim da lista, ancorar no topo da janela deixaria espaço
   * vazio embaixo. A janela recua para encostar no fim.
   */
  it("na última fase, a janela recua em vez de deixar buraco", () => {
    const janela = phaseWindow(seteFases(6), 3);
    expect(janela.visible.map((row) => row.id)).toEqual(["P05", "P06", "P07"]);
    expect(janela.hiddenAfter).toBe(0);
  });

  it("sem nenhuma em execução, ancora na próxima por fazer", () => {
    const linhas = [fase("P01", "concluído"), fase("P02", "concluído"), fase("P03", "aguardando"), fase("P04", "aguardando")];
    expect(phaseWindow(linhas, 2).visible.map((row) => row.id)).toEqual(["P03", "P04"]);
  });

  it("build terminado mostra o desfecho, que está no fim", () => {
    const linhas = Array.from({ length: 5 }, (_, index) => fase(`P0${index + 1}`, "concluído"));
    expect(phaseWindow(linhas, 2).visible.map((row) => row.id)).toEqual(["P04", "P05"]);
  });

  it("uma fase que falhou e ficou para trás continua contada no resumo", () => {
    const linhas = [fase("P01", "falhou"), fase("P02", "em andamento"), fase("P03", "aguardando")];
    expect(phaseWindow(linhas, 1).visible.map((row) => row.id)).toEqual(["P02"]);
    expect(phaseSummary(linhas)).toContain("1 falhou");
  });

  it("sem espaço nenhum, não inventa linha", () => {
    expect(phaseWindow(seteFases(1), 0).visible).toEqual([]);
  });
});

describe("as bolinhas dizem em que gate a fase está", () => {
  const comGates = (gates: Partial<BuildPhaseRow["gates"]>): BuildPhaseRow => ({
    ...fase("P02", "em andamento", "ciclo 1/3"),
    gates: { ...emptyGates(), ...gates },
  });

  it("os quatro gates aparecem nomeados, na ordem", () => {
    const linha = renderPhaseRows([comGates({})], 5, 100, semCor)[0] ?? "";
    expect(linha.indexOf("G0")).toBeLessThan(linha.indexOf("G1"));
    expect(linha.indexOf("G2")).toBeLessThan(linha.indexOf("G3"));
  });

  it("o gate corrente e os já verdes se distinguem do que não começou", () => {
    const linha = renderPhaseRows([comGates({ G0: "verde", G1: "verde", G2: "corrente" })], 5, 100, semCor)[0] ?? "";
    // Sem cor, a forma ainda separa o que já teve veredito do que não teve.
    expect(linha).toContain("G2●");
    expect(linha).toContain("G3○");
  });

  it("gate reprovado é bolinha vermelha, e a fase inteira fica vermelha", () => {
    const comCor = { enabled: true };
    const linha = renderPhaseRows([{ ...comGates({ G0: "verde", G2: "vermelho" }), state: "falhou", detail: "gate 2 reprovou" }], 5, 100, comCor)[0] ?? "";
    expect(linha).toContain("[31m"); // vermelho
    expect(linha).toContain("[32m"); // o G0 verde continua verde
  });

  it("a linha diz quantas ficaram escondidas, em vez de simplesmente sumir com elas", () => {
    const desenhado = renderPhaseRows(seteFases(4), 3, 100, semCor).join("\n");
    expect(desenhado).toContain("4 fase(s) acima");
  });

  it("o título cede espaço num terminal estreito; o id e os gates não", () => {
    const longa: BuildPhaseRow = { ...fase("P01", "em andamento"), title: "Fundação do parser e validação de cron com testes unitários" };
    const linha = renderPhaseRows([longa], 5, 62, semCor)[0] ?? "";
    expect(linha).toContain("P01");
    expect(linha).toContain("G3○");
    expect(linha).not.toContain("testes unitários");
  });
});

const esc = String.fromCharCode(27);


/*
 * O corte arrancava todos os códigos ANSI. O efeito era silencioso e
 * sistemático: qualquer linha que passasse da largura perdia a cor inteira — e
 * no painel do build isso acertava exatamente a linha que mais precisava dela,
 * a da fase que falhou, porque a causa do erro é o texto mais longo da lista.
 */
describe("a linha que não cabe continua colorida", () => {
  const comCor = { enabled: true };

  it("a fase que falhou não fica cinza por ser a mais comprida", () => {
    const longa: BuildPhaseRow = {
      id: "P04",
      title: "Frontend: aba de geração por prompt com validação no servidor",
      state: "falhou",
      gates: { G0: "verde", G1: "verde", G2: "vermelho", G3: "aguardando", G4: "aguardando" },
      detail: "gate 2 — suíte do projeto reprovou em 7 testes",
    };
    const linha = renderPhaseRows([longa], 5, 70, comCor)[0] ?? "";
    expect(linha).toContain(`${esc}[31m`);
    expect(linha).toContain("…");
  });
});
