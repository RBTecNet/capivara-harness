import type { AgentCaller, AskDeveloper, DeveloperRequest } from "../init/index.js";
import type { Answer, Assumption, Question } from "../interview/index.js";
import type { McpDocument } from "../mcp/index.js";

export const PROMPT_CONTRACT = "capivara-prompt/v1" as const;
export type PromptLanguage = "en" | "pt";

export interface PromptEngineerOptions {
  projectRoot: string;
  request: DeveloperRequest;
  writer: AgentCaller;
  askQuestion: AskDeveloper;
  /** English by default; accepts English/Portuguese locale and language names. */
  language?: string;
  library?: readonly McpDocument[];
  /** Discovery and clarification are bounded; unfinished decisions stay explicit. */
  maxRounds?: number;
  /** Maximum number of questions presented, including repeated clarifications. */
  maxQuestions?: number;
  announce?: (message: string) => void;
  now?: () => Date;
}

export interface PromptOpenQuestion {
  questionId: string;
  topic: string;
  statement: string;
  disposition: "DEFERRED" | "PARTIAL" | "AMBIGUOUS" | "CONTRADICTED";
}

export interface EngineeredPrompt {
  prompt: string;
  language: PromptLanguage;
  questions: Question[];
  answers: Answer[];
  assumptions: Assumption[];
  openQuestions: PromptOpenQuestion[];
  rounds: number;
  coverage: "sufficient" | "open";
  limitReached: boolean;
}

export type PromptEngineerErrorCode = "invalid-options" | "invalid-interview" | "invalid-prompt" | "provider-failed";

export class PromptEngineerError extends Error {
  constructor(message: string, public readonly code: PromptEngineerErrorCode = "provider-failed") {
    super(message);
    this.name = "PromptEngineerError";
  }
}

export function promptLanguage(value?: string): PromptLanguage {
  const language = value?.trim().toLowerCase() ?? "en";
  if (/^(?:en(?:[-_]\w+)?|english|ingl[eê]s)$/.test(language)) return "en";
  if (/^(?:pt(?:[-_]\w+)?|portugu[eê]s(?: do brasil)?|portuguese(?: \(brazil\))?)$/.test(language)) return "pt";
  throw new PromptEngineerError(`idioma de prompt não suportado: ${value}; use en ou pt-BR`, "invalid-options");
}

export interface PromptStatement {
  id: string;
  statement: string;
}

export interface PromptDraft {
  contract: typeof PROMPT_CONTRACT;
  language: PromptLanguage;
  objective: string;
  context: string[];
  requirements: string[];
  constraints: string[];
  steps: string[];
  acceptanceCriteria: string[];
  deliverables: string[];
  /** Translations keyed by ledger IDs; the model cannot add or hide ledger items. */
  confirmedDecisions: PromptStatement[];
  assumptions: PromptStatement[];
  openQuestions: PromptStatement[];
}
