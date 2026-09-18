/**
 * Uma região de tela que se redesenha no lugar.
 *
 * O painel só pode ocupar a tela enquanto ninguém mais a está usando. Quando o
 * init pergunta alguma coisa, a região é SOLTA: o que estava desenhado vira
 * histórico e a pergunta imprime abaixo, sem disputa com o readline. Um painel
 * que se repinta por cima de um prompt de leitura come o que a pessoa digitou.
 *
 * Sem terminal — saída para arquivo, pipe, CI — a região não desenha nada. As
 * linhas de `announce` continuam sendo a saída, e é assim que um log continua
 * legível.
 */

export interface LiveRegion {
  /** Redesenha no lugar do desenho anterior. */
  draw: (text: string) => void;
  /** Esquece o que está desenhado: o próximo desenho não apaga isto. */
  release: () => void;
  readonly enabled: boolean;
}

const ESC = String.fromCharCode(27);
const cursorUp = (lines: number): string => `${ESC}[${lines}A`;
const CLEAR_BELOW = `${ESC}[0J`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;

export function createLiveRegion(write: (text: string) => void, enabled: boolean): LiveRegion {
  let desenhadas = 0;

  return {
    enabled,
    draw: (text) => {
      if (!enabled) return;
      const corpo = text.endsWith("\n") ? text : `${text}\n`;
      const subir = desenhadas > 0 ? cursorUp(desenhadas) : "";
      write(`${HIDE_CURSOR}${subir}${CLEAR_BELOW}${corpo}${SHOW_CURSOR}`);
      desenhadas = corpo.split("\n").length - 1;
    },
    release: () => {
      desenhadas = 0;
    },
  };
}
