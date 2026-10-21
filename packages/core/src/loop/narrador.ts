/**
 * O que o BUILD está fazendo, dito uma vez e no mesmo texto em todo lugar (§125 G; spec §9).
 *
 * A recuperação tinha três vozes: o announce (prosa, só na tela e no anel de 12
 * linhas do painel), o `events.tsv` (só o nome do gate dentro do detalhe de um
 * retry) e nenhum arquivo. Quem olhava a TUI via uma coisa e quem lia o run,
 * outra. Agora cada transição relevante — defeito achado, estratégia escolhida,
 * revalidação, evidência preservada ou invalidada, ciclo aberto, gate não
 * aplicável, parada — é um objeto, e uma função pura faz a linha. A mesma linha
 * vai à tela e ao log de eventos, de onde o relatório é montado. Determinística,
 * sem chamada de modelo.
 *
 * O único registro é o `events.tsv` — o relatório sai dele, e da TUI sai a mesma
 * linha; não há terceira cópia para divergir. O assunto é `<fase>:recuperacao`
 * com status `started`: nunca
 * `complete`/`skipped` (a retomada contaria a fase como concluída) e nunca
 * `retry` (as contagens de retry continuam sendo as das chamadas de construção).
 */

import { appendEvent, readEvents } from "../state/events.js";
import { runPaths } from "../state/paths.js";
import type { BuildProgressListener } from "./progress.js";

export type TipoDeTransicao =
  | "defeito"
  | "estrategia"
  | "resultado"
  | "revalidacao"
  | "preservada"
  | "nao-aplicavel"
  | "ciclo"
  | "retomada"
  | "conflito"
  | "upstream"
  | "autorizacao"
  | "parada"
  | "entrega";

export interface Transicao {
  fase: string;
  ciclo: number;
  maxCiclos: number;
  tipo: TipoDeTransicao;
  gate?: string;
  defeitos?: string[];
  estrategia?: string;
  agente?: string;
  /** Orçamento consumido, por escala. */
  orcamento?: { escopo: string; usado: number; max: number }[];
  /** Evidências mantidas e invalidadas por esta transição. */
  preservadas?: string[];
  invalidadas?: string[];
  motivo: string;
  proximo?: string;
  custoUsd?: number;
}

/** A linha da transição: o que vai à TUI, ao `events.tsv` e ao relatório. */
export function linhaDaTransicao(transicao: Transicao): string {
  const partes = [`ciclo ${transicao.ciclo}/${transicao.maxCiclos}`];
  if (transicao.gate) partes.push(transicao.gate);
  if (transicao.defeitos && transicao.defeitos.length > 0) partes.push(transicao.defeitos.join(", "));
  if (transicao.estrategia) partes.push(`estratégia: ${transicao.estrategia}${transicao.agente ? ` (${transicao.agente})` : ""}`);
  if (transicao.orcamento && transicao.orcamento.length > 0) {
    partes.push(`orçamento: ${transicao.orcamento.map((item) => `${item.escopo} ${item.usado}/${item.max}`).join(", ")}`);
  }
  if (transicao.preservadas && transicao.preservadas.length > 0) partes.push(`preserva: ${transicao.preservadas.join(", ")}`);
  if (transicao.invalidadas && transicao.invalidadas.length > 0) partes.push(`invalida: ${transicao.invalidadas.join(", ")}`);
  if (transicao.custoUsd !== undefined) partes.push(`custo US$ ${transicao.custoUsd.toFixed(4)}`);
  if (transicao.proximo) partes.push(`próximo: ${transicao.proximo}`);
  return `${ROTULO[transicao.tipo]} · ${partes.join(" · ")} — ${transicao.motivo}`;
}

/** O resumo de uma linha para o detalhe da fase na TUI: ciclo, gate, defeitos e estratégia. */
export function resumoDaTransicao(transicao: Transicao): string {
  const partes = [`ciclo ${transicao.ciclo}/${transicao.maxCiclos}`, ROTULO[transicao.tipo]];
  if (transicao.gate) partes.push(transicao.gate);
  if (transicao.defeitos && transicao.defeitos.length > 0) partes.push(transicao.defeitos.join(","));
  if (transicao.estrategia) partes.push(transicao.estrategia);
  return partes.join(" · ");
}

const ROTULO: Record<TipoDeTransicao, string> = {
  defeito: "defeito",
  estrategia: "recuperação",
  resultado: "validação",
  revalidacao: "revalidação",
  preservada: "evidência preservada",
  "nao-aplicavel": "não aplicável",
  ciclo: "novo ciclo",
  retomada: "retomada",
  conflito: "integração",
  upstream: "reparo documental",
  autorizacao: "autorização",
  parada: "parada",
  entrega: "entrega",
};

export type Narrador = (transicao: Transicao) => Promise<string>;

export function criarNarrador(options: {
  projectRoot: string;
  runId: string;
  announce: (linha: string) => void;
  onProgress?: BuildProgressListener;
  now?: () => Date;
}): Narrador {
  const paths = runPaths(options.projectRoot, options.runId);
  const now = options.now ?? (() => new Date());
  return async (transicao) => {
    const linha = linhaDaTransicao(transicao);
    const at = now().toISOString();
    options.announce(`[${transicao.fase}] ${linha}`);
    options.onProgress?.({ kind: "recovery", id: transicao.fase, cycle: transicao.ciclo, line: linha, transition: transicao });
    await appendEvent(paths.events, { timestamp: at, stage: "recover", subject: `${transicao.fase}:recuperacao`, attempt: transicao.ciclo, status: "started", detail: linha });
    return linha;
  };
}

/** As linhas de recuperação persistidas no `events.tsv`, na ordem: a fonte do relatório (§125 G). */
export async function lerTransicoes(projectRoot: string, runId: string): Promise<{ at: string; fase: string; ciclo: number; linha: string }[]> {
  const eventos = await readEvents(runPaths(projectRoot, runId).events);
  return eventos
    .filter((evento) => evento.stage === "recover" && evento.subject.endsWith(":recuperacao"))
    .map((evento) => ({ at: evento.timestamp, fase: evento.subject.slice(0, -":recuperacao".length), ciclo: evento.attempt, linha: evento.detail }));
}
