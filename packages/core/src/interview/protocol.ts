/**
 * O lote de perguntas levantado pelo modelo.
 *
 * Uma pergunta sem evidência, sem a decisão que falta ou sem o motivo é
 * rejeitada antes de chegar à tela. Perguntar sem mostrar o que já se sabe faz
 * o desenvolvedor repetir o que já está no prompt, e é a diferença entre uma
 * entrevista e um interrogatório.
 */

import { QUESTIONS_CONTRACT, type Assumption, type Omission, type Question, type QuestionOption } from "./types.js";

export interface QuestionDefect {
  index: number;
  questionId: string;
  problem: string;
  hint: string;
}

export type QuestionBatch =
  | { ok: true; questions: Question[]; assumptions: Assumption[]; omissions: Omission[] }
  | { ok: false; defects: QuestionDefect[] };

const ID = /^Q-\d{2,}$/;
const OMISSION_ID = /^O-\d{2,}$/;

/**
 * Quantas omissões cabem numa entrevista.
 *
 * O teto existe pela mesma razão do teto de perguntas: o desenvolvedor que
 * responde quarenta coisas para documentar um produto pequeno para de responder
 * com cuidado lá pela décima quinta. Quatro é o que cabe depois das seis
 * perguntas sem transformar a entrevista em questionário.
 */
export const MAX_OMISSOES = 4;

/**
 * A pergunta pede mais de uma decisão?
 *
 * Instrução no prompt não basta: o modelo às vezes junta três decisões numa
 * frase, as opções respondem só uma delas, e a resposta volta marcada incompleta
 * sem culpa de quem respondeu. Num run real isso aconteceu com quatro perguntas,
 * e uma delas voltou três vezes — "o que o valor cobre, existe prazo e o que
 * acontece se passar?".
 *
 * A conferência é deliberadamente conservadora, porque reprovar pergunta boa
 * custa uma volta de levantamento. Dois interrogatórios numa frase é prova
 * suficiente; um "e" ligando duas frases interrogativas também. Um "e" simples
 * — "terá login e senha?" — passa, porque é uma decisão só.
 */
const INTERROGATIVO = /\b(o que|que|qual|quais|como|quando|onde|quanto|quantos|existe|existem|haver[áa]|deve|devem|precisa)\b/gi;

export function decisoesJuntas(decision: string): string | null {
  const texto = decision.trim();

  const perguntas = (texto.match(/\?/g) ?? []).length;
  if (perguntas > 1) return `${perguntas} perguntas numa linha`;

  /*
   * Conjunção emendando outra cláusula interrogativa: "…, e o que acontece…",
   * "… e, se existir, …", "…obrigatórios e quais não podem repetir?". As três
   * formas saíram do mesmo run.
   *
   * O interrogativo depois do "e" é o que separa isto de "terá login e senha?",
   * onde o "e" liga duas coisas de UMA decisão.
   */
  const emenda = /\be,?\s*(o que|qual|quais|como|quando|quanto|onde|se)\b/i.exec(texto);
  if (emenda) return `duas decisões ligadas por "${emenda[0].trim()}"`;

  const marcadores = [...texto.matchAll(INTERROGATIVO)];
  if (marcadores.length >= 3) return `${marcadores.length} decisões na mesma frase`;

  return null;
}

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

  /** Tudo o que vale para pergunta vale igual para omissão: é a mesma tela. */
  const ler = (entry: unknown, index: number, formato: RegExp, comoUsar: string): Question => {
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

    if (!formato.test(question.id)) complain("id fora do formato", comoUsar);
    else if (seen.has(question.id)) complain("id repetido", "cada pergunta tem um id único no lote");
    else seen.add(question.id);

    if (question.evidence === "") complain("sem evidência", "declare o que já foi descoberto sobre o tema; perguntar o descobrível é proibido");
    if (question.decision === "") complain("sem a decisão que falta", "escreva a decisão em forma de pergunta objetiva");
    else {
      const juntas = decisoesJuntas(question.decision);
      if (juntas !== null) {
        complain(
          `a pergunta junta mais de uma decisão (${juntas})`,
          "uma decisão por pergunta: quebre em perguntas separadas, cada uma respondível numa frase",
        );
      }
    }
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

    return question;
  };

  root.questions.forEach((entry, index) => {
    questions.push(ler(entry, index, ID, "use Q-01, Q-02, … estáveis entre rodadas"));
  });

  /*
   * As omissões: o que o pedido NÃO diz.
   *
   * Elas vêm em lista própria porque a regra é outra — e porque disputar o teto
   * de seis perguntas seria trocar uma pergunta sobre o que foi dito por uma
   * sobre o que não foi. No MCP_teste as seis eram todas boas e todas
   * necessárias; a edição de clientes não caberia em nenhuma delas.
   *
   * O excedente é cortado em silêncio, e não recusado: um lote inteiro
   * rejeitado custa uma volta de levantamento, e o prompt já diz o teto.
   */
  const omissions: Omission[] = [];
  if (Array.isArray(root.omissions)) {
    root.omissions.slice(0, MAX_OMISSOES).forEach((entry, index) => {
      const record = (entry ?? {}) as Record<string, unknown>;
      const question = ler(entry, index, OMISSION_ID, "use O-01, O-02, … para omissões");
      const include = text(record.include);

      if (question.options.length !== 2) {
        defects.push({
          index,
          questionId: question.id || `#${index + 1}`,
          problem: "omissão sem exatamente duas opções",
          hint: "a omissão é sim ou não: uma opção que inclui a área no escopo e outra que a deixa de fora",
        });
      } else if (!question.options.some((option) => option.label === include)) {
        defects.push({
          index,
          questionId: question.id || `#${index + 1}`,
          problem: "`include` não é o rótulo de nenhuma das opções",
          hint: "declare em `include` o rótulo EXATO da opção que traz a área para o escopo",
        });
      }

      omissions.push({ ...question, include });
    });
  }

  /*
   * A suposição precisa de um canal.
   *
   * O prompt sempre mandou "registre uma suposição de baixo risco em vez de
   * perguntar", e o contrato só aceitava perguntas — então tudo virava pergunta.
   * O piloto 3 chegou a 47 perguntas em três documentos, incluindo quais valores
   * hexadecimais usar numa paleta de etiquetas. Sem saída, a regra de não
   * perguntar o dispensável não tinha como ser obedecida.
   */
  const assumptions: Assumption[] = Array.isArray(root.assumptions)
    ? root.assumptions
        .map((item) => (item ?? {}) as Record<string, unknown>)
        .map((item) => ({
          topic: text(item.topic),
          statement: text(item.statement),
          basis: text(item.basis),
        }))
        .filter((assumption) => assumption.statement !== "")
    : [];

  return defects.length > 0 ? { ok: false, defects } : { ok: true, questions, assumptions, omissions };
}

function stripFence(source: string): string {
  const trimmed = source.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  return fenced?.[1] ?? trimmed;
}
