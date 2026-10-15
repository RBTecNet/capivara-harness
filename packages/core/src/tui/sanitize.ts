/**
 * Texto de fora, pronto para ir ao terminal sem mandar nele.
 *
 * A saída de um agente é escrita por um modelo, e o modelo escreve o que
 * quiser — inclusive bytes que o terminal obedece: limpar a tela, mover o
 * cursor para cima do painel, trocar o título da janela, ligar o modo de
 * colagem, ou um OSC 52 que põe texto na área de transferência de quem está
 * olhando. Nada disso pode passar. O painel desenha com as cores DELE; o que
 * vem do agente chega como texto, e só texto.
 *
 * Regra única: sai toda sequência de escape (CSI, OSC, DCS, SOS, PM, APC e as
 * de dois bytes), todo controle C0 que não seja quebra de linha ou tabulação,
 * todo C1, e os controles de direção bidirecional — estes não mexem no
 * terminal, mas fazem uma linha parecer dizer outra coisa.
 */

const OSC = /\u001B\][\s\S]*?(?:\u0007|\u001B\\|$)/g;
const STRING_DE_CONTROLE = /\u001B[P^_X][\s\S]*?(?:\u001B\\|\u0007|$)/g;
const CSI = /\u001B\[[0-?]*[ -/]*[@-~]?/g;
const ESCAPE_CURTO = /\u001B[ -/]*[0-~]?/g;
const C0 = /[\u0000-\u0008\u000B-\u001F\u007F]/g;
const C1 = /[\u0080-\u009F]/g;
const BIDI = /[؜‎‏‪-‮⁦-⁩]/g;

/**
 * Uma linha (ou um pedaço dela) sem nada que o terminal interprete.
 *
 * O retorno de carro é tratado como o terminal trataria: barra de progresso
 * que se reescreve com `\r` vira a última versão da linha, e não uma linha que
 * apaga o que o painel desenhou à esquerda.
 */
export function sanitizarTerminal(texto: string): string {
  const semEscape = texto
    .replace(OSC, "")
    .replace(STRING_DE_CONTROLE, "")
    .replace(CSI, "")
    .replace(ESCAPE_CURTO, "");
  const linhas = semEscape.split("\n").map((linha) => {
    const semFimDeLinha = linha.endsWith("\r") ? linha.slice(0, -1) : linha;
    const ultimo = semFimDeLinha.lastIndexOf("\r");
    return ultimo === -1 ? semFimDeLinha : semFimDeLinha.slice(ultimo + 1);
  });
  return linhas.join("\n").replace(C0, "").replace(C1, "").replace(BIDI, "").replace(/\t/g, "    ");
}
