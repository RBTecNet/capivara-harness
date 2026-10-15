import { describe, expect, it } from "vitest";
import { renderEscolhaNumerada } from "../../src/loop/escolha.js";
import { escolhaSemRepositorio, lerEscolhaDeRepositorio, renderSemRepositorio } from "../../src/loop/git.js";
import { prerequisiteChoice, readPrerequisiteChoice, renderPrerequisiteChoice } from "../../src/loop/prerequisites.js";

const missing = [{ technology: "PostgreSQL", binary: "psql", systemLevel: true, present: false, path: null }];

describe("escolha numerada", () => {
  it("o texto numerado sai da escolha como dado, com uma linha em branco antes das opções", () => {
    expect(renderEscolhaNumerada({ texto: ["Pergunta?"], opcoes: ["sim", "não"] })).toBe("Pergunta?\n\n  1) sim\n  2) não");
  });

  it("a lista e o texto numerado são a MESMA pergunta: cada número lido é a opção da posição", () => {
    const git = escolhaSemRepositorio();
    expect(renderSemRepositorio()).toBe(renderEscolhaNumerada(git));
    expect(git.opcoes.map((_, indice) => lerEscolhaDeRepositorio(String(indice + 1)))).toEqual(["criar", "verificar", "abortar"]);

    const pre = prerequisiteChoice(missing);
    expect(renderPrerequisiteChoice(missing)).toBe(renderEscolhaNumerada(pre));
    expect(pre.opcoes.map((_, indice) => readPrerequisiteChoice(String(indice + 1)))).toEqual(["instalar", "verificar", "abortar"]);
  });
});
