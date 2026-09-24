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

/**
 * As colunas do `plan`: escrita e auditoria.
 *
 * A linha de fase nasceu no build, com cinco gates. O `plan` tem o mesmo formato
 * de trabalho — uma fase por vez, cada uma passando por etapas que ou fecham ou
 * devolvem — e não tinha tela nenhuma: só linhas de log passando. As colunas
 * viraram parâmetro para os dois desenharem com o mesmo código, porque manter
 * dois desenhos de linha de fase é manter dois que divergem.
 */
export const PLAN_COLUMNS = ["E", "A"] as const;

export type GateState = "aguardando" | "corrente" | "verde" | "vermelho" | "neutro";

export type PhaseState = "aguardando" | "em andamento" | "concluído" | "falhou" | "pulado";

export interface BuildPhaseRow {
  /** `P01`, `P02`… */
  id: string;
  title: string;
  state: PhaseState;
  /** Um estado por coluna, na ordem que o desenho receber. */
  gates: Record<string, GateState>;
  /** Uma palavra sobre a fase: `ciclo 2/3`, `commitada`, `gate 2 reprovou`. */
  detail: string;
}

const GATE_MARK: Record<GateState, string> = {
  aguardando: "○",
  corrente: "●",
  verde: "●",
  vermelho: "●",
  /*
   * Avaliado, e sem nada a dizer. A bolinha é cheia — o gate rodou —, mas
   * apagada: numa fase já implementada, "a sessão não escreveu nada" é o
   * comportamento certo, e pintá-lo de vermelho faria a tela relatar uma
   * falha que não houve.
   */
  neutro: "●",
};

const GATE_TONE: Record<GateState, "green" | "yellow" | "gray" | "red"> = {
  aguardando: "gray",
  corrente: "yellow",
  verde: "green",
  vermelho: "red",
  neutro: "gray",
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

/** As colunas do `plan`, todas por começar. */
export function emptyPlanColumns(): Record<string, GateState> {
  return { E: "aguardando", A: "aguardando" };
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
  anchorId?: string,
): { visible: BuildPhaseRow[]; hiddenBefore: number; hiddenAfter: number } {
  if (maxRows <= 0) return { visible: [], hiddenBefore: 0, hiddenAfter: rows.length };
  if (rows.length <= maxRows) return { visible: [...rows], hiddenBefore: 0, hiddenAfter: 0 };

  /*
   * A âncora explícita ganha de tudo: quem sabe onde está a novidade é quem
   * acabou de receber o evento.
   *
   * Sem ela, a âncora é a primeira fase em execução — o que funciona no build,
   * onde uma fase roda por vez, e ENGANA no plan, onde doze são escritas em
   * paralelo: a janela ficava presa na P01 enquanto o trabalho acontecia na P15,
   * e a tela dizia "↓ 6 fases abaixo" sem deixar ver nenhuma delas.
   */
  const explicita = anchorId === undefined ? -1 : rows.findIndex((row) => row.id === anchorId);
  const executando = rows.findIndex((row) => row.state === "em andamento");
  const proxima = rows.findIndex((row) => row.state === "aguardando");
  const ancora = explicita >= 0 ? explicita : executando >= 0 ? executando : proxima >= 0 ? proxima : rows.length - 1;

  /*
   * A âncora fica CENTRADA quando ela é explícita, e no topo quando é deduzida.
   *
   * Centrada porque a fase que acabou de mudar quase nunca é a última novidade:
   * ver as vizinhas de cima e de baixo é o que dá o contexto de onde o trabalho
   * está. No topo quando é deduzida, porque ali o que interessa é o que falta.
   */
  const desejado = explicita >= 0 ? ancora - Math.floor(maxRows / 2) : ancora;
  const inicio = Math.max(0, Math.min(desejado, Math.max(0, rows.length - maxRows)));
  return {
    visible: rows.slice(inicio, inicio + maxRows),
    hiddenBefore: inicio,
    hiddenAfter: Math.max(0, rows.length - inicio - maxRows),
  };
}

/** `G0● G1● G2○ G3○`, cada bolinha na cor do seu estado. */
function gateCells(row: BuildPhaseRow, style: Style, columns: readonly string[]): string {
  return columns
    .map((gate) => {
      const estado = row.gates[gate] ?? "aguardando";
      return `${paint(gate, "gray", style)}${paint(GATE_MARK[estado], GATE_TONE[estado], style)}`;
    })
    .join(" ");
}

/** Quanto a coluna ocupa: `G0●` por coluna, mais um espaço entre elas. */
function colunasWidth(columns: readonly string[]): number {
  return columns.reduce((total, coluna) => total + coluna.length + 1, 0) + Math.max(0, columns.length - 1);
}

export interface PhaseRowsOptions {
  /** As colunas de bolinha: os gates do build, ou E/A do plan. */
  columns?: readonly string[];
  /** A fase que acabou de mudar; a janela se move para mostrá-la. */
  anchorId?: string;
}

export function renderPhaseRows(
  rows: readonly BuildPhaseRow[],
  maxRows: number,
  width: number,
  style: Style,
  options: PhaseRowsOptions = {},
): string[] {
  const columns = options.columns ?? GATES;
  const janela = phaseWindow(rows, maxRows, options.anchorId);
  const linhas: string[] = [];

  if (janela.hiddenBefore > 0) {
    linhas.push(paint(`  ↑ ${resumoOculto(rows.slice(0, janela.hiddenBefore))}`, "gray", style));
  }

  /*
   * O título é o que cede espaço quando o terminal é estreito: o id e os gates
   * são a informação densa, e um título cortado ainda identifica a fase.
   */
  const reservado = 2 + 1 + 1 + 4 + colunasWidth(columns) + 2;
  const tituloMax = Math.max(8, width - reservado - 14);

  for (const row of janela.visible) {
    const marca = paint(PHASE_MARK[row.state], PHASE_TONE[row.state], style);
    const id = paint(padVisible(row.id, 4), "cyan", style);
    const titulo = padVisible(truncateVisible(row.title, tituloMax), tituloMax);
    const gates = gateCells(row, style, columns);
    const detalhe = paint(row.detail, PHASE_TONE[row.state] === "gray" ? "gray" : PHASE_TONE[row.state], style);
    linhas.push(`  ${marca} ${id}${titulo}  ${gates}  ${detalhe}`);
  }

  if (janela.hiddenAfter > 0) {
    linhas.push(paint(`  ↓ ${resumoOculto(rows.slice(rows.length - janela.hiddenAfter))}`, "gray", style));
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
export function gatesWidth(columns: readonly string[] = GATES): number {
  return colunasWidth(columns);
}

/** Quanto cada linha realmente ocupa, para o painel decidir quantas cabem. */
/**
 * O que está escondido, e não só quanta coisa.
 *
 * "↓ 6 fase(s) abaixo" conta uma quantidade e esconde o que importa: se são seis
 * esperando, não há nada para ver ali; se uma delas falhou, a tela está
 * escondendo justamente o que a pessoa procura.
 */
function resumoOculto(ocultas: readonly BuildPhaseRow[]): string {
  const contagem = new Map<PhaseState, number>();
  for (const row of ocultas) contagem.set(row.state, (contagem.get(row.state) ?? 0) + 1);

  const ordem: PhaseState[] = ["falhou", "em andamento", "concluído", "pulado", "aguardando"];
  const partes = ordem
    .filter((estado) => (contagem.get(estado) ?? 0) > 0)
    .map((estado) => `${contagem.get(estado)} ${estado}`);

  return `${ocultas.length} fase(s): ${partes.join(", ")}`;
}

export function phaseRowWidth(row: BuildPhaseRow, style: Style, columns: readonly string[] = GATES): number {
  return visibleWidth(renderPhaseRows([row], 1, 200, style, { columns })[0] ?? "");
}
