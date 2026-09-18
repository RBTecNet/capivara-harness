/**
 * Primitivas ANSI.
 *
 * Sem framework de UI: o produto tem uma dependência de runtime só, e uma TUI
 * própria é o que mantém isso verdade. Cor é desligada quando a saída não é um
 * terminal, para que log em arquivo e pipe não fiquem cheios de escape.
 */

export interface Style {
  enabled: boolean;
}

const CODES = {
  reset: "\u001B[0m",
  bold: "\u001B[1m",
  dim: "\u001B[2m",
  red: "\u001B[31m",
  green: "\u001B[32m",
  yellow: "\u001B[33m",
  blue: "\u001B[34m",
  magenta: "\u001B[35m",
  cyan: "\u001B[36m",
  gray: "\u001B[90m",
} as const;

export type Color = keyof typeof CODES;

export function supportsColor(stream: { isTTY?: boolean } = process.stdout, environment = process.env): boolean {
  if (environment.NO_COLOR !== undefined && environment.NO_COLOR !== "") return false;
  if (environment.CAPIVARA_COLOR === "always") return true;
  if (environment.CAPIVARA_COLOR === "never") return false;
  return stream.isTTY === true;
}

export function paint(value: string, color: Color, style: Style): string {
  if (!style.enabled) return value;
  return `${CODES[color]}${value}${CODES.reset}`;
}

/** Largura visível, ignorando escapes ANSI. */
export function visibleWidth(value: string): number {
  return value.replace(/\u001B\[[0-9;]*m/g, "").length;
}

export function padVisible(value: string, width: number): string {
  const missing = width - visibleWidth(value);
  return missing > 0 ? value + " ".repeat(missing) : value;
}

export function truncateVisible(value: string, width: number): string {
  if (visibleWidth(value) <= width) return value;
  const plain = value.replace(/\u001B\[[0-9;]*m/g, "");
  return `${plain.slice(0, Math.max(0, width - 1))}…`;
}

/**
 * Encurta um caminho pela ESQUERDA.
 *
 * O fim de um caminho é o que identifica o projeto; cortar pela direita esconde
 * exatamente a parte que a pessoa procura na tela.
 */
export function truncatePath(value: string, width: number): string {
  if (value.length <= width) return value;
  return `…${value.slice(-(width - 1))}`;
}

export const cursor = {
  hide: "\u001B[?25l",
  show: "\u001B[?25h",
  up: (lines: number) => (lines > 0 ? `\u001B[${lines}A` : ""),
  clearLine: "\u001B[2K",
};

/**
 * Pinta o fundo de um bloco inteiro.
 *
 * Fundo de terminal não se muda por bloco: o que existe é cor de fundo POR
 * CÉLULA, então cada linha é preenchida até a largura do painel e ganha a cor.
 * Sem esse preenchimento, o tom apareceria só atrás do texto e o resultado
 * seriam faixas irregulares em vez de um painel.
 *
 * O detalhe que faz funcionar: cada `reset` dentro da linha apaga TUDO, cor de
 * fundo inclusive. Por isso o fundo é reposto logo após cada um — do contrário o
 * tom morreria na primeira palavra colorida e voltaria o preto do terminal.
 */
export function tint(text: string, hex: string, width: number): string {
  const rgb = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!rgb) return text;

  const fundo = `\u001B[48;2;${parseInt(rgb[1] ?? "0", 16)};${parseInt(rgb[2] ?? "0", 16)};${parseInt(rgb[3] ?? "0", 16)}m`;
  const reset = "\u001B[0m";

  return text
    .split("\n")
    .map((line) => `${fundo}${line.split(reset).join(`${reset}${fundo}`)}${" ".repeat(Math.max(0, width - visibleWidth(line)))}${reset}`)
    .join("\n");
}

/** O aubergine do Ubuntu: escuro, mas com vermelho suficiente para não ser preto. */
export const UBUNTU_AUBERGINE = "#300A24";
