/**
 * O vocabulário da entrevista.
 *
 * `ACCEPTED` é a única disposição que vira decisão confirmada. As outras quatro
 * existem para impedir o erro que mais custa caro: transformar uma resposta
 * vaga em prosa confiante, e depois construir uma aplicação sobre ela.
 */

export const QUESTIONS_CONTRACT = "capivara-questions/v1" as const;

export type Disposition = "ACCEPTED" | "PARTIAL" | "AMBIGUOUS" | "DEFERRED" | "CONTRADICTED";

/** As disposições que exigem repergunta enquanto a parte aberta for material. */
export const UNRESOLVED: readonly Disposition[] = ["PARTIAL", "AMBIGUOUS", "CONTRADICTED"];

export interface QuestionOption {
  label: string;
  /** O que acontece se esta opção for escolhida. */
  consequence: string;
}

export interface Question {
  id: string;
  topic: string;
  /** O que já se descobriu sem perguntar. Perguntar o descobrível é proibido. */
  evidence: string;
  /** A decisão que falta, em forma de pergunta. */
  decision: string;
  /** Por que importa: o que muda no resultado conforme a resposta. */
  why: string;
  options: QuestionOption[];
  /** Opção recomendada, quando há opções. Deve ser uma delas. */
  recommended: string;
  recommendationBasis: string;
  /**
   * O que a resposta anterior deixou em aberto, quando esta pergunta volta.
   *
   * Quem classificou a resposta escreveu exatamente o que faltava — e isso
   * morria no handoff. O desenvolvedor via a MESMA pergunta pela segunda e
   * terceira vez, idêntica, sem nada indicando o que ainda faltava dizer; a
   * conclusão natural é que a resposta não foi lida. É a família do §31: o
   * harness sabia e não contava.
   */
  pending?: string;
}

/**
 * Uma área que o pedido não menciona.
 *
 * Não é ambiguidade do que foi dito — para isso existe `Question`. É ausência:
 * o pedido descreve cadastrar clientes e nunca fala em alterá-los, e quem
 * escreveu não decidiu que alterar está fora, apenas não pensou nisso. O
 * MCP_teste terminou com cinco fases verdes e sem tela de edição de cliente
 * nenhuma, porque ninguém perguntou.
 *
 * Ela é uma pergunta como as outras — é respondida, classificada e reperguntada
 * pelo mesmo caminho —, com uma diferença: o harness precisa saber qual das
 * duas opções INCLUI a área, para transformar a recusa em não-objetivo escrito
 * em vez de em silêncio.
 */
export interface Omission extends Question {
  /** O rótulo exato da opção que traz a área para o escopo. */
  include: string;
}

export interface Answer {
  questionId: string;
  /** A resposta crua, preservada sempre e nunca sobrescrita pela normalização. */
  raw: string;
  disposition: Disposition;
  /** A decisão normalizada; vazia quando a disposição não é ACCEPTED. */
  decision: string;
  /** O que continua aberto, para a repergunta estreita. */
  open: string;
  round: number;
  answeredAt: string;
}

export interface Assumption {
  topic: string;
  statement: string;
  /** Por que assumir isto é de baixo risco. */
  basis: string;
}

export interface OpenDecision {
  questionId: string;
  topic: string;
  statement: string;
}

export interface Checkpoint {
  decisions: { questionId: string; topic: string; decision: string }[];
  assumptions: Assumption[];
  deferrals: OpenDecision[];
  ambiguities: OpenDecision[];
}

export interface Handoff {
  contract: "capivara-handoff/v1";
  runId: string;
  language: string;
  document: string;
  round: number;
  questions: Question[];
  answers: Answer[];
  assumptions: Assumption[];
  updatedAt: string;
}
