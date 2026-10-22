/**
 * O catálogo de modelos do BUILD (§131, complemento).
 *
 * No INIT, o wizard lista o que a API do MiniMax devolve — dez modelos. No
 * BUILD, pelo OpenCode, listava só os dois que o catálogo do OpenCode traz,
 * como se a API tivesse só esses. Agora a API é a referência, e o catálogo do
 * OpenCode diz quais o executor roda: o OpenCode 2.0.32 recusa modelo fora dele
 * ("Model unavailable") antes de qualquer requisição, e a interface compatível
 * com Anthropic, por onde ele fala com o MiniMax, a documentação do MiniMax
 * restringe a uma parte dos modelos. Os que não rodam aparecem, com o motivo, e
 * não são escolhidos da lista; digitar o nome continua valendo.
 */

import { describe, expect, it } from "vitest";
import { runWizard } from "../../src/commands/wizard.js";

/** O que a API do MiniMax devolve num cenário de dez modelos (fixture do teste; o produto não tem lista). */
const API_MINIMAX = ["MiniMax-M3.1-Flash", "MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M2.5",
  "MiniMax-M2.5-highspeed", "MiniMax-M2.1", "MiniMax-M2.1-highspeed", "MiniMax-M2", "MiniMax-M2-lite"];
/** O catálogo do OpenCode: dois do MiniMax, mais os de outros provedores e rotas. */
const OPENCODE = ["opencode/big-pickle", "minimax/MiniMax-M3.1-Flash", "minimax/MiniMax-M3", "minimax-coding-plan/MiniMax-M3", "deepseek/deepseek-flash"];
const EFFORTS: Record<string, string[]> = { "minimax/MiniMax-M3.1-Flash": ["low", "medium", "high", "xhigh", "max"], "minimax/MiniMax-M3": ["none", "thinking"] };

function roteiro(respostas: string[], catalogos: Record<string, string[]> = { minimax: API_MINIMAX, opencode: OPENCODE }) {
  const escrito: string[] = [];
  const consultados: string[] = [];
  const efforts: string[] = [];
  let posicao = 0;
  return {
    tela: () => escrito.join(""),
    consultados,
    efforts,
    deps: {
      io: { ask: async () => respostas[posicao++] ?? "", write: (text: string) => void escrito.push(text) },
      cwd: "/projeto",
      fileExists: async () => false,
      directoryExists: async () => true,
      configureApi: async () => true,
      listModels: async (provider: string) => { consultados.push(provider); return catalogos[provider] ?? []; },
      listEfforts: async (provider: string, model: string) => { efforts.push(`${provider}:${model}`); return EFFORTS[model] ?? null; },
    },
  };
}

/** O bloco do menu de modelos, como a tela o mostrou. */
const menuDeModelos = (tela: string): string => tela.split("(minimax via OpenCode)")[1]?.split("Escolha")[0] ?? "";

// pasta, build, minimax (API via OpenCode); depois: modelo, effort, sem ajuste por papel, serial, teste, ciclos, reparos, não executar
const BUILD_MINIMAX = ["", "3", "11"];
const DEPOIS_DO_EFFORT = ["n", "1", "", "", "", "n"];

describe("o BUILD lista o catálogo da API, e diz quais o executor roda", () => {
  it("os dez modelos da API aparecem; os que o OpenCode roda vêm primeiro, os outros com o motivo", async () => {
    const { deps, tela } = roteiro([...BUILD_MINIMAX, "1", "", ...DEPOIS_DO_EFFORT]);
    const result = await runWizard(deps);
    expect(result?.answers.global).toEqual({ provider: "opencode", model: "minimax/MiniMax-M3.1-Flash" });
    const menu = menuDeModelos(tela());
    for (const modelo of API_MINIMAX) expect(menu).toContain(`minimax/${modelo}`);
    expect(menu).toContain("1) minimax/MiniMax-M3.1-Flash (padrão)");
    expect(menu).toContain("2) minimax/MiniMax-M3\n");
    expect(menu).toContain("3) minimax/MiniMax-M2.7 — fora do catálogo do OpenCode: o executor não o roda");
    expect(menu).not.toContain("minimax-coding-plan");
  });

  it("escolher da lista um modelo que o executor não roda dá o diagnóstico e volta à escolha, sem inventar compatibilidade", async () => {
    const { deps, tela, efforts } = roteiro([...BUILD_MINIMAX, "3", "2", "2", ...DEPOIS_DO_EFFORT]);
    const result = await runWizard(deps);
    expect(result?.answers.global).toEqual({ provider: "opencode", model: "minimax/MiniMax-M3", effort: "thinking" });
    // A configuração de execução: o comando que o build recebe.
    expect(result?.argv.slice(0, 7)).toEqual(["build", "--provider", "opencode", "--model", "minimax/MiniMax-M3", "--effort", "thinking"]);
    expect(tela()).toContain("MiniMax-M2.7 está no catálogo da API minimax, mas não no do OpenCode");
    expect(tela()).toContain('o OpenCode recusa o modelo ("Model unavailable") antes de qualquer requisição');
    expect(tela()).toContain("API compatível com Anthropic, que a documentação do MiniMax restringe a uma parte dos modelos");
    // O effort é perguntado só para o modelo escolhido, pelas capacidades dele.
    expect(efforts).toEqual(["opencode:minimax/MiniMax-M3"]);
  });

  it("com a lista navegável, o mesmo: o diagnóstico, e a escolha volta", async () => {
    const { deps, tela } = roteiro([]);
    let tentativas = 0;
    const result = await runWizard({ ...deps, io: { ...deps.io, select: async (title, choices, defaultIndex) => {
      if (title.includes("O que você quer")) return choices.findIndex((c) => c.label === "build");
      if (title.includes("Qual provider")) return choices.findIndex((c) => c.label === "minimax");
      if (title.includes("minimax via OpenCode")) return tentativas++ === 0 ? choices.findIndex((c) => c.label === "minimax/MiniMax-M2.5") : 0;
      if (title.includes("Ajustar algum") || title.includes("Lembrar") || title.includes("Executar agora")) return choices.findIndex((c) => c.label === "não");
      return defaultIndex;
    } } });
    expect(tentativas).toBe(2);
    expect(tela()).toContain("MiniMax-M2.5 está no catálogo da API minimax");
    expect(result?.answers.global.model).toBe("minimax/MiniMax-M3.1-Flash");
  });

  it("digitar o nome continua valendo, como antes: quem digita assume o modelo", async () => {
    const { deps } = roteiro([...BUILD_MINIMAX, "MiniMax-M2.7", "", ...DEPOIS_DO_EFFORT]);
    const result = await runWizard(deps);
    expect(result?.answers.global.model).toBe("minimax/MiniMax-M2.7");
  });

  it("outro provider de API pelo OpenCode segue a mesma regra, sem o motivo que é só do MiniMax", async () => {
    const { deps, tela } = roteiro(["", "3", "10", "2", "1", ...DEPOIS_DO_EFFORT], { deepseek: ["deepseek-flash", "deepseek-novo"], opencode: OPENCODE });
    const result = await runWizard(deps);
    expect(tela()).toContain("deepseek-novo está no catálogo da API deepseek, mas não no do OpenCode");
    expect(tela()).not.toContain("API compatível com Anthropic");
    expect(result?.answers.global.model).toBe("deepseek/deepseek-flash");
  });

  it("sem resposta da API, a lista é a do OpenCode, como antes", async () => {
    const { deps, tela } = roteiro([...BUILD_MINIMAX, "1", "", ...DEPOIS_DO_EFFORT], { opencode: OPENCODE });
    const result = await runWizard(deps);
    expect(result?.answers.global.model).toBe("minimax/MiniMax-M3.1-Flash");
    expect(menuDeModelos(tela())).not.toContain("fora do catálogo");
  });

  it("sem resposta do OpenCode, não se sabe o que o executor roda: o nome é pedido, como antes", async () => {
    const { deps, tela } = roteiro([...BUILD_MINIMAX, "MiniMax-M3", "", ...DEPOIS_DO_EFFORT], { minimax: API_MINIMAX });
    const result = await runWizard(deps);
    expect(tela()).toContain("minimax não retornou uma lista de modelos");
    expect(result?.answers.global.model).toBe("minimax/MiniMax-M3");
  });
});

describe("o que não muda", () => {
  it("o INIT lista a API direta inteira, sem marca de executor", async () => {
    const { deps, tela, consultados } = roteiro(["", "1", "1", "uma agenda", ".", "11", "3", "", "n", "n"]);
    const result = await runWizard(deps);
    expect(result?.answers.global).toMatchObject({ provider: "minimax", model: "MiniMax-M2.7" });
    expect(consultados).toEqual(["minimax"]);
    expect(tela()).not.toContain("fora do catálogo");
  });

  it("CLI no BUILD continua perguntando só à própria CLI", async () => {
    const { deps, consultados } = roteiro(["", "3", "3", "1", "", ...DEPOIS_DO_EFFORT]);
    await runWizard(deps);
    expect(consultados).toEqual(["opencode"]);
  });
});
