/**
 * Retomada: o estágio é reconstruído a partir dos eventos, não do snapshot.
 *
 * O snapshot pode estar velho — o processo morre entre a transição e a gravação
 * do resumo. O log não pode: cada linha é sincronizada no momento da transição
 * e nenhuma é reescrita. Por isso, quando os dois discordam, o log vence.
 *
 * O que já foi aprovado não é refeito: documento publicado, fase verde e
 * pergunta respondida permanecem. Um run retomado só paga pelo que faltava.
 */

import { readEvents, type RunEvent } from "./events.js";
import { runPaths } from "./paths.js";
import { readRunState, type RunStage, type RunState, type RunStatus } from "./run-store.js";

export interface RunProgress {
  events: number;
  lastEvent: RunEvent | null;
  /** Assuntos cuja última transição foi `complete` ou `skipped`. */
  completed: string[];
  /** Maior tentativa observada por assunto. */
  attempts: Record<string, number>;
  status: RunStatus;
  stage: RunStage | null;
  subject: string | null;
}

export function replayEvents(events: RunEvent[]): RunProgress {
  const lastBySubject = new Map<string, RunEvent>();
  const attempts: Record<string, number> = {};
  let lastEvent: RunEvent | null = null;

  for (const event of events) {
    lastEvent = event;
    if (event.subject !== "-") {
      lastBySubject.set(event.subject, event);
      attempts[event.subject] = Math.max(attempts[event.subject] ?? 0, event.attempt);
    }
  }

  const completed: string[] = [];
  for (const [subject, event] of lastBySubject) {
    // Concluído e depois reaberto não conta: só a ÚLTIMA transição do assunto
    // decide, senão uma fase reprovada em revisão seria pulada na retomada.
    if (event.status === "complete" || event.status === "skipped") completed.push(subject);
  }

  const status: RunStatus =
    lastEvent?.status === "blocked" ? "blocked" : lastEvent?.status === "paused" ? "paused" : "running";

  return {
    events: events.length,
    lastEvent,
    completed,
    attempts,
    status,
    stage: (lastEvent?.stage as RunStage | undefined) ?? null,
    subject: lastEvent?.subject ?? null,
  };
}

/** O primeiro assunto planejado que ainda não foi concluído, ou `null` quando acabou. */
export function nextSubject(progress: RunProgress, planned: readonly string[]): string | null {
  const done = new Set(progress.completed);
  return planned.find((subject) => !done.has(subject)) ?? null;
}

export interface RestoredRun {
  state: RunState;
  progress: RunProgress;
  /** Verdadeiro quando o log estava à frente do snapshot. */
  snapshotWasStale: boolean;
}

export async function restoreRun(projectRoot: string, runId: string): Promise<RestoredRun | null> {
  const state = await readRunState(projectRoot, runId);
  if (!state) return null;

  const progress = replayEvents(await readEvents(runPaths(projectRoot, runId).events));
  const last = progress.lastEvent;
  if (!last) return { state, progress, snapshotWasStale: false };

  const stale = state.stage !== last.stage || state.subject !== last.subject || state.attempt !== last.attempt;

  return {
    state: {
      ...state,
      stage: (last.stage as RunStage) || state.stage,
      subject: last.subject,
      attempt: last.attempt,
      status: progress.status,
    },
    progress,
    snapshotWasStale: stale,
  };
}
