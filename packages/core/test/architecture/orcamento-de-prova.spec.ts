/**
 * O orçamento de prova (etapa 5 da redução).
 *
 * A Capivara não fica mais simples convencendo os modelos a trabalhar menos: o
 * Core é que exige menos deles. Este teste guarda o que a redução mediu — as
 * chamadas de modelo que o motor DISPARA, por papel, nos cenários da etapa 0 —
 * e falha quando uma mudança faz o motor pedir mais do que isso. Conta as
 * chamadas que chegaram aos provedores falsos, nunca o texto dos prompts: uma
 * checagem nova escondida numa chamada que já existia não aparece aqui, mas uma
 * chamada nova aparece sempre.
 *
 * Os tetos são os números do fim da etapa 4 (`scripts/medir-verificacao.mjs`
 * no commit 24b462e). Subir um teto é decisão de produto: a mudança que precisa
 * de mais verificação diz por quê, com a medida de antes e de depois.
 *
 * As garantias G-1 a G-4 continuam no catálogo (`test/integration/catalog.spec.ts`):
 * gastar menos nunca vale deixar de pegar o que elas pegam.
 */

import { rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  cenarioAppPequeno,
  cenarioOrcamentoEsgotado,
  cenarioReparo,
  garantiaG1,
  garantiaG2,
  garantiaG4,
  type ResultadoDoCenario,
} from "../support/cenarios-de-medicao.js";

/** As chamadas por papel: as do `init`+`plan` pelo agente falso, as do `build` pelo motor falso. */
interface PorPapel {
  escritor: number;
  auditor: number;
  verificadorDoPlano: number;
  executor: number;
  revisor: number;
  reparador: number;
  roteirista: number;
}

function porPapel(resultado: ResultadoDoCenario): PorPapel {
  const plano = resultado.observado.chamadasDoPlano;
  const build = resultado.observado.chamadasDoBuild;
  return {
    escritor: plano.filter((chamada) => chamada.role === "writer").length,
    auditor: plano.filter((chamada) => chamada.role === "auditor").length,
    verificadorDoPlano: plano.filter((chamada) => chamada.role === "verifier").length,
    executor: build.filter((chamada) => chamada.role === "builder").length,
    revisor: build.filter((chamada) => chamada.role === "verifier" && chamada.repair !== true && chamada.purpose === undefined).length,
    reparador: build.filter((chamada) => chamada.role === "verifier" && chamada.repair === true).length,
    roteirista: build.filter((chamada) => chamada.role === "verifier" && chamada.purpose === "flow-author").length,
  };
}

/** Medidos no fim da etapa 4. */
const TETOS: Record<string, PorPapel> = {
  "app-pequeno": { escritor: 7, auditor: 2, verificadorDoPlano: 0, executor: 4, revisor: 4, reparador: 0, roteirista: 2 },
  reparo: { escritor: 7, auditor: 2, verificadorDoPlano: 0, executor: 4, revisor: 4, reparador: 1, roteirista: 2 },
  "orcamento-esgotado": { escritor: 7, auditor: 2, verificadorDoPlano: 0, executor: 10, revisor: 2, reparador: 6, roteirista: 2 },
  g1: { escritor: 4, auditor: 2, verificadorDoPlano: 0, executor: 1, revisor: 1, reparador: 1, roteirista: 0 },
  g2: { escritor: 4, auditor: 2, verificadorDoPlano: 0, executor: 2, revisor: 1, reparador: 0, roteirista: 1 },
  g4: { escritor: 4, auditor: 2, verificadorDoPlano: 0, executor: 1, revisor: 1, reparador: 1, roteirista: 0 },
};

async function medir(cenario: () => Promise<ResultadoDoCenario>): Promise<{ nome: string; medido: PorPapel }> {
  const resultado = await cenario();
  try {
    return { nome: resultado.nome, medido: porPapel(resultado) };
  } finally {
    await rm(resultado.projectRoot, { recursive: true, force: true });
  }
}

const garantia = (funcao: () => Promise<{ cenario: ResultadoDoCenario }>) => async (): Promise<ResultadoDoCenario> => (await funcao()).cenario;

describe("o orçamento de prova: o motor não pede mais do que a redução mediu", () => {
  it.each([
    ["app-pequeno", cenarioAppPequeno],
    ["reparo", cenarioReparo],
    ["orcamento-esgotado", cenarioOrcamentoEsgotado],
    ["g1", garantia(garantiaG1)],
    ["g2", garantia(garantiaG2)],
    ["g4", garantia(garantiaG4)],
  ] as const)("%s: nenhum papel passa do teto", async (nome, cenario) => {
    const { medido } = await medir(cenario);
    const teto = TETOS[nome]!;
    const acima = (Object.keys(teto) as (keyof PorPapel)[]).filter((papel) => medido[papel] > teto[papel]);
    expect(acima, `medido ${JSON.stringify(medido)} · teto ${JSON.stringify(teto)}`).toEqual([]);
  });

  it("a revisão é uma por fase e nenhuma fase chama roteirista: o percurso dos fluxos é da aceitação final", async () => {
    const resultado = await cenarioAppPequeno();
    try {
      const build = resultado.observado.chamadasDoBuild;
      const fases = [...new Set(build.map((chamada) => chamada.phase.id))];
      for (const fase of fases) {
        expect(build.filter((chamada) => chamada.phase.id === fase && chamada.role === "verifier" && !chamada.repair && chamada.purpose === undefined), fase).toHaveLength(1);
      }
      // O roteirista roda depois da última sessão de fase: na aceitação, não no ciclo de uma fase.
      const ultimaDeFase = Math.max(...build.map((chamada, indice) => (chamada.purpose === undefined ? indice : -1)));
      const roteiristas = build.map((chamada, indice) => (chamada.purpose === "flow-author" ? indice : -1)).filter((indice) => indice >= 0);
      expect(roteiristas.length).toBeGreaterThan(0);
      expect(roteiristas.every((indice) => indice > ultimaDeFase)).toBe(true);
    } finally {
      await rm(resultado.projectRoot, { recursive: true, force: true });
    }
  });
});
