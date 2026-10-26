/**
 * O wizard lista todos os modelos que o codex aceita em `--model`.
 *
 * Só entravam os de `visibility === "list"`; os outros o codex aceita do mesmo
 * jeito, e nada na saída dele diz que os recusa. Agora vêm todos: primeiro os
 * que o seletor do codex mostra, depois os outros, com uma dica curta. A saída é
 * a real, de `codex debug models` (codex-cli 0.163.0).
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runWizard } from "../../src/commands/wizard.js";
import { MODEL_LISTINGS } from "../../src/provider/index.js";

const saida = await readFile(join(import.meta.dirname, "../fixtures/models/codex-debug-models.json"), "utf8");

function roteiro(respostas: string[]) {
  const escrito: string[] = [];
  let posicao = 0;
  return {
    tela: () => escrito.join(""),
    deps: {
      io: { ask: async () => respostas[posicao++] ?? "", write: (text: string) => void escrito.push(text) },
      cwd: "/projeto",
      fileExists: async () => false,
      directoryExists: async () => true,
      listModels: async (provider: string) => (provider === "codex" ? MODEL_LISTINGS.codex!.parse(saida) : []),
      listModelHints: async (provider: string) => (provider === "codex" ? MODEL_LISTINGS.codex!.dicas!(saida) : {}),
      listEfforts: async (provider: string, model: string) => (provider === "codex" ? MODEL_LISTINGS.codex!.efforts!(saida)[model] ?? null : null),
    },
  };
}

// pasta, build, codex; depois do modelo: effort padrão, sem ajuste por papel, serial, teste, ciclos, reparos, não executar
const BUILD_CODEX = ["", "3", "1"];
const DEPOIS_DO_MODELO = ["", "n", "1", "", "", "", "n"];

describe("o wizard lista todos os modelos do codex", () => {
  it("os sete do seletor vêm primeiro; os três escondidos vêm depois, com a dica, e podem ser escolhidos", async () => {
    const { deps, tela } = roteiro([...BUILD_CODEX, "9", ...DEPOIS_DO_MODELO]);
    const resultado = await runWizard(deps);

    expect(resultado?.answers.global.model).toBe("gpt-reserve");
    const menu = tela();
    expect(menu).toContain("1) gpt-6.1-sol (padrão)");
    expect(menu).toContain("7) gpt-5.6-luna\n");
    expect(menu).toContain("8) gpt-6-chat-thinking — o codex o esconde da própria lista");
    expect(menu).toContain("9) gpt-reserve — o codex o esconde da própria lista");
    expect(menu).toContain("10) codex-auto-review — o codex o esconde da própria lista");
  });
});
