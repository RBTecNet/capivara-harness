/**
 * O painel de controle.
 *
 * Mostra em que estágio o run está, quanto já custou e como está cada gate da
 * fase corrente. O custo ao lado do progresso é a resposta direta ao sintoma do
 * harness anterior: trinta minutos e quase dois dólares sem publicar nada, com a
 * tela sem dizer o que acontecia.
 *
 * Tudo aqui é função pura sobre um modelo: o teste pergunta ao texto renderizado
 * e nenhuma parte do painel toca no estado do run. O painel observa; nunca altera.
 */

import { paint, padVisible, tint, truncatePath, truncateVisible, visibleWidth, type Style } from "./ansi.js";
import { renderPhaseRows, type BuildPhaseRow } from "./build-phases.js";
import { blockText } from "./blockfont.js";
import { renderCapybara } from "./capybara.js";

export type StepState = "concluído" | "em andamento" | "aguardando" | "falhou" | "pulado";

export interface PipelineStep {
  label: string;
  state: StepState;
}

export interface Metric {
  label: string;
  value: string;
}

export interface DashboardEvent {
  time: string;
  text: string;
}

/**
 * O que está acontecendo AGORA.
 *
 * Sem isto, o painel parado e o painel trabalhando são idênticos, e quem olha
 * não sabe se deve responder alguma coisa, esperar, ou se o processo morreu.
 * `since` é o que permite dizer há quanto tempo — um número que anda é a prova
 * de vida mais barata que existe.
 */
export interface Activity {
  kind: "modelo" | "você" | "parado";
  detail: string;
  sinceSeconds: number;
}

export interface DashboardModel {
  version: string;
  /** `init` ou `build`; nomeia a linha de subtítulo e o workflow. */
  command: string;
  subtitle: string;
  project: string;
  stage: string;
  status: { label: string; state: StepState };
  durationSeconds: number;
  pipeline: PipelineStep[];
  /**
   * As fases do plano executável, quando o painel é de um build.
   *
   * O build mostrava a fase corrente e mais nada: num plano de sete fases, quem
   * olhava não sabia quantas faltavam nem em que gate a corrente estava parada.
   * Substitui o pipeline — as duas caixas respondem à mesma pergunta, cada uma
   * no seu lado do ciclo.
   */
  phases?: { rows: BuildPhaseRow[]; summary: string; maxRows: number; columns?: readonly string[]; legend?: readonly string[]; anchorId?: string };
  provider: { perfil: string; transporte: string; contabilidade: string };
  telemetry: Metric[];
  events: DashboardEvent[];
  /**
   * A pergunta da vez, desenhada DENTRO do painel.
   *
   * Uma pergunta impressa fora da moldura parece outra tela, e passa a impressão
   * de que o trabalho de verdade acontece em outro lugar — o painel vira enfeite.
   * Aqui ela ocupa o corpo do painel, no lugar da janela de log, porque enquanto
   * a vez é do desenvolvedor não há nada acontecendo para registrar.
   */
  question?: { title: string; body: string[] };
  activity: Activity;
  /**
   * Cor de fundo do painel, em hexadecimal. Ausente deixa o fundo do terminal.
   * Só tem efeito onde há cor verdadeira — em 16 cores, um tom escuro vira um
   * bloco chapado que atrapalha mais do que ajuda.
   */
  background?: string;
  /** Gira enquanto há trabalho; é o batimento visível do painel. */
  frame?: number;
  roles?: { role: string; provider: string; model: string }[];
  width?: number;
  /** Altura do terminal; uma linha fica livre para o cursor após o desenho. */
  height?: number;
  style: Style;
  environment?: NodeJS.ProcessEnv;
}

const MARK: Record<StepState, string> = {
  "concluído": "✓",
  "em andamento": "●",
  aguardando: " ",
  falhou: "✗",
  pulado: "–",
};

const TONE: Record<StepState, "green" | "yellow" | "gray" | "red"> = {
  "concluído": "green",
  "em andamento": "yellow",
  aguardando: "gray",
  falhou: "red",
  pulado: "gray",
};

/**
 * O teto fixo de 110 colunas fazia o painel ficar encolhido num terminal largo e
 * cortar a informação mais útil — a etapa atual — enquanto sobrava espaço vazio
 * à direita. A largura é recalculada a cada desenho, então redimensionar a
 * janela ajusta o painel na repintura seguinte.
 * Também não há piso artificial de 60: ele fazia terminais menores quebrarem
 * linhas, invalidando a contagem usada para redesenhar a região viva.
 */
const DEFAULT_WIDTH = 100;

export function dashboardWidth(model: DashboardModel): number {
  return Math.max(4, Math.floor(model.width ?? DEFAULT_WIDTH));
}

/** Quando o terminal é estreito, as colunas viram linhas em vez de sumirem. */
const NARROW = 80;

function duration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(Math.floor(seconds % 60)).padStart(2, "0")}s`;
}

/** Caixa com título embutido na borda de cima, como no painel de referência. */
function box(title: string, body: string[], width: number, style: Style): string[] {
  const inner = width - 2;
  const heading = truncateVisible(` ${title} `, inner);
  const top = `┌${heading}${"─".repeat(Math.max(0, inner - visibleWidth(heading)))}┐`;
  const lines = [paint(top, "cyan", style)];
  for (const line of body) {
    lines.push(`${paint("│", "cyan", style)}${padVisible(truncateVisible(line, inner), inner)}${paint("│", "cyan", style)}`);
  }
  lines.push(paint(`└${"─".repeat(inner)}┘`, "cyan", style));
  return lines;
}

/** Campos lado a lado, separados por barra pontilhada. */
function columns(fields: { label: string; value: string; path?: boolean }[], width: number, style: Style): string[] {
  const inner = width - 2;

  // Num terminal estreito, dividir em colunas só produz reticências. Empilhar
  // preserva o conteúdo, que é o ponto do painel.
  if (width < NARROW) {
    return fields.map(
      (field) => `${paint(padVisible(truncateVisible(field.label, 14), 15), "cyan", style)}${truncateVisible(field.value, inner - 15)}`,
    );
  }

  const cell = Math.floor((inner - (fields.length - 1) * 3) / fields.length);
  const labels = fields.map((field) => padVisible(paint(truncateVisible(field.label, cell), "cyan", style), cell));
  const values = fields.map((field) =>
    padVisible(field.path === true ? truncatePath(field.value, cell) : truncateVisible(field.value, cell), cell),
  );
  const separator = paint(" ┆ ", "gray", style);
  return [labels.join(separator), values.join(separator)];
}

/** Um pulso, não uma animação: o que importa é mudar de quadro. */
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

const ACTIVITY_TONE: Record<Activity["kind"], "yellow" | "cyan" | "red"> = {
  modelo: "yellow",
  "você": "cyan",
  parado: "red",
};

function activityLine(model: DashboardModel): string {
  const { activity, style } = model;
  const tempo = duration(activity.sinceSeconds);

  if (activity.kind === "você") {
    return paint(`▸ aguardando sua resposta — há ${tempo}`, "cyan", style);
  }
  if (activity.kind === "parado") {
    return paint(`✗ parado — ${activity.detail}`, "red", style);
  }

  const pulso = SPINNER[(model.frame ?? 0) % SPINNER.length] ?? "⠋";
  const detalhe = activity.detail === "" ? "" : ` ${activity.detail}`;
  return paint(`${pulso}${detalhe} — há ${tempo} nesta chamada`, ACTIVITY_TONE.modelo, style);
}

interface Layout {
  artwork: boolean;
  dense: boolean;
  events: number;
  phases: number;
}

/** A capivara fica no centro do painel, independentemente da largura do título. */
function header(model: DashboardModel, width: number, artwork: boolean): string[] {
  const { style } = model;
  const lines: string[] = [];
  if (artwork && width >= 64) {
    const mascot = renderCapybara({
      style,
      columns: 32,
      ...(model.environment !== undefined ? { environment: model.environment } : {}),
    });
    const mascotWidth = Math.max(...mascot.map(visibleWidth));
    const leftWidth = Math.floor((width - mascotWidth) / 2);
    const blocks = blockText("CAPIVARA", leftWidth < 48);
    const title = Math.max(...blocks.map(visibleWidth)) + 3 <= leftWidth
      ? blocks.map((line) => paint(line, "cyan", style))
      : [paint("CAPIVARA", "cyan", style), paint(`v${model.version}`, "gray", style)];
    const top = Math.floor((mascot.length - title.length) / 2);
    for (let row = 0; row < mascot.length; row += 1) {
      lines.push(`${padVisible(`  ${title[row - top] ?? ""}`, leftWidth)}${mascot[row] ?? ""}`);
    }
    lines.push(paint(`${model.subtitle.toUpperCase()} · v${model.version}`, "gray", style));
  } else {
    lines.push(`${paint("CAPIVARA", "cyan", style)} ${paint(`v${model.version}`, "gray", style)} · ${model.subtitle.toUpperCase()}`);
  }
  lines.push(paint("─".repeat(width), "gray", style));
  return lines;
}

function dashboardLines(model: DashboardModel, layout: Layout): string[] {
  const width = dashboardWidth(model);
  const { style } = model;
  const lines = header(model, width, layout.artwork);
  if (layout.dense) lines.pop(); // A moldura de situação já separa o cabeçalho.

  lines.push(
    ...box(
      "SITUAÇÃO",
      /*
       * A etapa atual ganha uma linha inteira, não uma coluna.
       * Ela é o campo mais informativo do painel — diz o que está acontecendo
       * agora — e era justamente o que aparecia cortado quando dividia a largura
       * com outros quatro. O workflow saiu: o subtítulo já o nomeia.
       */
      [
        ...(layout.dense ? [`${model.project} · ${MARK[model.status.state]} ${model.status.label} · ${duration(model.durationSeconds)}`] : columns(
          [
            { label: "PROJETO", value: model.project, path: true },
            { label: "STATUS", value: `${MARK[model.status.state]} ${model.status.label}` },
            { label: "DURAÇÃO", value: duration(model.durationSeconds) },
          ],
          width,
          style,
        )),
        ...(layout.dense ? [] : [""]),
        `${paint(padVisible("ETAPA ATUAL", 16), "cyan", style)}${model.stage}`,
        `${paint(padVisible("AGORA", 16), "cyan", style)}${activityLine(model)}`,
      ],
      width,
      style,
    ),
  );

  if (model.phases) {
    const lista = renderPhaseRows(model.phases.rows, layout.phases, width - 2, style, {
      ...(model.phases.columns ? { columns: model.phases.columns } : {}),
      ...(model.phases.anchorId ? { anchorId: model.phases.anchorId } : {}),
    });
    lines.push(
      ...box(
        `FASES · ${model.phases.summary}`,
        lista.length > 0
          ? [...lista, ...(layout.dense ? [] : [paint((model.phases.legend ?? PHASE_GATES).join(" · "), "gray", style)])]
          : [paint("nenhuma fase planejada", "gray", style)],
        width,
        style,
      ),
    );
  }

  const pipeline: string[] = [];
  if (!model.phases && model.pipeline.length > 0) {
    const marks = model.pipeline
      .map((step) => paint(`[${MARK[step.state]}]`, TONE[step.state], style))
      .join(paint(" ── ", "gray", style));
    if (!layout.dense) pipeline.push(marks);
    for (const step of model.pipeline) {
      const rotulo = padVisible(truncateVisible(step.label, 26), 27);
      pipeline.push(`  ${paint(MARK[step.state], TONE[step.state], style)} ${rotulo}${paint(step.state, "gray", style)}`);
    }
    if (!layout.dense) pipeline.push(paint("Somente metadados operacionais; o painel não altera a execução.", "gray", style));
  }
  if (pipeline.length > 0) lines.push(...box("PIPELINE · FLUXO DE EXECUÇÃO", pipeline, width, style));

  lines.push(
    ...box(
      "PROVEDOR ATUAL",
      [
        ...(model.roles === undefined
          ? [`${paint(padVisible("perfil", 16), "cyan", style)}${model.provider.perfil}`]
          : model.roles.map(
              (role) =>
                `${paint(padVisible(role.role, 16), "cyan", style)}${role.provider || "não configurado"}${role.model ? `/${role.model}` : ""}`,
            )),
        ...(layout.dense ? [] : [
          `${paint(padVisible("transporte", 16), "cyan", style)}${model.provider.transporte}`,
          `${paint(padVisible("contabilidade", 16), "cyan", style)}${model.provider.contabilidade}`,
        ]),
      ],
      width,
      style,
    ),
  );

  if (model.telemetry.length > 0) {
    lines.push(...box("TELEMETRIA", columns(model.telemetry.map((metric) => ({ label: metric.label, value: metric.value })), width, style), width, style));
  }

  if (model.question) {
    lines.push(...box(model.question.title, model.question.body, width, style));
  } else if (model.events.length > 0) {
    lines.push(
      ...box(
        "O QUE ESTÁ ACONTECENDO",
        model.events.slice(-layout.events).map((event) => `${paint(`[${event.time}]`, "gray", style)} ${event.text}`),
        width,
        style,
      ),
    );
  }

  // O rodapé também cabe: num terminal estreito ele vira a metade que importa.
  lines.push(
    paint(
      width < NARROW ? "Ctrl-C interrompe com estado retomável" : "Ctrl-C interrompe com estado retomável · segredos nunca entram neste painel",
      "gray",
      style,
    ),
  );

  return lines;
}

export function renderDashboard(model: DashboardModel): string {
  const width = dashboardWidth(model);
  const budget = model.height === undefined ? Infinity : Math.max(1, model.height - 1);
  const layout: Layout = {
    artwork: budget >= 35,
    dense: budget < 27,
    events: Math.min(6, model.events.length),
    phases: model.phases?.maxRows ?? 0,
  };
  let lines = dashboardLines(model, layout);
  while (lines.length > budget) {
    if (layout.events > 1) layout.events -= 1;
    else if (layout.phases > 1) layout.phases -= 1;
    else if (layout.artwork) layout.artwork = false;
    else if (!layout.dense) layout.dense = true;
    else break;
    lines = dashboardLines(model, layout);
  }
  // Perguntas são liberadas da região viva antes da resposta; nunca cortar opções.
  if (lines.length > budget && !model.question) {
    const current = model.phases?.rows.find((phase) => phase.state === "em andamento");
    lines = [
      paint(`CAPIVARA v${model.version} · ${model.command.toUpperCase()} · ${model.project}`, "cyan", model.style),
      `${model.status.label} · ${duration(model.durationSeconds)} · ${model.stage}`,
      activityLine(model),
      ...(current ? renderPhaseRows([current], 1, width, model.style) : []),
      ...(model.roles ?? []).map((role) => `${role.role} ${role.provider}/${role.model}`),
      ...model.telemetry.map((metric) => `${metric.label}: ${metric.value}`),
      ...model.events.slice(-1).map((event) => `[${event.time}] ${event.text}`),
    ].slice(0, budget);
  }
  const rendered = lines.map((line) => truncateVisible(line, width)).join("\n");
  return model.background === undefined || !model.style.enabled ? rendered : tint(rendered, model.background, width);
}

export const PHASE_GATES = ["G0 engine", "G1 escrita", "G2 suíte", "G3 verificação"] as const;
