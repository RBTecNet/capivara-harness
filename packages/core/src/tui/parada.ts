/**
 * O relatório de parada.
 *
 * Toda vez que o harness pára, alguém precisa descobrir por quê — e hoje isso
 * significa abrir `.capivara/`, ler `events.tsv`, comparar sha de fase, às vezes
 * rodar `cat -A` num log. A informação sempre esteve lá; a mensagem é que não
 * dizia.
 *
 * O padrão nasceu de uma noite inteira de diagnóstico manual, e cada campo
 * existe porque a falta dele custou tempo:
 *
 * | campo | a pergunta que ele responde | o que custou não tê-lo |
 * |---|---|---|
 * | o quê | o que aconteceu, em uma linha | "saída inválida" sem dizer o que veio |
 * | de quem | ambiente, produto, modelo ou nosso | executor mandado consertar o que não quebrou |
 * | custou | quantas sessões se foram | pânico de "perdi o run" quando nada se perdeu |
 * | evidência | onde está a prova | meia hora procurando o log certo |
 * | para seguir | o que fazer e como retomar | achar que quebrou quando era só continuar |
 *
 * `custou` é o campo que mais muda a leitura, e o menos óbvio: "nenhuma sessão
 * gasta" é uma informação completamente diferente de "parou", e é a diferença
 * entre fechar o terminal com raiva e resolver em trinta segundos.
 */

import { paint, padVisible, visibleWidth, type Style } from "./ansi.js";

/**
 * De quem é o defeito.
 *
 * É a mesma pergunta do §34.8, promovida a campo obrigatório: toda causa que o
 * harness devolve precisa dizer de quem ela é, porque a resposta muda quem vai
 * trabalhar em seguida.
 */
export type NaturezaDaParada = "ambiente" | "produto" | "modelo" | "harness" | "decisão";

const DE_QUEM: Record<NaturezaDaParada, string> = {
  ambiente: "do ambiente desta máquina; seu código não foi tocado",
  produto: "do código que está sendo construído",
  modelo: "da sessão do modelo, não do que já estava escrito",
  harness: "nosso — do harness, não do seu projeto",
  decisão: "de ninguém: falta uma decisão que só você pode tomar",
};

const TITULO: Record<NaturezaDaParada, string> = {
  ambiente: "PAROU — dependência de ambiente",
  produto: "PAROU — o produto não passou",
  modelo: "PAROU — a sessão do modelo não entregou",
  harness: "PAROU — defeito do harness",
  decisão: "PAROU — esperando uma decisão sua",
};

const TOM: Record<NaturezaDaParada, "yellow" | "red" | "cyan"> = {
  ambiente: "yellow",
  produto: "red",
  modelo: "yellow",
  harness: "red",
  decisão: "cyan",
};

export interface Parada {
  natureza: NaturezaDaParada;
  /** O que aconteceu, em uma linha. */
  oQue: string;
  /**
   * O que já foi gasto e o que foi preservado.
   *
   * Sempre preenchido, inclusive quando nada foi gasto — principalmente quando
   * nada foi gasto.
   */
  custou: string;
  /** Caminhos que provam. Vazio é aceitável; inventar não. */
  evidencia?: string[];
  /** Passos numerados. O último costuma ser o comando que retoma. */
  paraSeguir: string[];
  /** Detalhe longo — saída de comando, stack, diff. Vai para o rodapé. */
  detalhe?: string;
  /** Sobrescreve a frase padrão de responsabilidade, quando há o que precisar. */
  deQuem?: string;
}

const ROTULOS = ["o quê", "de quem", "custou", "evidência"] as const;
const COLUNA = Math.max(...ROTULOS.map((rotulo) => visibleWidth(rotulo)));
/** Onde o VALOR começa: dois de margem, o rótulo, dois de separação. */
const RECUO = 2 + COLUNA + 2;

/**
 * Quebra o valor pendurado sob ele mesmo, e não sob o rótulo.
 *
 * Sem isto, a segunda linha de um `o quê` longo começa na coluna do rótulo e a
 * tabela deixa de ser tabela — foi assim que a primeira telinha de verdade
 * saiu, com "contra o produto de pé em…" alinhado com "de quem".
 *
 * `largura` ausente não quebra nada: no terminal puro quem dobra é o terminal,
 * e forçar uma largura ali cortaria o texto de quem tem a janela maior.
 */
function campo(rotulo: string, valor: string, style: Style, largura?: number): string[] {
  const etiqueta = `  ${paint(padVisible(rotulo, COLUNA), "gray", style)}  `;
  if (largura === undefined || largura - RECUO < 20) return [`${etiqueta}${valor}`];

  const [primeira, ...resto] = dobrarTexto(valor, largura - RECUO);
  return [`${etiqueta}${primeira ?? ""}`, ...resto.map((linha) => `${" ".repeat(RECUO)}${linha}`)];
}

/** Dobra em espaço; palavra maior que a largura desce inteira, sem cortar. */
function dobrarTexto(texto: string, largura: number): string[] {
  const linhas: string[] = [];
  let atual = "";

  for (const palavra of texto.split(/\s+/).filter((parte) => parte !== "")) {
    if (atual === "") atual = palavra;
    else if (visibleWidth(atual) + 1 + visibleWidth(palavra) <= largura) atual += ` ${palavra}`;
    else {
      linhas.push(atual);
      atual = palavra;
    }
  }
  if (atual !== "") linhas.push(atual);
  return linhas.length > 0 ? linhas : [""];
}

export interface FormaDoRelatorio {
  /** Onde quebrar. Ausente deixa o terminal dobrar, que é o certo no texto puro. */
  largura?: number;
  /**
   * O detalhe entra?
   *
   * Na telinha, NÃO: o cabeçalho é fixo, e um detalhe de quarenta linhas empurra
   * para fora exatamente o log que a telinha existe para mostrar. Lá ele desce
   * para o corpo, que rola. No texto puro entra sempre — ali não há o que rolar,
   * e o que não estiver escrito se perde.
   */
  comDetalhe?: boolean;
}

/** As linhas do relatório, sem as margens em branco. É o que a telinha fixa no topo. */
export function linhasDaParada(parada: Parada, style: Style, forma: FormaDoRelatorio = {}): string[] {
  const linhas: string[] = [paint(TITULO[parada.natureza], TOM[parada.natureza], style), ""];

  linhas.push(...campo("o quê", parada.oQue, style, forma.largura));
  linhas.push(...campo("de quem", parada.deQuem ?? DE_QUEM[parada.natureza], style, forma.largura));
  linhas.push(...campo("custou", parada.custou, style, forma.largura));

  const evidencias = parada.evidencia ?? [];
  for (const [indice, caminho] of evidencias.entries()) {
    linhas.push(...campo(indice === 0 ? "evidência" : "", caminho, style, forma.largura));
  }

  if (parada.paraSeguir.length > 0) {
    linhas.push("", `  ${paint("para seguir", "gray", style)}`);
    for (const [indice, passo] of parada.paraSeguir.entries()) {
      // A continuação alinha sob o TEXTO, não sob o número.
      const partes = forma.largura === undefined ? passo.split("\n") : passo.split("\n").flatMap((parte) => dobrarTexto(parte, Math.max(20, forma.largura! - 7)));
      const [primeira, ...resto] = partes;
      linhas.push(`    ${indice + 1}. ${primeira ?? ""}`);
      for (const continuacao of resto) linhas.push(`       ${continuacao}`);
    }
  }

  if (forma.comDetalhe !== false && parada.detalhe && parada.detalhe.trim() !== "") {
    linhas.push("", `  ${paint("o que veio", "gray", style)}`, ...parada.detalhe.trimEnd().split("\n").map((linha) => `    ${linha}`));
  }

  return linhas;
}

/**
 * O relatório, em texto.
 *
 * Texto puro de propósito: é o piso, e precisa servir a terminal sem cor, a
 * `ssh` sem TTY, a arquivo de log e a pipe. O modal e o visualizador desenham a
 * MESMA estrutura com mais enfeite — e não acrescentam informação nenhuma, para
 * que ninguém precise abrir uma tela para entender o que já está aqui.
 */
export function renderParada(parada: Parada, style: Style = { enabled: false }): string {
  return `\n${linhasDaParada(parada, style).join("\n")}\n`;
}

/**
 * O relatório de quem terminou bem.
 *
 * Existe pelo mesmo motivo do outro: hoje o build que fecha não diz o que fez,
 * e quem volta ao terminal de manhã não sabe se as oito fases fecharam ou se
 * parou na terceira. O formato é o mesmo, sem "de quem" — não há defeito de
 * ninguém a atribuir.
 */
export interface Conclusao {
  oQue: string;
  custou: string;
  evidencia?: string[];
  paraSeguir?: string[];
}

export function renderConclusao(conclusao: Conclusao, style: Style = { enabled: false }): string {
  const linhas: string[] = ["", paint("CONCLUÍDO", "green", style), ""];
  linhas.push(...campo("o quê", conclusao.oQue, style));
  linhas.push(...campo("custou", conclusao.custou, style));

  for (const [indice, caminho] of (conclusao.evidencia ?? []).entries()) {
    linhas.push(...campo(indice === 0 ? "evidência" : "", caminho, style));
  }

  if (conclusao.paraSeguir && conclusao.paraSeguir.length > 0) {
    linhas.push("", `  ${paint("para seguir", "gray", style)}`);
    for (const [indice, passo] of conclusao.paraSeguir.entries()) linhas.push(`    ${indice + 1}. ${passo}`);
  }

  return `${linhas.join("\n")}\n`;
}
