export { QUESTIONS_CONTRACT, UNRESOLVED } from "./types.js";
export type {
  Answer,
  Assumption,
  Checkpoint,
  Disposition,
  Handoff,
  Omission,
  OpenDecision,
  Question,
  QuestionOption,
} from "./types.js";
export { MAX_OMISSOES, decisoesJuntas, parseQuestionBatch } from "./protocol.js";
export { ehOmissao, naoObjetivos } from "./omissions.js";
export type { QuestionBatch, QuestionDefect } from "./protocol.js";
export { buildAnswer, classifyLocally, isNonAnswer, parseClassification } from "./classify.js";
export type { LocalClassification, ModelVerdict } from "./classify.js";
export {
  buildCheckpoint,
  isSettled,
  latestAnswers,
  needsDecisionMarkers,
  planRound,
  unresolved,
} from "./rounds.js";
export type { RoundPlan, RoundState, UnresolvedItem } from "./rounds.js";
export { HANDOFF_CONTRACT, handoffPath, readHandoff, writeHandoff } from "./handoff.js";
export { ID_DO_BANCO, PERGUNTA_DO_BANCO, bancoNoPedido, decisaoDeBanco, perguntaDoBanco, regrasDeBanco } from "./banco.js";
export type { DecisaoDeBanco } from "./banco.js";
