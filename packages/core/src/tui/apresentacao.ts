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
 *
 * O que vai em cima e o que vai no meio também não é arbitrário. O cabeçalho é
 * FIXO, então nele cabem só as quatro respostas e o que fazer — a primeira
 * telinha de verdade levou junto um detalhe de quarenta linhas, que empurrou
 * para fora da tela exatamente o log que ela existia para mostrar.
 */

import { abrirModal, type EntradaDeTeclado, type SaidaDeTela } from "./modal.js";
import { linhasDaParada, renderConclusao, renderParada, type Conclusao, type Parada } from "./parada.js";
import { paint, type Style } from "./ansi.js";

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

/**
 * O corpo que rola: o que o gate devolveu, e depois o arquivo de evidência.
 *
 * Nesta ordem porque o detalhe é o resumo que o harness já escolheu — a cauda da
 * causa, os testes que falharam — e o log é o material bruto de onde ele saiu.
 * Quem abre a telinha quase sempre para de ler no primeiro.
 */
function corpoDaParada(parada: Parada, log: readonly string[], style: Style): string[] {
  const corpo: string[] = [];

  if (parada.detalhe && parada.detalhe.trim() !== "") {
    corpo.push(paint("o que veio", "gray", style), ...parada.detalhe.trimEnd().split("\n"));
  }

  if (log.length > 0) {
    if (corpo.length > 0) corpo.push("", "");
    corpo.push(paint(parada.evidencia?.[0] ?? "evidência", "gray", style), ...log);
  }

  return corpo;
}

export async function apresentarParada(parada: Parada, log: readonly string[], janela: Janela): Promise<boolean> {
  const style = janela.style ?? { enabled: false };
  const corpo = corpoDaParada(parada, log, style);
  let aberto = false;

  if (janela.semModal !== true && corpo.length > 0) {
    aberto = await abrirModal(
      {
        titulo: `PAROU · ${parada.natureza}`,
        // O detalhe fica de fora do topo: ele rola no corpo, logo abaixo.
        cabecalho: (largura) => linhasDaParada(parada, style, { largura, comDetalhe: false }),
        corpo,
      },
      { entrada: janela.entrada, saida: janela.saida, style },
    );
  }

  janela.saida.write(renderParada(parada, style));
  return aberto;
}

export async function apresentarConclusao(conclusao: Conclusao, log: readonly string[], janela: Janela): Promise<boolean> {
  const style = janela.style ?? { enabled: false };
  const texto = renderConclusao(conclusao, style);
  let aberto = false;

  if (janela.semModal !== true && log.length > 0) {
    aberto = await abrirModal(
      { titulo: "CONCLUÍDO", cabecalho: cabecalhoDe(texto), corpo: [...log] },
      { entrada: janela.entrada, saida: janela.saida, style },
    );
  }

  janela.saida.write(texto);
  return aberto;
}
