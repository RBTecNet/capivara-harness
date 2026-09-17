/**
 * Desenho da capivara em meio-blocos.
 *
 * Duas linhas de pixel por linha de terminal: o pixel de cima vira a cor de
 * frente de `▀` e o de baixo vira a cor de fundo. Pixel transparente vira
 * espaço, para o fundo do terminal aparecer em vez de um retângulo azul-marinho
 * flutuando num terminal claro.
 *
 * Terminal sem cor verdadeira cai no mascote ASCII: a capivara em blocos ficaria
 * uma mancha marrom em 16 cores, e uma mancha é pior do que um desenho honesto.
 */

import { CAPYBARA_COLS, CAPYBARA_PIXELS, CAPYBARA_ROWS } from "./capybara-data.js";
import type { Style } from "./ansi.js";

export { CAPYBARA_COLS, CAPYBARA_ROWS };

const RESET = "\u001B[0m";
const UPPER_HALF = "\u2580";
const TRANSPARENT = "------";

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

function channel(hex: string, offset: number): number {
  return Number.parseInt(hex.slice(offset, offset + 2), 16);
}

function paintCell(top: string, bottom: string): string {
  const topClear = top === TRANSPARENT;
  const bottomClear = bottom === TRANSPARENT;

  if (topClear && bottomClear) return " ";

  if (bottomClear) {
    return `\u001B[38;2;${channel(top, 0)};${channel(top, 2)};${channel(top, 4)}m${UPPER_HALF}${RESET}`;
  }
  if (topClear) {
    // Só metade de baixo: o bloco inferior evita pintar o fundo inteiro.
    return `\u001B[38;2;${channel(bottom, 0)};${channel(bottom, 2)};${channel(bottom, 4)}m\u2584${RESET}`;
  }
  return (
    `\u001B[38;2;${channel(top, 0)};${channel(top, 2)};${channel(top, 4)}m` +
    `\u001B[48;2;${channel(bottom, 0)};${channel(bottom, 2)};${channel(bottom, 4)}m${UPPER_HALF}${RESET}`
  );
}

export interface CapybaraOptions {
  style: Style;
  /** Colunas de recuo à esquerda. */
  indent?: number;
  environment?: NodeJS.ProcessEnv;
}

export function renderCapybara(options: CapybaraOptions): string[] {
  const indent = " ".repeat(options.indent ?? 0);

  if (!options.style.enabled || !supportsTrueColor(options.environment)) {
    return CAPYBARA_ASCII.map((line) => `${indent}${line}`);
  }

  return CAPYBARA_PIXELS.map((row) => {
    let line = indent;
    for (let column = 0; column < CAPYBARA_COLS; column += 1) {
      const cell = row.slice(column * 12, column * 12 + 12);
      line += paintCell(cell.slice(0, 6), cell.slice(6, 12));
    }
    return line.replace(/\s+$/, "");
  });
}
