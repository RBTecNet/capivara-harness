/**
 * Os agentes do build paralelo, um por linha (§97).
 *
 * A lista de fases diz onde o PLANO está. Com vários agentes, ela não responde
 * "quem está fazendo o quê": três fases "em andamento" e nenhum jeito de saber
 * qual modelo pegou qual, quem já entregou e espera a vez de integrar, e quem
 * está parado sem fase. Esta caixa responde isso, e nada mais.
 *
 * Função pura sobre o que o loop contou; o painel observa e nunca altera.
 */

import type { WorkerProgress, WorkerState } from "../loop/progress.js";
import { paint, padVisible, truncateVisible, type Style } from "./ansi.js";
import type { BuildPhaseRow } from "./build-phases.js";

export interface WorkerRow {
  slot: number;
  /** `codex/gpt-5.5 · high`. */
  label: string;
  state: WorkerState;
  phaseId: string | null;
  /** O último desfecho, enquanto livre: `P03 integrada`. */
  detail: string;
  /** Desde quando o agente está na fase corrente, em ms; nulo quando livre. */
  since: number | null;
  activity?: string;
}

const MARCA: Record<WorkerState, string> = { livre: "○", preparando: "◐", trabalhando: "●", integrando: "◆" };
const TOM: Record<WorkerState, "gray" | "yellow" | "cyan"> = { livre: "gray", preparando: "yellow", trabalhando: "yellow", integrando: "cyan" };

export class WorkerTracker {
  private readonly linhas: WorkerRow[];

  constructor(
    labels: readonly string[],
    private readonly agora: () => number = () => Date.now(),
  ) {
    this.linhas = labels.map((label, slot) => ({ slot, label, state: "livre", phaseId: null, detail: "", since: null }));
  }

  apply(evento: WorkerProgress): void {
    const linha = this.linhas[evento.slot];
    if (!linha) return;
    if (evento.phaseId !== linha.phaseId || evento.state !== "trabalhando") delete linha.activity;
    // O relógio é da fase: preparar, trabalhar e integrar a mesma fase contam juntos.
    if (evento.phaseId === null) linha.since = null;
    else if (evento.phaseId !== linha.phaseId || linha.since === null) linha.since = this.agora();
    linha.state = evento.state;
    linha.phaseId = evento.phaseId;
    // O desfecho anterior só sai quando há um novo: livre sem detalhe mantém o que já se sabia.
    if (evento.detail !== "" || evento.state !== "livre") linha.detail = evento.detail;
  }

  /** O slot e a fase vêm da chamada, nunca da prosa do provider. */
  activity(slot: number, phaseId: string, detail: string): void {
    const row = this.linhas[slot];
    if (row?.phaseId === phaseId && row.state === "trabalhando") row.activity = detail;
  }

  rows(): WorkerRow[] {
    return this.linhas.map((linha) => ({ ...linha }));
  }
}

export function workersSummary(rows: readonly WorkerRow[]): string {
  const ocupados = rows.filter((linha) => linha.state !== "livre").length;
  return `${ocupados} de ${rows.length} ocupado${rows.length === 1 ? "" : "s"}`;
}

/**
 * `selected` marca o agente sob o cursor, quando há teclado para escolher: é o
 * que o Enter abre. Sem teclado, nenhuma linha é marcada — marca que não se move
 * diria que existe uma escolha que não existe.
 */
export function renderWorkerRows(rows: readonly WorkerRow[], phases: readonly BuildPhaseRow[], width: number, style: Style, selected?: number): string[] {
  const porId = new Map(phases.map((fase) => [fase.id, fase]));
  const larguraDoRotulo = Math.min(28, Math.max(10, ...rows.map((linha) => linha.label.length)));
  return rows.map((linha) => {
    const numero = paint(String(linha.slot + 1).padStart(2), "cyan", style);
    const rotulo = padVisible(truncateVisible(linha.label, larguraDoRotulo), larguraDoRotulo);
    const marca = paint(MARCA[linha.state], TOM[linha.state], style);
    const estado = padVisible(linha.state, 11);
    const fase = linha.phaseId ? porId.get(linha.phaseId) : undefined;
    const sobre =
      linha.phaseId === null
        ? paint(linha.detail === "" ? "—" : `último: ${linha.detail}`, "gray", style)
        : `${paint(linha.phaseId, "cyan", style)} ${linha.activity ?? fase?.title ?? ""}${fase && fase.detail && fase.detail !== fase.state ? paint(` · ${fase.detail}`, "gray", style) : ""}`;
    const cursor = selected === undefined ? "" : linha.slot === selected ? `${paint("❯", "cyan", style)} ` : "  ";
    return truncateVisible(`${cursor}${numero} ${rotulo} ${marca} ${estado} ${sobre}`, width);
  });
}

/**
 * As teclas do painel do build sobre a caixa AGENTES: ↑ ↓ e Tab movem o
 * cursor, dando a volta; Enter abre o log do agente sob o cursor. Outra tecla
 * não é desta caixa — devolve nulo, e segue para os outros atalhos.
 */
export function teclaNaCaixaDeAgentes(
  atual: number,
  tecla: { type: string },
  quantos: number,
): { selecionado: number; abrir?: true } | null {
  if (quantos <= 0) return null;
  if (tecla.type === "up") return { selecionado: (atual - 1 + quantos) % quantos };
  if (tecla.type === "down" || tecla.type === "tab") return { selecionado: (atual + 1) % quantos };
  if (tecla.type === "enter") return { selecionado: atual, abrir: true };
  return null;
}
