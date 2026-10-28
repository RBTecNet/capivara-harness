/** Observed work only. Omit total while the amount of work is unknown. */
export interface ProgressMeasurement {
  id: string;
  label: string;
  completed?: number;
  total?: number;
  status: 'running' | 'complete' | 'waiting';
  /** Start of the observed operation, preserved on its terminal measurement. */
  startedAt?: string;
  stage?: string;
  unit?: string;
}

export interface ProgressEvent {
  type: 'progress';
  message: string;
  progress: ProgressMeasurement;
}

/** Visual observations of existing work. These markers never authorize or block execution. */
export type BuildGateId = 'G0' | 'G1' | 'G2' | 'G3' | 'G4';
export type BuildGateStatus = 'pending' | 'running' | 'complete' | 'returned' | 'neutral' | 'waiting';
export interface BuildGateMeasurement {
  taskId: string;
  gate: BuildGateId;
  status: BuildGateStatus;
  attempt: number;
  planRevision: number;
  detail?: string;
}
export interface BuildGateEvent {
  type: 'gate';
  message: string;
  subject: string;
  gate: BuildGateMeasurement;
}

export function emitGate(observer: ((event: BuildGateEvent) => void) | undefined, gate: BuildGateMeasurement): void {
  emitEvent(observer, { type: 'gate', subject: gate.taskId, message: gate.detail ?? `${gate.taskId}: ${gate.gate} ${gate.status}`, gate });
}

/** Observers cannot alter execution, persistence or recovery. */
export function emitEvent<T>(observer: ((event: T) => void) | undefined, event: T): void {
  try { observer?.(event); } catch { /* Presentation is not execution authority. */ }
}

export function emitProgress(observer: ((event: ProgressEvent) => void) | undefined, progress: ProgressMeasurement, message = progress.label): void {
  emitEvent(observer, { type: 'progress', message, progress });
}
