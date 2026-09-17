/**
 * O lote de perguntas levantado pelo modelo.
 *
 * Uma pergunta sem evidência, sem a decisão que falta ou sem o motivo é
 * rejeitada antes de chegar à tela. Perguntar sem mostrar o que já se sabe faz
 * o desenvolvedor repetir o que já está no prompt, e é a diferença entre uma
 * entrevista e um interrogatório.
 */

import { QUESTIONS_CONTRACT, type Question, type QuestionOption } from "./types.js";

export interface QuestionDefect {
  index: number;
  questionId: string;
  problem: string;
  hint: string;
}

export type QuestionBatch =
  | { ok: true; questions: Question[] }
  | { ok: false; defects: QuestionDefect[] };

const ID = /^Q-\d{2,}$/;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function options(value: unknown): QuestionOption[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const record = (entry ?? {}) as Record<string, unknown>;
      return { label: text(record.label), consequence: text(record.consequence) };
    })
    .filter((option) => option.label !== "");
}

/** Lê e valida o lote. Entrada não confiável: o modelo erra, e a tela não pode. */
export function parseQuestionBatch(source: string): QuestionBatch {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(source));
  } catch {
    return {
      ok: false,
      defects: [{ index: 0, questionId: "-", problem: "a resposta não é JSON válido", hint: `devolva um objeto { "contract": "${QUESTIONS_CONTRACT}", "questions": [...] } sem cerca de código` }],
    };
  }

  const root = (parsed ?? {}) as Record<string, unknown>;
  if (root.contract !== QUESTIONS_CONTRACT) {
    return {
      ok: false,
      defects: [{ index: 0, questionId: "-", problem: `contrato ausente ou diferente de ${QUESTIONS_CONTRACT}`, hint: `declare "contract": "${QUESTIONS_CONTRACT}" na raiz` }],
    };
  }
  if (!Array.isArray(root.questions)) {
    return { ok: false, defects: [{ index: 0, questionId: "-", problem: "questions não é uma lista", hint: "devolva uma lista, mesmo que vazia quando não há gap material" }] };
  }

  const defects: QuestionDefect[] = [];
  const questions: Question[] = [];
  const seen = new Set<string>();

  root.questions.forEach((entry, index) => {
    const record = (entry ?? {}) as Record<string, unknown>;
    const question: Question = {
      id: text(record.id),
      topic: text(record.topic),
      evidence: text(record.evidence),
      decision: text(record.decision),
      why: text(record.why),
      options: options(record.options),
      recommended: text(record.recommended),
      recommendationBasis: text(record.recommendationBasis),
    };

    const complain = (problem: string, hint: string): void => {
      defects.push({ index, questionId: question.id || `#${index + 1}`, problem, hint });
    };

    if (!ID.test(question.id)) complain("id fora do formato", "use Q-01, Q-02, … estáveis entre rodadas");
    else if (seen.has(question.id)) complain("id repetido", "cada pergunta tem um id único no lote");
    else seen.add(question.id);

    if (question.evidence === "") complain("sem evidência", "declare o que já foi descoberto sobre o tema; perguntar o descobrível é proibido");
    if (question.decision === "") complain("sem a decisão que falta", "escreva a decisão em forma de pergunta objetiva");
    if (question.why === "") complain("sem o motivo", "diga o que muda no resultado conforme a resposta");

    if (question.options.length === 1) {
      complain("uma única opção não é uma escolha", "ofereça de 2 a 4 opções concretas, ou nenhuma quando a pergunta for aberta");
    }
    if (question.options.length > 1) {
      if (question.recommended === "") complain("opções sem recomendação", "aponte a opção recomendada e a evidência que a sustenta");
      else if (!question.options.some((option) => option.label === question.recommended)) {
        complain("a recomendação não é uma das opções", "a recomendação precisa ser exatamente o rótulo de uma das opções");
      }
      if (question.options.some((option) => option.consequence === "")) {
        complain("opção sem consequência", "toda opção declara o que acontece se for escolhida");
      }
    }

    questions.push(question);
  });

  return defects.length > 0 ? { ok: false, defects } : { ok: true, questions };
}

function stripFence(source: string): string {
  const trimmed = source.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  return fenced?.[1] ?? trimmed;
}
