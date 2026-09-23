/**
 * A telinha que abre quando o harness pára.
 *
 * O relatório de parada responde ao "o quê"; o log responde ao "por quê", e ele
 * não cabe no terminal. Até aqui a saída rolava para fora da tela e a pessoa
 * tinha de achar o arquivo em `.capivara/runs/` para ler o que já tinha sido
 * impresso — por isso a evidência vive num modal com rolagem, e não numa
 * torrente de linhas.
 *
 * O cabeçalho é FIXO: as quatro respostas ficam à vista enquanto o log rola.
 * Rolar o log e perder de vista de quem era o defeito é o mesmo que não ter
 * respondido.
 *
 * Tudo aqui é função pura de (conteúdo, tamanho, deslocamento) para texto. A
 * interação — modo raw, tela alternativa, teclas — fica em `abrirModal`, e é
 * fina de propósito: o que precisa de teste é o desenho e a rolagem.
 */

import { padVisible, paint, truncateVisible, visibleWidth, type Style } from "./ansi.js";

export interface Modal {
  titulo: string;
  /** Fica parado no topo enquanto o corpo rola. */
  cabecalho: string[];
  /** O log. Rola. */
  corpo: string[];
  /** Substitui a dica padrão de teclas. */
  dica?: string;
}

export interface Tela {
  columns: number;
  rows: number;
}

const LARGURA_MAXIMA = 120;
const LARGURA_MINIMA = 40;

/** Quanto do corpo cabe, descontando moldura, cabeçalho, separador e rodapé. */
export function alturaDoCorpo(tela: Tela, cabecalho: number): number {
  const moldura = 2; // topo e base
  const rodape = 2; // separador + dica
  const disponivel = Math.min(tela.rows, Math.max(8, tela.rows)) - 2; // margem vertical
  return Math.max(1, disponivel - moldura - cabecalho - 1 - rodape);
}

export function larguraDoModal(tela: Tela): number {
  return Math.max(LARGURA_MINIMA, Math.min(LARGURA_MAXIMA, tela.columns - 4));
}

/**
 * Dobra linhas longas em vez de cortá-las.
 *
 * Log cortado à direita é log perdido: o caminho do arquivo que interessa está
 * quase sempre no fim da linha. Rolagem horizontal seria uma segunda dimensão de
 * navegação para aprender; dobrar não custa nada a quem lê.
 */
export function dobrar(linhas: readonly string[], largura: number): string[] {
  const saida: string[] = [];
  for (const linha of linhas) {
    for (const quebrada of quebrar(linha.replace(/\t/g, "    "), Math.max(8, largura))) saida.push(quebrada);
  }
  return saida.length > 0 ? saida : [""];
}

/**
 * Uma linha, dobrada na largura disponível.
 *
 * Quebra no espaço quando há um; no meio da palavra quando não há — um caminho
 * de arquivo de 300 caracteres não tem onde quebrar, e deixá-lo vazar
 * desalinharia a moldura inteira. A indentação da linha original é repetida na
 * continuação, para que a saída de teste dobrada continue parecendo saída de
 * teste.
 */
function quebrar(linha: string, largura: number): string[] {
  if (visibleWidth(linha) <= largura) return [linha];

  const indentacao = /^\s*/.exec(linha)?.[0] ?? "";
  const recuo = indentacao.length + 2 <= largura ? indentacao : "";
  const partes: string[] = [];
  let atual = "";
  let corrente = 0;
  let primeira = true;

  const disponivel = (): number => largura - (primeira ? 0 : recuo.length);
  const fechar = (): void => {
    partes.push(primeira ? atual : `${recuo}${atual}`);
    primeira = false;
    atual = "";
    corrente = 0;
  };

  for (let posicao = 0; posicao < linha.length; ) {
    // Escape ANSI atravessa sem ocupar largura: a cor da saída de um runner de
    // testes sobrevive à dobra.
    const escape = /^\u001B\[[0-9;]*m/.exec(linha.slice(posicao));
    if (escape) {
      atual += escape[0];
      posicao += escape[0].length;
      continue;
    }

    if (corrente >= disponivel()) {
      // Volta até o último espaço, se houver um razoavelmente perto do fim.
      const ultimoEspaco = atual.lastIndexOf(" ");
      if (ultimoEspaco > disponivel() / 2) {
        const sobra = atual.slice(ultimoEspaco + 1);
        atual = atual.slice(0, ultimoEspaco);
        fechar();
        atual = sobra;
        corrente = visibleWidth(sobra);
      } else fechar();
    }

    atual += linha[posicao];
    corrente += 1;
    posicao += 1;
  }

  if (atual !== "") fechar();
  return partes;
}

/**
 * O cabeçalho nunca come a tela inteira.
 *
 * Ele é fixo, e num terminal baixo — uma janela pequena, um `tmux` dividido, o
 * pty de 24 linhas de um wrapper — um relatório de doze linhas deixaria UMA
 * linha de log visível. Aí o modal deixa de ser um leitor de log e vira uma
 * moldura. Metade da altura é o teto; o que não couber continua no texto puro,
 * que sai logo abaixo.
 */
export function encolher(cabecalho: readonly string[], tela: Tela): string[] {
  const teto = Math.max(3, Math.floor((tela.rows - 7) / 2));
  if (cabecalho.length <= teto) return [...cabecalho];
  return [...cabecalho.slice(0, teto - 1), `… mais ${cabecalho.length - teto + 1} linha(s) do relatório, abaixo da telinha`];
}

/** O maior deslocamento que ainda mostra conteúdo. */
export function limiteDeRolagem(total: number, visiveis: number): number {
  return Math.max(0, total - visiveis);
}

export type Tecla =
  | "cima"
  | "baixo"
  | "pagina-acima"
  | "pagina-abaixo"
  | "topo"
  | "fim"
  | "sair"
  | "nenhuma";

/**
 * Traduz o que chegou do teclado.
 *
 * Setas e PgUp/PgDn chegam como sequências de escape; `q`, `j` e `k` existem
 * para quem tem o dedo em outro lugar. Enter e Esc fecham porque é o que a mão
 * faz sozinha quando a tela já foi lida.
 */
export function teclaDe(entrada: string): Tecla {
  switch (entrada) {
    case "\u001B[A":
    case "k":
      return "cima";
    case "\u001B[B":
    case "j":
      return "baixo";
    case "\u001B[5~":
    case "\u0002":
      return "pagina-acima";
    case "\u001B[6~":
    case " ":
    case "\u0006":
      return "pagina-abaixo";
    case "\u001B[H":
    case "\u001B[1~":
    case "g":
      return "topo";
    case "\u001B[F":
    case "\u001B[4~":
    case "G":
      return "fim";
    case "q":
    case "Q":
    case "\u001B":
    case "\r":
    case "\n":
    case "\u0003":
      return "sair";
    default:
      return "nenhuma";
  }
}

export function rolar(offset: number, tecla: Tecla, total: number, visiveis: number): number {
  const limite = limiteDeRolagem(total, visiveis);
  const salto = Math.max(1, visiveis - 1);
  const destino =
    tecla === "cima"
      ? offset - 1
      : tecla === "baixo"
        ? offset + 1
        : tecla === "pagina-acima"
          ? offset - salto
          : tecla === "pagina-abaixo"
            ? offset + salto
            : tecla === "topo"
              ? 0
              : tecla === "fim"
                ? limite
                : offset;
  return Math.min(limite, Math.max(0, destino));
}

/** A posição, dita em linhas — o que substitui a barra de rolagem. */
export function posicao(offset: number, visiveis: number, total: number): string {
  if (total <= visiveis) return `${total} linha(s)`;
  const primeira = offset + 1;
  const ultima = Math.min(total, offset + visiveis);
  const porcento = Math.round((offset / limiteDeRolagem(total, visiveis)) * 100);
  return `linha ${primeira}–${ultima} de ${total} · ${porcento}%`;
}

export interface Desenho {
  tela: Tela;
  offset: number;
  style?: Style;
}

/**
 * O modal inteiro, centrado, como texto pronto para escrever na tela.
 *
 * Devolve as linhas com a margem esquerda já aplicada; quem chama só precisa
 * juntar. Centrar por margem em vez de posicionar o cursor mantém isto testável
 * sem terminal nenhum.
 */
export function renderModal(modal: Modal, desenho: Desenho): string[] {
  const style = desenho.style ?? { enabled: false };
  const largura = larguraDoModal(desenho.tela);
  const interno = largura - 2;
  const cabecalho = encolher(dobrar(modal.cabecalho, interno - 2), desenho.tela);
  const visiveis = alturaDoCorpo(desenho.tela, cabecalho.length);
  const corpo = dobrar(modal.corpo, interno - 2);
  const offset = Math.min(limiteDeRolagem(corpo.length, visiveis), Math.max(0, desenho.offset));

  const margem = " ".repeat(Math.max(0, Math.floor((desenho.tela.columns - largura) / 2)));
  const linha = (conteudo: string): string =>
    `${margem}${paint("│", "cyan", style)} ${padVisible(truncateVisible(conteudo, interno - 2), interno - 2)} ${paint("│", "cyan", style)}`;

  const titulo = ` ${truncateVisible(modal.titulo, Math.max(0, interno - 4))} `;
  const topo = `${margem}${paint(`╭${titulo}${"─".repeat(Math.max(0, interno - visibleWidth(titulo)))}╮`, "cyan", style)}`;
  const separador = `${margem}${paint(`├${"─".repeat(interno)}┤`, "cyan", style)}`;
  const base = `${margem}${paint(`╰${"─".repeat(interno)}╯`, "cyan", style)}`;

  /*
   * A dica encolhe antes de a posição sumir.
   *
   * Numa janela de 80 colunas as duas não cabem juntas, e quem está rolando
   * precisa mais de saber onde está do que de reler quais são as teclas.
   */
  const onde = posicao(offset, visiveis, corpo.length);
  const disponivel = interno - 3 - visibleWidth(onde);
  const dica =
    modal.dica ??
    ["↑ ↓ rola · PgUp PgDn página · g topo · G fim · q fecha", "↑ ↓ PgUp PgDn · q fecha", "q fecha", ""].find(
      (opcao) => visibleWidth(opcao) <= disponivel,
    ) ??
    "";
  const rodape = `${dica}${" ".repeat(Math.max(1, interno - 2 - visibleWidth(dica) - visibleWidth(onde)))}${onde}`;

  const janela = corpo.slice(offset, offset + visiveis);
  while (janela.length < visiveis) janela.push("");

  return [
    topo,
    ...cabecalho.map(linha),
    separador,
    ...janela.map(linha),
    separador,
    linha(paint(rodape, "gray", style)),
    base,
  ];
}

const ESC = String.fromCharCode(27);
const TELA_ALTERNATIVA = `${ESC}[?1049h`;
const TELA_NORMAL = `${ESC}[?1049l`;
const ESCONDE_CURSOR = `${ESC}[?25l`;
const MOSTRA_CURSOR = `${ESC}[?25h`;
const LIMPA = `${ESC}[2J${ESC}[H`;

export interface EntradaDeTeclado {
  isTTY?: boolean;
  setRawMode?: (raw: boolean) => void;
  resume: () => void;
  pause: () => void;
  on: (evento: "data", ouvinte: (chunk: Buffer | string) => void) => void;
  off: (evento: "data", ouvinte: (chunk: Buffer | string) => void) => void;
}

export interface SaidaDeTela {
  isTTY?: boolean;
  columns?: number;
  rows?: number;
  write: (texto: string) => unknown;
  on?: (evento: "resize", ouvinte: () => void) => void;
  off?: (evento: "resize", ouvinte: () => void) => void;
}

/**
 * Abre o modal e devolve quando a pessoa fecha.
 *
 * Sem terminal — pipe, CI, `ssh` sem tty — não abre nada e devolve `false`: quem
 * chama imprime o texto puro, que é o piso e nunca deixa de existir. Um harness
 * que depende de tela interativa para contar o que aconteceu é um harness que
 * não se pode rodar em CI.
 *
 * A tela é SEMPRE restaurada: `finally` desfaz modo raw, cursor e tela
 * alternativa mesmo se o desenho quebrar no meio. Terminal deixado em raw mode é
 * um terminal que a pessoa fecha na mão.
 */
export async function abrirModal(
  modal: Modal,
  io: { entrada: EntradaDeTeclado; saida: SaidaDeTela; style?: Style },
): Promise<boolean> {
  const { entrada, saida } = io;
  if (entrada.isTTY !== true || saida.isTTY !== true || typeof entrada.setRawMode !== "function") return false;

  let offset = 0;
  const tela = (): Tela => ({ columns: saida.columns ?? 80, rows: saida.rows ?? 24 });
  const pintar = (): void => {
    const linhas = renderModal(modal, { tela: tela(), offset, ...(io.style ? { style: io.style } : {}) });
    const alturaLivre = Math.max(0, tela().rows - linhas.length);
    const topo = "\n".repeat(Math.floor(alturaLivre / 2));
    saida.write(`${LIMPA}${topo}${linhas.join("\n")}`);
  };

  const redimensionou = (): void => pintar();

  saida.write(`${TELA_ALTERNATIVA}${ESCONDE_CURSOR}`);
  entrada.setRawMode(true);
  entrada.resume();
  saida.on?.("resize", redimensionou);

  try {
    pintar();
    await new Promise<void>((resolve) => {
      const ouvir = (chunk: Buffer | string): void => {
        const texto = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        const tecla = teclaDe(texto);
        if (tecla === "sair") {
          entrada.off("data", ouvir);
          resolve();
          return;
        }
        if (tecla === "nenhuma") return;

        const largura = larguraDoModal(tela()) - 4;
        const visiveis = alturaDoCorpo(tela(), dobrar(modal.cabecalho, largura).length);
        const total = dobrar(modal.corpo, largura).length;
        const novo = rolar(offset, tecla, total, visiveis);
        if (novo !== offset) {
          offset = novo;
          pintar();
        }
      };
      entrada.on("data", ouvir);
    });
  } finally {
    saida.off?.("resize", redimensionou);
    entrada.setRawMode(false);
    entrada.pause();
    saida.write(`${MOSTRA_CURSOR}${TELA_NORMAL}`);
  }

  return true;
}
