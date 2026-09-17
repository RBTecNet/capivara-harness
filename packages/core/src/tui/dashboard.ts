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

const MIN_WIDTH = 72;
const DEFAULT_WIDTH = 110;

export function dashboardWidth(model: DashboardModel): number {
  return Math.max(MIN_WIDTH, model.width ?? DEFAULT_WIDTH);
}

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
  const cell = Math.floor((inner - (fields.length - 1) * 3) / fields.length);
  const labels = fields.map((field) => padVisible(paint(truncateVisible(field.label, cell), "cyan", style), cell));
  const values = fields.map((field) =>
    padVisible(field.path === true ? truncatePath(field.value, cell) : truncateVisible(field.value, cell), cell),
  );
  const separator = paint(" ┆ ", "gray", style);
  return [labels.join(separator), values.join(separator)];
}

export function renderDashboard(model: DashboardModel): string {
  const width = dashboardWidth(model);
  const { style } = model;
  const lines: string[] = [];

  // Cabeçalho: título em blocos à esquerda, capivara à direita.
  const title = blockText("CAPIVARA").map((line) => paint(line, "cyan", style));
  const mascot = renderCapybara({ style, ...(model.environment !== undefined ? { environment: model.environment } : {}) });
  const titleWidth = Math.max(...blockText("CAPIVARA").map((line) => line.length));
  const gap = Math.max(2, width - titleWidth - 40 - 2);

  const header = Math.max(title.length, mascot.length);
  for (let row = 0; row < header; row += 1) {
    const left = padVisible(title[row] ?? "", titleWidth);
    lines.push(`${left}${" ".repeat(gap)}${mascot[row] ?? ""}`.replace(/\s+$/, ""));
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
      columns(
        [
          { label: "PROJETO", value: model.project, path: true },
          { label: "WORKFLOW", value: model.command },
          { label: "ETAPA ATUAL", value: model.stage },
          { label: "STATUS", value: `${MARK[model.status.state]} ${model.status.label}` },
          { label: "DURAÇÃO", value: duration(model.durationSeconds) },
        ],
        width,
        style,
      ),
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
        `${paint(padVisible("perfil", 16), "cyan", style)}${model.provider.perfil}`,
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

  if (model.events.length > 0) {
    lines.push(
      ...box(
        "EVENTOS RECENTES",
        model.events.slice(-6).map((event) => `${paint(`[${event.time}]`, "gray", style)} ${event.text}`),
        width,
        style,
      ),
    );
  }

  lines.push("");
  lines.push(paint("Ctrl-C interrompe com estado retomável · segredos nunca entram neste painel", "gray", style));

  return lines.join("\n");
}

export const PHASE_GATES = ["G0 engine", "G1 escrita", "G2 suíte", "G3 verificação"] as const;
