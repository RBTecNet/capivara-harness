/**
 * Dashboard ao vivo.
 *
 * Mostra em que estágio o run está, quanto já custou e como está cada gate da
 * fase corrente. O custo ao lado do progresso é o que impede a surpresa que o
 * harness anterior produzia: trinta minutos e quase dois dólares sem publicar
 * nada, sem que a tela dissesse o que estava acontecendo.
 */

import { paint, padVisible, truncateVisible, type Style } from "./ansi.js";

export type GateState = "pendente" | "rodando" | "verde" | "vermelho" | "pulado";

export interface DashboardModel {
  command: "init" | "build";
  stage: string;
  subject: string;
  attempt: number;
  maxAttempts: number;
  /** Papel e modelo da chamada em curso, quando há uma. */
  active: { role: string; model: string; elapsedSeconds: number } | null;
  gates: { name: string; state: GateState }[];
  phases: { id: string; title: string; state: GateState }[];
  costs: { role: string; calls: number; seconds: number }[];
  recent: string[];
  style: Style;
}

const SYMBOL: Record<GateState, string> = {
  pendente: "·",
  rodando: "◐",
  verde: "✓",
  vermelho: "✗",
  pulado: "–",
};

const COLOR: Record<GateState, "gray" | "cyan" | "green" | "red" | "yellow"> = {
  pendente: "gray",
  rodando: "cyan",
  verde: "green",
  vermelho: "red",
  pulado: "yellow",
};

export function renderDashboard(model: DashboardModel): string {
  const { style } = model;
  const lines: string[] = [];

  lines.push(
    `${paint("capivara", "bold", style)} ${paint(model.command, "cyan", style)} · ${model.stage}` +
      (model.subject !== "-" ? ` · ${model.subject}` : "") +
      (model.maxAttempts > 1 ? paint(` · tentativa ${model.attempt}/${model.maxAttempts}`, "gray", style) : ""),
  );

  if (model.active) {
    lines.push(
      paint(
        `  ${model.active.role} · ${model.active.model || "modelo padrão"} · ${model.active.elapsedSeconds}s`,
        "gray",
        style,
      ),
    );
  }

  if (model.phases.length > 0) {
    lines.push("");
    for (const phase of model.phases) {
      lines.push(
        `  ${paint(SYMBOL[phase.state], COLOR[phase.state], style)} ${padVisible(phase.id, 5)}${truncateVisible(phase.title, 50)}`,
      );
    }
  }

  if (model.gates.length > 0) {
    lines.push("");
    lines.push(
      `  ${model.gates.map((gate) => `${paint(SYMBOL[gate.state], COLOR[gate.state], style)} ${gate.name}`).join("   ")}`,
    );
  }

  if (model.costs.length > 0) {
    lines.push("");
    for (const cost of model.costs) {
      lines.push(paint(`  ${padVisible(cost.role, 10)}${cost.calls} chamada(s) · ${cost.seconds}s`, "gray", style));
    }
  }

  if (model.recent.length > 0) {
    lines.push("");
    for (const entry of model.recent.slice(-5)) lines.push(paint(`  ${truncateVisible(entry, 74)}`, "gray", style));
  }

  return lines.join("\n");
}

export const PHASE_GATES = ["G0 engine", "G1 escrita", "G2 suíte", "G3 verificação"] as const;
