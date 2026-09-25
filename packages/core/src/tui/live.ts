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
  /**
   * Repinta sozinha enquanto nada acontece.
   *
   * Um painel que só se redesenha quando chega evento fica congelado durante
   * exatamente o momento em que alguém olha para ele em dúvida: a chamada de
   * modelo, que leva minutos. O relógio parado é indistinguível de um processo
   * morto. `beat` devolve o cancelamento.
   */
  beat: (render: () => string, intervalMilliseconds?: number) => () => void;
  /**
   * Cede a tela enquanto `durante` roda, e a retoma depois.
   *
   * Uma pergunta escrita abaixo do painel some no pulso seguinte: o redesenho
   * sobe as linhas do painel e apaga tudo dali para baixo — a pergunta inclusive.
   * No build isso deixou o preflight nove minutos numa tela sem pergunta, com o
   * processo esperando uma resposta que ninguém sabia que devia dar. Soltar a
   * região resolve a pergunta, mas `release` também para o pulso, e um build
   * inteiro com o relógio parado é indistinguível de um processo morto. Por isso
   * o pulso volta ao fim — mesmo se `durante` falhar.
   */
  suspend: <T>(durante: () => Promise<T>) => Promise<T>;
  readonly enabled: boolean;
}

const ESC = String.fromCharCode(27);
const cursorUp = (lines: number): string => `${ESC}[${lines}A`;
const CLEAR_BELOW = `${ESC}[0J`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;

export function createLiveRegion(
  write: (text: string) => void,
  enabled: boolean,
  dimensions?: () => { columns: number; rows: number },
): LiveRegion {
  let desenhadas = 0;
  let previous: { columns: number; rows: number } | undefined;
  let pulso: NodeJS.Timeout | null = null;
  let ritmo: { render: () => string; intervalMilliseconds: number } | null = null;

  const region: LiveRegion = {
    enabled,
    beat: (render, intervalMilliseconds = 1000) => {
      if (!enabled) return () => undefined;
      if (pulso) clearInterval(pulso);
      ritmo = { render, intervalMilliseconds };
      pulso = setInterval(() => region.draw(render()), intervalMilliseconds);
      // Sem `unref`, o intervalo seguraria o processo depois do trabalho pronto.
      pulso.unref();
      return () => {
        if (pulso) clearInterval(pulso);
        pulso = null;
        ritmo = null;
      };
    },
    suspend: async (durante) => {
      const pulsava = pulso !== null ? ritmo : null;
      if (pulso) clearInterval(pulso);
      pulso = null;
      desenhadas = 0;
      try {
        return await durante();
      } finally {
        if (pulsava) region.beat(pulsava.render, pulsava.intervalMilliseconds);
      }
    },
    draw: (text) => {
      if (!enabled) return;
      const corpo = text.endsWith("\n") ? text : `${text}\n`;
      const size = dimensions?.();
      // Depois de resize, o terminal pode ter refluído cada linha antiga.
      // A contagem anterior não identifica mais o começo do painel.
      const resized = desenhadas > 0 && previous && size && (previous.columns !== size.columns || previous.rows !== size.rows);
      const subir = resized ? `${ESC}[H${ESC}[2J` : desenhadas > 0 ? cursorUp(desenhadas) : "";
      write(`${HIDE_CURSOR}${subir}${CLEAR_BELOW}${corpo}${SHOW_CURSOR}`);
      desenhadas = Math.min(corpo.split("\n").length - 1, size ? Math.max(0, size.rows - 1) : Infinity);
      previous = size;
    },
    release: () => {
      if (pulso) {
        clearInterval(pulso);
        pulso = null;
      }
      desenhadas = 0;
    },
  };

  return region;
}
