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
}

const MARCA: Record<WorkerState, string> = { livre: "○", preparando: "◐", trabalhando: "●", integrando: "◆" };
const TOM: Record<WorkerState, "gray" | "yellow" | "cyan"> = { livre: "gray", preparando: "yellow", trabalhando: "yellow", integrando: "cyan" };

export class WorkerTracker {
  private readonly linhas: WorkerRow[];

  constructor(labels: readonly string[]) {
    this.linhas = labels.map((label, slot) => ({ slot, label, state: "livre", phaseId: null, detail: "" }));
  }

  apply(evento: WorkerProgress): void {
    const linha = this.linhas[evento.slot];
    if (!linha) return;
    linha.state = evento.state;
    linha.phaseId = evento.phaseId;
    // O desfecho anterior só sai quando há um novo: livre sem detalhe mantém o que já se sabia.
    if (evento.detail !== "" || evento.state !== "livre") linha.detail = evento.detail;
  }

  rows(): WorkerRow[] {
    return this.linhas.map((linha) => ({ ...linha }));
  }
}

export function workersSummary(rows: readonly WorkerRow[]): string {
  const ocupados = rows.filter((linha) => linha.state !== "livre").length;
  return `${ocupados} de ${rows.length} ocupado${rows.length === 1 ? "" : "s"}`;
}

export function renderWorkerRows(rows: readonly WorkerRow[], phases: readonly BuildPhaseRow[], width: number, style: Style): string[] {
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
        : `${paint(linha.phaseId, "cyan", style)} ${fase?.title ?? ""}${fase && fase.detail && fase.detail !== fase.state ? paint(` · ${fase.detail}`, "gray", style) : ""}`;
    return truncateVisible(`${numero} ${rotulo} ${marca} ${estado} ${sobre}`, width);
  });
}
