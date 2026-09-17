/**
 * Classificação da resposta.
 *
 * Duas camadas. A determinística resolve o que não depende de semântica —
 * escolher uma opção pelo número, adiar, aceitar as recomendações — e nunca
 * chama modelo para isso. O resto vai para o classificador do modelo, cujo
 * veredito é lido pelo protocolo abaixo.
 *
 * A regra que não se negocia: `não sei` é DEFERRED, nunca uma confirmação
 * implícita da recomendação que estava na tela. Aceitar por omissão é como uma
 * suposição vira "decisão do desenvolvedor" no documento.
 */

import type { Answer, Disposition, Question } from "./types.js";

const DEFER = /^(?:não sei|nao sei|sei lá|sei la|não faço ideia|nao faco ideia|tanto faz|depois|decido depois|defer|deferir|not sure|dunno)\.?$/i;
const USE_RECOMMENDATIONS = /^(?:use as recomenda(?:ç|c)(?:ões|oes)|usar as recomenda(?:ç|c)(?:ões|oes)|usa a recomenda(?:ç|c)(?:ão|ao)|use a recomenda(?:ç|c)(?:ão|ao)|recomenda(?:ç|c)(?:ão|ao)|use recommendations)\.?$/i;

export interface LocalClassification {
  disposition: Disposition;
  decision: string;
  open: string;
  /** Falso quando só um modelo consegue decidir a disposição. */
  settled: boolean;
}

export function classifyLocally(question: Question, raw: string): LocalClassification {
  const answer = raw.trim();

  if (answer === "") {
    return { disposition: "DEFERRED", decision: "", open: question.decision, settled: true };
  }

  if (DEFER.test(answer)) {
    // Nunca confirma a recomendação por implicação.
    return { disposition: "DEFERRED", decision: "", open: question.decision, settled: true };
  }

  if (USE_RECOMMENDATIONS.test(answer)) {
    if (question.recommended === "") {
      return { disposition: "DEFERRED", decision: "", open: question.decision, settled: true };
    }
    return { disposition: "ACCEPTED", decision: question.recommended, open: "", settled: true };
  }

  const chosen = optionByNumber(question, answer) ?? optionByLabel(question, answer);
  if (chosen) {
    return { disposition: "ACCEPTED", decision: chosen, open: "", settled: true };
  }

  return { disposition: "PARTIAL", decision: "", open: question.decision, settled: false };
}

function optionByNumber(question: Question, answer: string): string | null {
  if (!/^\d+$/.test(answer)) return null;
  const index = Number(answer) - 1;
  return question.options[index]?.label ?? null;
}

function optionByLabel(question: Question, answer: string): string | null {
  const normalized = answer.toLowerCase();
  return question.options.find((option) => option.label.toLowerCase() === normalized)?.label ?? null;
}

/**
 * Protocolo do classificador do modelo.
 *
 * Texto plano, uma linha por pergunta, cada chave na primeira coluna:
 *   CAPIVARA_ANSWER: <id> | <DISPOSITION> | <decisão normalizada ou o que falta>
 */
const ANSWER_LINE = /^CAPIVARA_ANSWER:\s*([^|]+?)\s*\|\s*(ACCEPTED|PARTIAL|AMBIGUOUS|DEFERRED|CONTRADICTED)\s*\|\s*(.*?)\s*$/;

export interface ModelVerdict {
  questionId: string;
  disposition: Disposition;
  text: string;
}

export function parseClassification(output: string): ModelVerdict[] {
  const verdicts: ModelVerdict[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = ANSWER_LINE.exec(line.replace(/\r$/, ""));
    if (!match) continue;
    verdicts.push({
      questionId: (match[1] ?? "").trim(),
      disposition: match[2] as Disposition,
      text: (match[3] ?? "").trim(),
    });
  }
  return verdicts;
}

export function buildAnswer(
  question: Question,
  raw: string,
  classification: { disposition: Disposition; decision: string; open: string },
  round: number,
  now = () => new Date(),
): Answer {
  const accepted = classification.disposition === "ACCEPTED";
  return {
    questionId: question.id,
    raw,
    disposition: classification.disposition,
    // Só ACCEPTED carrega decisão; qualquer outra disposição com texto de
    // decisão viraria confirmação silenciosa de algo que não foi confirmado.
    decision: accepted ? classification.decision : "",
    open: accepted ? "" : classification.open || question.decision,
    round,
    answeredAt: now().toISOString(),
  };
}
