/**
 * Como uma parada chega a quem está olhando.
 *
 * Duas camadas, na ordem em que servem: a telinha, para quem está no terminal e
 * quer ler o log sem procurar arquivo; e o texto puro, que é impresso DEPOIS de
 * a telinha fechar e fica no histórico do terminal para sempre.
 *
 * A ordem importa. A tela alternativa apaga tudo o que desenhou ao sair: se o
 * relatório saísse só lá dentro, fechar o modal apagaria a única explicação do
 * que aconteceu. O texto é o que sobrevive; o modal é conforto.
 */

import { abrirModal, type EntradaDeTeclado, type SaidaDeTela } from "./modal.js";
import { renderConclusao, renderParada, type Conclusao, type Parada } from "./parada.js";
import type { Style } from "./ansi.js";

export interface Janela {
  entrada: EntradaDeTeclado;
  saida: SaidaDeTela;
  style?: Style;
  /** Desliga a telinha; o texto puro continua saindo. */
  semModal?: boolean;
}

/** As linhas do relatório, sem as margens em branco que só servem ao terminal. */
function cabecalhoDe(texto: string): string[] {
  const linhas = texto.split("\n");
  while (linhas.length > 0 && linhas[0]!.trim() === "") linhas.shift();
  while (linhas.length > 0 && linhas.at(-1)!.trim() === "") linhas.pop();
  return linhas;
}

async function apresentar(texto: string, titulo: string, log: readonly string[], janela: Janela): Promise<boolean> {
  const style = janela.style ?? { enabled: false };
  let aberto = false;

  if (janela.semModal !== true && log.length > 0) {
    aberto = await abrirModal(
      { titulo, cabecalho: cabecalhoDe(texto), corpo: [...log] },
      { entrada: janela.entrada, saida: janela.saida, style },
    );
  }

  janela.saida.write(texto);
  return aberto;
}

export async function apresentarParada(parada: Parada, log: readonly string[], janela: Janela): Promise<boolean> {
  const style = janela.style ?? { enabled: false };
  return await apresentar(renderParada(parada, style), `PAROU · ${parada.natureza}`, log, janela);
}

export async function apresentarConclusao(conclusao: Conclusao, log: readonly string[], janela: Janela): Promise<boolean> {
  const style = janela.style ?? { enabled: false };
  return await apresentar(renderConclusao(conclusao, style), "CONCLUÍDO", log, janela);
}
