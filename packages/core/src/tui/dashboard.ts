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

import { paint, padVisible, truncatePath, truncateVisible, visibleWidth, type Style } from "./ansi.js";
import { blockText } from "./blockfont.js";
import { CAPYBARA_COLS, renderCapybara } from "./capybara.js";

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
  /** Gira enquanto há trabalho; é o batimento visível do painel. */
  frame?: number;
  roles?: { role: string; provider: string; model: string }[];
  width?: number;
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
 * Abaixo disso não há painel que caiba; acima, ele acompanha o terminal.
 *
 * O teto fixo de 110 colunas fazia o painel ficar encolhido num terminal largo e
 * cortar a informação mais útil — a etapa atual — enquanto sobrava espaço vazio
 * à direita. A largura é recalculada a cada desenho, então redimensionar a
 * janela ajusta o painel na repintura seguinte.
 */
const MIN_WIDTH = 60;
const DEFAULT_WIDTH = 100;

export function dashboardWidth(model: DashboardModel): number {
  return Math.max(MIN_WIDTH, model.width ?? DEFAULT_WIDTH);
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
  const heading = ` ${title} `;
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

export function renderDashboard(model: DashboardModel): string {
  const width = dashboardWidth(model);
  const { style } = model;
  const lines: string[] = [];

  /*
   * Cabeçalho: título em blocos à esquerda, capivara à direita — quando cabem.
   *
   * Num terminal estreito os dois juntos passam da largura e o painel inteiro
   * vaza. A capivara é a primeira a sair, depois o título em blocos; o nome do
   * produto em texto simples cabe em qualquer lugar.
   */
  const titleWidth = Math.max(...blockText("CAPIVARA").map((line) => line.length));
  const cabeCapivara = width >= titleWidth + CAPYBARA_COLS + 4;
  const cabeTitulo = width >= titleWidth + 2;

  if (cabeTitulo) {
    const title = blockText("CAPIVARA").map((line) => paint(line, "cyan", style));
    const mascot = cabeCapivara
      ? renderCapybara({ style, ...(model.environment !== undefined ? { environment: model.environment } : {}) })
      : [];
    const gap = cabeCapivara ? Math.max(2, width - titleWidth - CAPYBARA_COLS - 2) : 0;

    const header = Math.max(title.length, mascot.length);
    for (let row = 0; row < header; row += 1) {
      const left = padVisible(title[row] ?? "", titleWidth);
      lines.push(truncateVisible(`${left}${" ".repeat(gap)}${mascot[row] ?? ""}`.replace(/\s+$/, ""), width));
    }
  } else {
    lines.push(paint("capivara", "cyan", style));
  }

  lines.push("");
  lines.push(paint(model.subtitle.toUpperCase(), "gray", style));
  const assinatura = "HARNESS · capivara documentadora";
  const versao = `v${model.version}`;
  lines.push(
    paint(versao, "gray", style) +
      " ".repeat(Math.max(1, width - versao.length - assinatura.length)) +
      paint(assinatura, "gray", style),
  );
  lines.push(paint("─".repeat(width), "gray", style));
  lines.push("");

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
        ...columns(
          [
            { label: "PROJETO", value: model.project, path: true },
            { label: "STATUS", value: `${MARK[model.status.state]} ${model.status.label}` },
            { label: "DURAÇÃO", value: duration(model.durationSeconds) },
          ],
          width,
          style,
        ),
        "",
        `${paint(padVisible("ETAPA ATUAL", 16), "cyan", style)}${model.stage}`,
        `${paint(padVisible("AGORA", 16), "cyan", style)}${activityLine(model)}`,
      ],
      width,
      style,
    ),
  );

  const pipeline: string[] = [];
  if (model.pipeline.length > 0) {
    const marks = model.pipeline
      .map((step) => paint(`[${MARK[step.state]}]`, TONE[step.state], style))
      .join(paint(" ── ", "gray", style));
    pipeline.push(marks, "");
    for (const step of model.pipeline) {
      const rotulo = padVisible(truncateVisible(step.label, 26), 27);
      pipeline.push(`  ${paint(MARK[step.state], TONE[step.state], style)} ${rotulo}${paint(step.state, "gray", style)}`);
    }
    pipeline.push("", paint("Somente metadados operacionais; o painel não altera a execução.", "gray", style));
  }
  lines.push(...box("PIPELINE · FLUXO DE EXECUÇÃO", pipeline, width, style));

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
        `${paint(padVisible("transporte", 16), "cyan", style)}${model.provider.transporte}`,
        `${paint(padVisible("contabilidade", 16), "cyan", style)}${model.provider.contabilidade}`,
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
        model.events.slice(-10).map((event) => `${paint(`[${event.time}]`, "gray", style)} ${event.text}`),
        width,
        style,
      ),
    );
  }

  lines.push("");
  // O rodapé também cabe: num terminal estreito ele vira a metade que importa.
  lines.push(
    paint(
      width < NARROW ? "Ctrl-C interrompe com estado retomável" : "Ctrl-C interrompe com estado retomável · segredos nunca entram neste painel",
      "gray",
      style,
    ),
  );

  return lines.join("\n");
}

export const PHASE_GATES = ["G0 engine", "G1 escrita", "G2 suíte", "G3 verificação"] as const;
