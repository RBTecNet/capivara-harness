/**
 * O motor de rodadas.
 *
 * A rodada 1 pergunta tudo o que é material. As seguintes reperguntam apenas o
 * que continua aberto, de forma estreita — nunca reabrem uma decisão aceita,
 * porque reabrir é como uma entrevista deixa de convergir e o desenvolvedor
 * passa a responder a mesma coisa de três formas diferentes.
 *
 * Esgotado o teto, o que restou vira `[NEEDS DECISION]`. Nunca uma suposição
 * silenciosa: o gate de prontidão precisa poder recusar o documento.
 */

import { UNRESOLVED, type Answer, type Assumption, type Checkpoint, type Question } from "./types.js";

export interface RoundState {
  round: number;
  questions: Question[];
  answers: Answer[];
  assumptions: Assumption[];
  maxRounds: number;
}

export interface RoundPlan {
  /** Perguntas a apresentar nesta rodada. Vazio significa convergiu. */
  ask: Question[];
  converged: boolean;
  capReached: boolean;
}

/** A última resposta de cada pergunta — respostas anteriores viram histórico. */
export function latestAnswers(answers: readonly Answer[]): Map<string, Answer> {
  const latest = new Map<string, Answer>();
  for (const answer of answers) latest.set(answer.questionId, answer);
  return latest;
}

export function planRound(state: RoundState): RoundPlan {
  const latest = latestAnswers(state.answers);
  const pending = state.questions.filter((question) => {
    const answer = latest.get(question.id);
    if (!answer) return true;
    return UNRESOLVED.includes(answer.disposition);
  });

  const capReached = state.round > state.maxRounds;
  if (capReached) return { ask: [], converged: false, capReached: true };

  return { ask: pending, converged: pending.length === 0, capReached: false };
}

/** Uma decisão aceita nunca é reaberta, nem por uma pergunta nova sobre o mesmo id. */
export function isSettled(answers: readonly Answer[], questionId: string): boolean {
  const answer = latestAnswers(answers).get(questionId);
  return answer?.disposition === "ACCEPTED";
}

export interface UnresolvedItem {
  questionId: string;
  topic: string;
  statement: string;
  disposition: "DEFERRED" | "PARTIAL" | "AMBIGUOUS" | "CONTRADICTED";
}

export function unresolved(state: RoundState): UnresolvedItem[] {
  const latest = latestAnswers(state.answers);
  const items: UnresolvedItem[] = [];
  for (const question of state.questions) {
    const answer = latest.get(question.id);
    const disposition = answer?.disposition ?? "DEFERRED";
    if (disposition === "ACCEPTED") continue;
    items.push({
      questionId: question.id,
      topic: question.topic,
      statement: answer?.open || question.decision,
      disposition,
    });
  }
  return items;
}

/** O marcador que bloqueia o gate de prontidão, um por item não resolvido. */
export function needsDecisionMarkers(state: RoundState): string[] {
  return unresolved(state).map((item) => `[NEEDS DECISION] ${item.topic}: ${item.statement}`);
}

export function buildCheckpoint(state: RoundState): Checkpoint {
  const latest = latestAnswers(state.answers);
  const decisions: Checkpoint["decisions"] = [];
  const deferrals: Checkpoint["deferrals"] = [];
  const ambiguities: Checkpoint["ambiguities"] = [];

  for (const question of state.questions) {
    const answer = latest.get(question.id);
    if (answer?.disposition === "ACCEPTED") {
      decisions.push({ questionId: question.id, topic: question.topic, decision: answer.decision });
      continue;
    }
    const item = { questionId: question.id, topic: question.topic, statement: answer?.open || question.decision };
    if (!answer || answer.disposition === "DEFERRED") deferrals.push(item);
    else ambiguities.push(item);
  }

  return { decisions, assumptions: state.assumptions, deferrals, ambiguities };
}
