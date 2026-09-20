/**
 * A listagem de modelos, que existe para o wizard poder numerar em vez de exigir
 * que a pessoa saiba o identificador de cor.
 *
 * A regra que estes testes protegem é a de degradação: nada aqui pode derrubar
 * quem chamou. CLI ausente, desatualizada ou com formato novo devolve lista
 * vazia, e o wizard volta a pedir o nome digitado — que é o que ele fazia antes
 * de existir listagem.
 */

import { describe, expect, it } from "vitest";
import { CLAUDE_FAMILIES, MODEL_LISTINGS, listarModelos } from "../../src/provider/index.js";

describe("cada CLI separa identificador de descrição do seu jeito", () => {
  it("cursor: hífen cercado de espaço, e o cabeçalho não vira modelo", () => {
    const saida = ["Available models", "", "auto - Auto (default)", "gpt-5.3-codex-low - Codex 5.3 Low"].join("\n");
    expect(MODEL_LISTINGS.cursor?.parse(saida)).toEqual(["auto", "gpt-5.3-codex-low"]);
  });

  it("agy: tabulação, e a linha de progresso não vira modelo", () => {
    const saida = ["Fetching available models...", "gemini-3.8-flash-high\tGemini 3.8 Flash (High)"].join("\n");
    expect(MODEL_LISTINGS.agy?.parse(saida)).toEqual(["gemini-3.8-flash-high"]);
  });

  it("opencode: só o identificador, um por linha", () => {
    expect(MODEL_LISTINGS.opencode?.parse("opencode/big-pickle\nopencode-go/glm-5.2")).toEqual([
      "opencode/big-pickle",
      "opencode-go/glm-5.2",
    ]);
  });

  it("codex: JSON, e respeita o que a própria CLI marca como visível", () => {
    const saida = JSON.stringify({
      models: [
        { slug: "gpt-6-astra", visibility: "list" },
        { slug: "gpt-experimental", visibility: "hidden" },
      ],
    });
    expect(MODEL_LISTINGS.codex?.parse(saida)).toEqual(["gpt-6-astra"]);
  });

  it("claude: as famílias, porque a CLI resolve a versão sozinha", () => {
    expect(MODEL_LISTINGS.claude?.parse("")).toEqual(CLAUDE_FAMILIES);
    expect(CLAUDE_FAMILIES).toContain("opus");
    expect(CLAUDE_FAMILIES).toContain("haiku");
  });
});

describe("falhar aqui nunca derruba quem chamou", () => {
  it("provider que não sabe listar devolve vazio, não erro", async () => {
    expect(await listarModelos("openai")).toEqual([]);
    expect(await listarModelos("provider-que-nao-existe")).toEqual([]);
  });

  /*
   * O wizard lista TODOS os providers, inclusive os que não estão instalados —
   * saber que eles existem é útil. O que não pode é perguntar os modelos a uma
   * CLI ausente e esperar um erro de processo para descobrir o que `which` diria
   * na hora.
   */
  it("CLI ausente devolve vazio: não se pergunta a quem não está instalado", async () => {
    const semBinario = { CAPIVARA_CODEX_BIN: "/caminho/que/nao/existe/codex" } as NodeJS.ProcessEnv;
    expect(await listarModelos("codex", semBinario)).toEqual([]);
  });

  it("saída que não é o formato esperado devolve vazio, não lixo", () => {
    expect(MODEL_LISTINGS.codex?.parse("isto não é JSON")).toEqual([]);
    expect(MODEL_LISTINGS.cursor?.parse("erro: sessão expirada")).toEqual([]);
  });

  it("o claude responde sem precisar da CLI instalada: a lista é fixa", async () => {
    const semBinario = { CAPIVARA_CLAUDE_BIN: "/caminho/que/nao/existe" } as NodeJS.ProcessEnv;
    expect(await listarModelos("claude", semBinario)).toEqual(CLAUDE_FAMILIES);
  });
});
