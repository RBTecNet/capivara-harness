/** Observed work only. Omit total while the amount of work is unknown. */
export interface ProgressMeasurement {
  id: string;
  label: string;
  completed?: number;
  total?: number;
  status: 'running' | 'complete' | 'waiting';
  stage?: string;
  unit?: string;
}

export interface ProgressEvent {
  type: 'progress';
  message: string;
  progress: ProgressMeasurement;
}

/** Observers cannot alter execution, persistence or recovery. */
export function emitEvent<T>(observer: ((event: T) => void) | undefined, event: T): void {
  try { observer?.(event); } catch { /* Presentation is not execution authority. */ }
}

export function emitProgress(observer: ((event: ProgressEvent) => void) | undefined, progress: ProgressMeasurement, message = progress.label): void {
  emitEvent(observer, { type: 'progress', message, progress });
}
