import type { Question } from '../domain/types.js';
import type { ProgressMeasurement, BuildGateId, BuildGateStatus, BuildGateMeasurement } from '../telemetry/progress.js';

export type DashboardPanelId = 'summary' | 'progress' | 'phases' | 'environment' | 'activity' | 'log' | 'incidents';
export type DashboardProgress = ProgressMeasurement;
export interface DashboardGate {
  id: BuildGateId;
  status: BuildGateStatus;
  detail?: string;
}
export interface DashboardGateRow {
  taskId: string;
  title: string;
  gates: DashboardGate[];
}

/** Each panel keeps its full text; viewports and overlays choose how much to render. */
export interface DashboardPanel {
  id: DashboardPanelId;
  title: string;
  lines: string[];
  /** Compact rows for the dashboard; expanded panels always use the complete lines. */
  previewLines?: string[];
  progress: DashboardProgress[];
  gateRows?: DashboardGateRow[];
}

export interface DashboardUsage {
  calls: number;
  /** Input plus output of the latest call that reported both quantities. */
  currentTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  costUsd?: number;
}

export interface DashboardView {
  status: string;
  stage: string;
  panels: DashboardPanel[];
  progress: DashboardProgress[];
  usage: DashboardUsage;
  pendingDecisions: number;
  pendingQuestion?: Question;
  updatedAt?: string;
}

/** Domain, runtime, execution and stored events share this observational boundary. */
export interface DashboardEvent {
  type: string;
  message?: string;
  subject?: string;
  detail?: unknown;
  progress?: DashboardProgress;
  gate?: BuildGateMeasurement;
  at?: string;
  /** Stored event bodies may arrive directly from SQLite. */
  body?: unknown;
}
