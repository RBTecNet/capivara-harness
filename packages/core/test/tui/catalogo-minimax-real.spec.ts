/**
 * O cruzamento da API do MiniMax com o catálogo do OpenCode, sobre as saídas reais.
 *
 * `minimax-api.json` é o que `listarModelos("minimax")` devolveu nesta máquina;
 * `opencode-model-list.json` é a saída de `opencode api model.list --standalone`
 * (OpenCode 2.0.32), com o mesmo ambiente que o wizard entrega a ele. O wizard
 * compara sem diferença de caixa, entrega ao OpenCode o identificador exato do
 * catálogo dele, e o que falta de verdade no catálogo continua sem poder ser
 * escolhido da lista.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runWizard } from "../../src/commands/wizard.js";
import { MODEL_LISTINGS } from "../../src/provider/index.js";

const fixture = (nome: string) => readFile(join(import.meta.dirname, "../fixtures/models", nome), "utf8");
const API = JSON.parse(await fixture("minimax-api.json")) as string[];
const bruto = await fixture("opencode-model-list.json");
const OPENCODE = MODEL_LISTINGS.opencode!.parse(bruto);
const EFFORTS = MODEL_LISTINGS.opencode!.efforts!(bruto);

function roteiro(respostas: string[], api: string[] = API) {
  const escrito: string[] = [];
  let posicao = 0;
  return {
    tela: () => escrito.join(""),
    deps: {
      io: { ask: async () => respostas[posicao++] ?? "", write: (text: string) => void escrito.push(text) },
      cwd: "/projeto",
      fileExists: async () => false,
      directoryExists: async () => true,
      configureApi: async () => true,
      listModels: async (provider: string) => (provider === "minimax" ? api : provider === "opencode" ? OPENCODE : []),
      listEfforts: async (_provider: string, model: string) => EFFORTS[model] ?? null,
    },
  };
}

const menuDeModelos = (tela: string): string => tela.split("(minimax via OpenCode)")[1]?.split("Escolha")[0] ?? "";
// pasta, build, minimax (API via OpenCode); depois do modelo: effort padrão, sem ajuste por papel, serial, teste, ciclos, reparos, não executar
const BUILD_MINIMAX = ["", "3", "11"];
const DEPOIS_DO_MODELO = ["", "n", "1", "", "", "", "n"];
const AUSENTES = ["MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M2.5", "MiniMax-M2.5-highspeed", "MiniMax-M2.1", "MiniMax-M2.1-highspeed", "MiniMax-M2"];

describe("o catálogo real do MiniMax, cruzado com o do OpenCode", () => {
  it("escolhíveis: MiniMax-M3.1-Flash e MiniMax-M3; bloqueados, com o motivo: os sete que nenhum providerID do MiniMax traz", async () => {
    const { deps, tela } = roteiro([...BUILD_MINIMAX, "2", ...DEPOIS_DO_MODELO]);
    const resultado = await runWizard(deps);

    expect(resultado?.answers.global).toMatchObject({ provider: "opencode", model: "minimax/MiniMax-M3" });
    const menu = menuDeModelos(tela());
    expect(menu).toContain("1) minimax/MiniMax-M3.1-Flash (padrão)");
    expect(menu).toContain("2) minimax/MiniMax-M3\n");
    AUSENTES.forEach((modelo, indice) => expect(menu).toContain(`${indice + 3}) minimax/${modelo} — fora do catálogo do OpenCode: o executor não o roda`));
    expect(menu).not.toContain("minimax-coding-plan");
  });

  it("escolher da lista um dos ausentes dá o motivo e volta à escolha", async () => {
    const { deps, tela } = roteiro([...BUILD_MINIMAX, "3", "1", ...DEPOIS_DO_MODELO]);
    const resultado = await runWizard(deps);

    expect(tela()).toContain('MiniMax-M2.7 está no catálogo da API minimax, mas não no do OpenCode');
    expect(resultado?.answers.global).toMatchObject({ provider: "opencode", model: "minimax/MiniMax-M3.1-Flash" });
  });

  it("a API com outra caixa casa com o catálogo, e o OpenCode recebe o identificador exato dele", async () => {
    const { deps, tela } = roteiro([...BUILD_MINIMAX, "2", ...DEPOIS_DO_MODELO], ["minimax-m3.1-flash", "MINIMAX-M3", "MiniMax-M2.7"]);
    const resultado = await runWizard(deps);

    expect(resultado?.answers.global).toMatchObject({ provider: "opencode", model: "minimax/MiniMax-M3" });
    const menu = menuDeModelos(tela());
    expect(menu).toContain("1) minimax/MiniMax-M3.1-Flash (padrão)");
    expect(menu).toContain("2) minimax/MiniMax-M3\n");
    expect(menu).not.toContain("minimax/minimax-m3.1-flash");
    expect(menu).not.toContain("minimax/MINIMAX-M3");
    expect(menu).toContain("3) minimax/MiniMax-M2.7 — fora do catálogo do OpenCode");
  });

  it("digitar outro nome continua valendo, como antes", async () => {
    const { deps } = roteiro([...BUILD_MINIMAX, "MiniMax-M2.7", ...DEPOIS_DO_MODELO]);
    const resultado = await runWizard(deps);
    expect(resultado?.answers.global).toMatchObject({ provider: "opencode", model: "minimax/MiniMax-M2.7" });
  });
});
