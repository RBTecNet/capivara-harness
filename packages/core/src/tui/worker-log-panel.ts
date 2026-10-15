/**
 * O log de um agente do build paralelo, aberto por cima do painel.
 *
 * Responde ao que a caixa AGENTES não tem espaço para dizer: o que ESTE agente
 * está escrevendo agora, há quanto tempo, e o que o escalonador fez com ele. O
 * build segue por trás — abrir, rolar e fechar o log não toca no loop.
 *
 * Duas áreas, e o foco passa de uma à outra com Tab: a SAÍDA (stdout e stderr
 * da sessão, ao vivo, já sanitizada) e os EVENTOS (o que o loop contou, em
 * eventos estruturados). PgUp/PgDn e as setas rolam a área com foco. F liga e
 * desliga o "seguir o fim" da saída: seguindo, o que chega aparece; rolando
 * para cima, a saída para onde a pessoa está lendo, e o título diz quantas
 * linhas novas chegaram embaixo. ← → trocam de agente, Esc fecha.
 *
 * Tudo aqui é função pura de (conteúdo, estado, tamanho) para texto, e de
 * (estado, tecla) para estado. Quem liga isto ao terminal só entrega as teclas e
 * redesenha.
 */

import { paint, padVisible, truncateVisible, type Style } from "./ansi.js";
import type { BuildPhaseRow } from "./build-phases.js";
import type { WorkerRow } from "./build-workers.js";
import { box } from "./dashboard.js";
import type { Key } from "./keys.js";
import { dobrar } from "./modal.js";
import type { EventoDoAgente, LinhaDeLog } from "./worker-logs.js";

export type AreaDoPainel = "saida" | "eventos";

export interface EstadoDoPainel {
  slot: number;
  foco: AreaDoPainel;
  /** Seguindo o fim da saída: o que chega aparece sem ninguém rolar. */
  seguir: boolean;
  /** A primeira linha visível de cada área, já dobrada. */
  topo: Record<AreaDoPainel, number>;
}

export function abrirPainel(slot: number): EstadoDoPainel {
  return { slot, foco: "saida", seguir: true, topo: { saida: 0, eventos: Number.MAX_SAFE_INTEGER } };
}

export interface ConteudoDoPainel {
  agente: WorkerRow;
  /** A fase em que o agente está, quando está em alguma. */
  fase?: BuildPhaseRow;
  linhas: readonly LinhaDeLog[];
  descartadas: number;
  eventos: readonly EventoDoAgente[];
  /** Agora, em ms: os tempos decorridos são calculados aqui, nunca estimados. */
  agora: number;
  /** Quando a chamada corrente começou; nulo quando o agente não está chamando ninguém. */
  inicioDaChamada: number | null;
  /** Onde o log completo está gravado; nulo enquanto o run não tem pasta. */
  arquivo: string | null;
  totalDeAgentes: number;
  buildTerminou: boolean;
}

export interface Tela {
  columns: number;
  rows: number;
}

export interface Desenho {
  linhas: string[];
  /** O que a rolagem precisa saber da última vez que se desenhou. */
  medidas: Medidas;
}

export interface Medidas {
  saida: { total: number; visiveis: number };
  eventos: { total: number; visiveis: number };
}

function duracao(ms: number): string {
  const segundos = Math.max(0, Math.floor(ms / 1000));
  const horas = Math.floor(segundos / 3600);
  const minutos = Math.floor((segundos % 3600) / 60);
  const resto = segundos % 60;
  if (horas > 0) return `${horas}h${String(minutos).padStart(2, "0")}m`;
  if (minutos > 0) return `${minutos}m${String(resto).padStart(2, "0")}s`;
  return `${resto}s`;
}

function limitar(topo: number, total: number, visiveis: number): number {
  return Math.max(0, Math.min(topo, Math.max(0, total - visiveis)));
}

/** A altura de cada área, cabendo na tela; os eventos somem antes da saída. */
function alturas(tela: Tela, cabecalho: number): { saida: number; eventos: number } {
  // moldura do cabeçalho (2) + moldura da saída (2) + rodapé (1)
  const livre = Math.max(1, tela.rows - cabecalho - 2 - 2 - 1);
  if (tela.rows < 14 || livre < 6) return { saida: livre, eventos: 0 };
  const eventos = Math.min(8, Math.max(2, Math.floor(livre * 0.3)));
  // moldura dos eventos (2)
  return { saida: Math.max(1, livre - eventos - 2), eventos };
}

export function renderPainelDoAgente(conteudo: ConteudoDoPainel, estado: EstadoDoPainel, tela: Tela, style: Style): Desenho {
  const largura = Math.max(20, tela.columns);
  const dentro = largura - 2;
  const estreita = largura < 70;
  const { agente, fase } = conteudo;

  const estadoDoAgente =
    agente.phaseId === null
      ? `${agente.state}${agente.detail ? ` · último: ${agente.detail}` : ""}`
      : `${agente.state} · ${agente.phaseId}${fase ? ` ${fase.title}` : ""}${fase?.detail && fase.detail !== fase.state ? ` · ${fase.detail}` : ""}`;
  const tempos = [
    agente.since !== null ? `na fase há ${duracao(conteudo.agora - agente.since)}` : "sem fase",
    conteudo.inicioDaChamada !== null ? `chamada corrente há ${duracao(conteudo.agora - conteudo.inicioDaChamada)}` : "nenhuma chamada em andamento",
  ].join(" · ");
  const rotulo = (texto: string): string => paint(padVisible(texto, estreita ? 7 : 9), "cyan", style);
  const cabecalho = [
    `${rotulo("estado")}${estadoDoAgente}`,
    `${rotulo("tempo")}${tempos}`,
    ...(conteudo.arquivo ? [`${rotulo("arquivo")}${conteudo.arquivo}`] : []),
  ].map((linha) => truncateVisible(linha, dentro));

  const altura = alturas(tela, cabecalho.length);

  // A saída, dobrada na largura: nada vaza da moldura.
  const corDaFonte = { out: null, err: "yellow", harness: "cyan" } as const;
  const saida: string[] = [];
  for (const linha of conteudo.linhas) {
    for (const pedaco of dobrar([linha.texto], dentro - 1)) {
      const cor = corDaFonte[linha.fonte];
      saida.push(cor ? paint(pedaco, cor, style) : pedaco);
    }
  }
  const topoDaSaida = estado.seguir ? Math.max(0, saida.length - altura.saida) : limitar(estado.topo.saida, saida.length, altura.saida);
  const visivelSaida = saida.slice(topoDaSaida, topoDaSaida + altura.saida);
  const abaixo = Math.max(0, saida.length - topoDaSaida - altura.saida);

  const eventos = dobrar(
    conteudo.eventos.map((evento) => `[${evento.hora}] ${evento.texto}`),
    dentro - 1,
  ).filter((linha, indice, todas) => !(todas.length === 1 && linha === ""));
  const topoDosEventos = limitar(estado.topo.eventos, eventos.length, altura.eventos);
  const visivelEventos = eventos.slice(topoDosEventos, topoDosEventos + altura.eventos);

  const marcaDoFoco = (area: AreaDoPainel): string => (estado.foco === area ? paint("▸ ", "cyan", style) : "");
  const tituloDaSaida = [
    `${marcaDoFoco("saida")}SAÍDA`,
    estado.seguir ? "seguindo o fim" : abaixo > 0 ? `parada · ${abaixo} linha(s) abaixo` : "parada",
    saida.length > 0 ? `${topoDaSaida + 1}–${topoDaSaida + visivelSaida.length} de ${saida.length}` : "vazia",
    ...(conteudo.descartadas > 0 ? [`${conteudo.descartadas} mais antiga(s) só no arquivo`] : []),
  ].join(" · ");

  const vazio = paint(
    conteudo.linhas.length === 0 ? "este agente ainda não escreveu nada" : "",
    "gray",
    style,
  );
  const preencher = (linhas: string[], quantas: number): string[] => [...linhas, ...Array.from({ length: Math.max(0, quantas - linhas.length) }, () => "")];

  const linhas = [
    ...box(`AGENTE ${agente.slot + 1} de ${conteudo.totalDeAgentes} · ${agente.label}`, cabecalho, largura, style),
    ...box(truncateVisible(tituloDaSaida, dentro - 4), preencher(visivelSaida.length > 0 ? visivelSaida : [vazio], altura.saida), largura, style),
    ...(altura.eventos > 0
      ? box(
          `${marcaDoFoco("eventos")}EVENTOS DO ESCALONADOR${eventos.length > 0 ? ` · ${eventos.length}` : ""}`,
          preencher(visivelEventos.length > 0 ? visivelEventos : [paint("nenhum evento ainda", "gray", style)], altura.eventos),
          largura,
          style,
        )
      : []),
    truncateVisible(
      paint(
        conteudo.buildTerminou
          ? " o build terminou · Esc mostra o resultado"
          : estreita
            ? " Esc fecha · Tab área · PgUp/PgDn · F segue · ← → agente"
            : " Esc fecha (o build segue) · Tab troca a área · ↑ ↓ PgUp PgDn rolam · F segue o fim · ← → outro agente",
        conteudo.buildTerminou ? "yellow" : "gray",
        style,
      ),
      largura,
    ),
  ];

  return {
    linhas,
    medidas: {
      saida: { total: saida.length, visiveis: altura.saida },
      eventos: { total: eventos.length, visiveis: altura.eventos },
    },
  };
}

export type PassoDoPainel = { estado: EstadoDoPainel; fechar?: true };

/**
 * Uma tecla, um estado novo.
 *
 * `medidas` é do último desenho: rolar uma página precisa saber quantas linhas
 * a página tem, e só quem desenhou sabe.
 */
export function reduzirPainel(estado: EstadoDoPainel, tecla: Key, medidas: Medidas, totalDeAgentes: number): PassoDoPainel {
  const area = estado.foco;
  const { total, visiveis } = medidas[area];
  const maximo = Math.max(0, total - visiveis);
  // Onde a saída está AGORA: seguindo, é o fim; parada, é onde a pessoa deixou.
  const atual = area === "saida" && estado.seguir ? maximo : limitar(estado.topo[area], total, visiveis);
  const ir = (topo: number): PassoDoPainel => {
    const novo = Math.max(0, Math.min(topo, maximo));
    return {
      estado: {
        ...estado,
        topo: { ...estado.topo, [area]: novo },
        // Rolar a saída para cima para de seguir; chegar ao fim volta a seguir.
        seguir: area === "saida" ? novo >= maximo && (estado.seguir || topo >= maximo) : estado.seguir,
      },
    };
  };

  switch (tecla.type) {
    case "escape":
      return { estado, fechar: true };
    case "char": {
      const letra = tecla.text.toLowerCase();
      if (letra === "q") return { estado, fechar: true };
      if (letra === "f") {
        const seguir = !estado.seguir;
        return { estado: { ...estado, seguir, topo: { ...estado.topo, saida: seguir ? maximoDa("saida", medidas) : limitar(estado.topo.saida, medidas.saida.total, medidas.saida.visiveis) } } };
      }
      return { estado };
    }
    case "tab":
      return medidas.eventos.visiveis > 0 ? { estado: { ...estado, foco: area === "saida" ? "eventos" : "saida" } } : { estado };
    case "up":
      return ir(atual - 1);
    case "down":
      return ir(atual + 1);
    case "pageup":
      return ir(atual - Math.max(1, visiveis - 1));
    case "pagedown":
      return ir(atual + Math.max(1, visiveis - 1));
    case "home":
      return ir(0);
    case "end":
      return ir(maximo);
    case "left":
    case "right": {
      if (totalDeAgentes <= 1) return { estado };
      const passo = tecla.type === "left" ? -1 : 1;
      return { estado: abrirPainel((estado.slot + passo + totalDeAgentes) % totalDeAgentes) };
    }
    default:
      return { estado };
  }
}

function maximoDa(area: AreaDoPainel, medidas: Medidas): number {
  return Math.max(0, medidas[area].total - medidas[area].visiveis);
}
