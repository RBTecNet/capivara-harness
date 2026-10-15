/**
 * A capivara, uma por estágio.
 *
 * Cada estágio pode ter a sua; hoje todos usam a de capacete e chave, a única
 * que ficou legível no tamanho que o painel comporta. Os desenhos são saída do
 * chafa, gravada como texto em `mascots-data.ts` — o runtime não depende de
 * imagem. As tentativas descartadas estão em docs/mascote/LEIA.md.
 *
 * A versão anterior desenhava em meio-blocos a partir de um recorte reduzido por
 * média de área e reamostrado de novo no painel: duas reduções empilhadas, e o
 * resultado saía borrado e deformado. Meio-bloco tem dois pixels por célula; o
 * chafa escolhe, célula a célula, entre centenas de símbolos o que melhor cobre a
 * forma. Nada aqui reamostra: o desenho tem um tamanho só e aparece nele.
 *
 * Terminal sem cor verdadeira cai no mascote ASCII: em 16 cores o desenho viraria
 * uma mancha marrom, e uma mancha é pior do que um desenho honesto.
 */

import { MASCOT_ART } from "./mascots-data.js";
import type { Style } from "./ansi.js";

export type MascotStage = keyof typeof MASCOT_ART;

/** Mascote em ASCII, para quando não há cor verdadeira. */
export const CAPYBARA_ASCII: readonly string[] = [
  "       ___         ___",
  "      /   \\       /   \\",
  "     |     '-----'     |",
  "     |   --       --   |",
  "     |                 |",
  "     |    _________    |",
  "     |   /  .   .  \\   |",
  "      \\  \\_________/  /",
  "       '-------------'",
];

export function supportsTrueColor(environment: NodeJS.ProcessEnv = process.env): boolean {
  if (environment.CAPIVARA_ASCII_MASCOT === "1") return false;
  const declared = `${environment.COLORTERM ?? ""}`.toLowerCase();
  return declared.includes("truecolor") || declared.includes("24bit");
}

/**
 * O estágio cuja capivara aparece para um comando.
 *
 * `plan` e `build` têm a sua; os demais (`survey`, `change`, `prompt-engineer`)
 * abrem trabalho novo como o `init`, e ficam com a dele.
 */
export function mascotStage(command: string): MascotStage {
  return command === "plan" || command === "build" ? command : "init";
}

/** Colunas e linhas que o desenho colorido ocupa. */
export function mascotSize(stage: MascotStage): { columns: number; rows: number } {
  const lines = MASCOT_ART[stage].lines;
  return { columns: lines[0]!.replace(/\u001B\[[0-9;]*m/g, "").length, rows: lines.length };
}

export interface CapybaraOptions {
  style: Style;
  /** Qual capivara; ausente é a do `init`. */
  stage?: MascotStage;
  /** Colunas de recuo à esquerda. */
  indent?: number;
  environment?: NodeJS.ProcessEnv;
}

export function renderCapybara(options: CapybaraOptions): string[] {
  const indent = " ".repeat(options.indent ?? 0);

  if (!options.style.enabled || !supportsTrueColor(options.environment)) {
    return CAPYBARA_ASCII.map((line) => `${indent}${line}`);
  }
  return MASCOT_ART[options.stage ?? "init"].lines.map((line) => `${indent}${line}`);
}
