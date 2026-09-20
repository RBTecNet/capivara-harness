/**
 * A lista de fases do build, com os cinco gates de cada uma.
 *
 * O painel do build mostrava a fase corrente e mais nada. Num plano de sete
 * fases, quem olhava não sabia quantas faltavam, quais já tinham fechado, nem
 * em que gate a corrente estava parada — e é no gate que a informação mora: o
 * executor escreveu (G1) mas a suíte reprovou (G2) é um diagnóstico
 * completamente diferente de o engine ter morrido (G0).
 *
 * Tudo aqui é função pura sobre um modelo. O painel observa; nunca altera.
 */

import { paint, padVisible, truncateVisible, visibleWidth, type Style } from "./ansi.js";

/** Os cinco gates, na ordem em que a fase passa por eles. */
export const GATES = ["G0", "G1", "G2", "G3", "G4"] as const;
export type GateId = (typeof GATES)[number];

export type GateState = "aguardando" | "corrente" | "verde" | "vermelho";

export type PhaseState = "aguardando" | "em andamento" | "concluído" | "falhou" | "pulado";

export interface BuildPhaseRow {
  /** `P01`, `P02`… */
  id: string;
  title: string;
  state: PhaseState;
  /** Um estado por gate, na ordem de `GATES`. */
  gates: Record<GateId, GateState>;
  /** Uma palavra sobre a fase: `ciclo 2/3`, `commitada`, `gate 2 reprovou`. */
  detail: string;
}

const GATE_MARK: Record<GateState, string> = {
  aguardando: "○",
  corrente: "●",
  verde: "●",
  vermelho: "●",
};

const GATE_TONE: Record<GateState, "green" | "yellow" | "gray" | "red"> = {
  aguardando: "gray",
  corrente: "yellow",
  verde: "green",
  vermelho: "red",
};

const PHASE_MARK: Record<PhaseState, string> = {
  aguardando: " ",
  "em andamento": "●",
  "concluído": "✓",
  falhou: "✗",
  pulado: "–",
};

const PHASE_TONE: Record<PhaseState, "green" | "yellow" | "gray" | "red"> = {
  aguardando: "gray",
  "em andamento": "yellow",
  "concluído": "green",
  falhou: "red",
  pulado: "gray",
};

export function emptyGates(): Record<GateId, GateState> {
  return { G0: "aguardando", G1: "aguardando", G2: "aguardando", G3: "aguardando", G4: "aguardando" };
}

/**
 * Quais fases cabem na tela.
 *
 * A regra tem uma prioridade só: **a fase em execução nunca some**. Quando não
 * cabe tudo, o que sai são as concluídas — elas já entregaram a informação que
 * tinham — e depois as que ainda nem começaram, de trás para frente.
 *
 * O resultado é uma janela que sobe sozinha conforme o build anda: no começo
 * mostra o topo do plano, no fim mostra a cauda. Quem olha vê sempre onde a
 * execução está e o que ainda falta, que é a pergunta que a tela responde.
 *
 * As omitidas não somem em silêncio: quem chama recebe as contagens para dizer
 * quantas ficaram de cada lado. Esconder sem avisar seria trocar uma tela
 * incompleta por uma tela enganosa.
 */
export function phaseWindow(
  rows: readonly BuildPhaseRow[],
  maxRows: number,
): { visible: BuildPhaseRow[]; hiddenBefore: number; hiddenAfter: number } {
  if (maxRows <= 0) return { visible: [], hiddenBefore: 0, hiddenAfter: rows.length };
  if (rows.length <= maxRows) return { visible: [...rows], hiddenBefore: 0, hiddenAfter: 0 };

  /*
   * A âncora é a fase em execução. Sem nenhuma em execução — build recém-criado
   * ou já terminado — a janela fica onde há trabalho por fazer, e, se não houver
   * nenhum, no fim da lista, que é onde está o desfecho.
   */
  const executando = rows.findIndex((row) => row.state === "em andamento");
  const proxima = rows.findIndex((row) => row.state === "aguardando");
  const ancora = executando >= 0 ? executando : proxima >= 0 ? proxima : rows.length - 1;

  /*
   * A âncora vai para o topo da janela: o que interessa depois dela é o que
   * falta. Só quando a âncora está no fim da lista é que a janela recua, para
   * não sobrar espaço vazio embaixo.
   */
  const inicio = Math.min(ancora, Math.max(0, rows.length - maxRows));
  return {
    visible: rows.slice(inicio, inicio + maxRows),
    hiddenBefore: inicio,
    hiddenAfter: Math.max(0, rows.length - inicio - maxRows),
  };
}

/** `G0● G1● G2○ G3○`, cada bolinha na cor do seu estado. */
function gateCells(row: BuildPhaseRow, style: Style): string {
  return GATES.map((gate) => {
    const estado = row.gates[gate];
    return `${paint(gate, "gray", style)}${paint(GATE_MARK[estado], GATE_TONE[estado], style)}`;
  }).join(" ");
}

/** Quanto a coluna de gates ocupa: `G0● ` quatro vezes, sem o espaço final. */
const GATES_WIDTH = GATES.length * 3 + (GATES.length - 1);

export function renderPhaseRows(rows: readonly BuildPhaseRow[], maxRows: number, width: number, style: Style): string[] {
  const janela = phaseWindow(rows, maxRows);
  const linhas: string[] = [];

  if (janela.hiddenBefore > 0) {
    linhas.push(paint(`  ↑ ${janela.hiddenBefore} fase(s) acima`, "gray", style));
  }

  /*
   * O título é o que cede espaço quando o terminal é estreito: o id e os gates
   * são a informação densa, e um título cortado ainda identifica a fase.
   */
  const reservado = 2 + 1 + 1 + 4 + GATES_WIDTH + 2;
  const tituloMax = Math.max(8, width - reservado - 14);

  for (const row of janela.visible) {
    const marca = paint(PHASE_MARK[row.state], PHASE_TONE[row.state], style);
    const id = paint(padVisible(row.id, 4), "cyan", style);
    const titulo = padVisible(truncateVisible(row.title, tituloMax), tituloMax);
    const gates = gateCells(row, style);
    const detalhe = paint(row.detail, PHASE_TONE[row.state] === "gray" ? "gray" : PHASE_TONE[row.state], style);
    linhas.push(`  ${marca} ${id}${titulo}  ${gates}  ${detalhe}`);
  }

  if (janela.hiddenAfter > 0) {
    linhas.push(paint(`  ↓ ${janela.hiddenAfter} fase(s) abaixo`, "gray", style));
  }

  return linhas;
}

/** `3/7 fases · 1 falhou` — o resumo que cabe sempre, mesmo sem espaço para a lista. */
export function phaseSummary(rows: readonly BuildPhaseRow[]): string {
  const concluidas = rows.filter((row) => row.state === "concluído").length;
  const falhas = rows.filter((row) => row.state === "falhou").length;
  return `${concluidas}/${rows.length} fases${falhas > 0 ? ` · ${falhas} falhou` : ""}`;
}

/** Só para o teste medir a coluna sem reimplementar a conta. */
export function gatesWidth(): number {
  return GATES_WIDTH;
}

/** Quanto cada linha realmente ocupa, para o painel decidir quantas cabem. */
export function phaseRowWidth(row: BuildPhaseRow, style: Style): number {
  return visibleWidth(renderPhaseRows([row], 1, 200, style)[0] ?? "");
}
