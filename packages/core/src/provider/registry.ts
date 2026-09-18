/**
 * O catálogo de providers.
 *
 * Raciocínio é um modo separado e caro. A ausência de `--effort` não pode
 * herdar o default do provider: já houve run em que o modelo gastou toda a cota
 * de saída em raciocínio sem emitir um único documento. Por isso cada provider
 * declara aqui o que "sem effort" significa, e o runtime pergunta ao catálogo
 * em vez de testar um id no ponto de chamada.
 */

import { CLI_ADAPTERS, isCliProvider } from "./cli/index.js";
import type { CliProviderId } from "./cli/index.js";

/*
 * A lista de CLIs vem dos adaptadores, não de uma constante paralela: duas
 * listas do mesmo conjunto acabam divergindo, e a que ninguém atualiza é sempre
 * a que o usuário lê.
 */
export const CLI_PROVIDERS = CLI_ADAPTERS.map((adapter) => adapter.id) as readonly CliProviderId[];
export const DIRECT_PROVIDERS = ["openai", "anthropic", "gemini", "deepseek", "minimax", "openrouter"] as const;

export type { CliProviderId };
export type DirectProviderId = (typeof DIRECT_PROVIDERS)[number];
export { isCliProvider };
export type ProviderId = CliProviderId | DirectProviderId;

export type Dialect = "openai-chat" | "anthropic-messages";

export interface ReasoningPolicy {
  /** O que um `--effort` omitido significa. A resposta econômica é `disabled`. */
  defaultMode: "disabled" | "enabled";
  /** Efforts que ligam o raciocínio, em intensidade crescente. */
  supported: readonly string[];
  /** Intensidade usada quando `defaultMode` é `enabled` e nenhum effort veio. */
  fallback?: string;
}

export interface DirectProvider {
  id: DirectProviderId;
  label: string;
  dialect: Dialect;
  endpoint: string;
  envKey: string;
  reasoning: ReasoningPolicy;
}

export interface CliProvider {
  id: CliProviderId;
  label: string;
  binaryEnv: string;
  defaultBinary: string;
}

/** O catálogo é a própria lista de adaptadores, vista de fora. */
export const CLI_CATALOG: readonly CliProvider[] = CLI_ADAPTERS.map((adapter) => ({
  id: adapter.id,
  label: adapter.label,
  binaryEnv: adapter.binaryEnv,
  defaultBinary: adapter.defaultBinary,
}));

const OFF: ReasoningPolicy = { defaultMode: "disabled", supported: ["low", "medium", "high"] };

export const DIRECT_CATALOG: readonly DirectProvider[] = [
  { id: "openai", label: "OpenAI API", dialect: "openai-chat", endpoint: "https://api.openai.com/v1/chat/completions", envKey: "OPENAI_API_KEY", reasoning: { defaultMode: "disabled", supported: ["minimal", "low", "medium", "high"] } },
  { id: "anthropic", label: "Claude API (Anthropic)", dialect: "anthropic-messages", endpoint: "https://api.anthropic.com/v1/messages", envKey: "ANTHROPIC_API_KEY", reasoning: OFF },
  { id: "gemini", label: "Gemini API", dialect: "openai-chat", endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", envKey: "GEMINI_API_KEY", reasoning: OFF },
  { id: "deepseek", label: "DeepSeek API", dialect: "openai-chat", endpoint: "https://api.deepseek.com/chat/completions", envKey: "DEEPSEEK_API_KEY", reasoning: OFF },
  { id: "minimax", label: "MiniMax API", dialect: "openai-chat", endpoint: "https://api.minimax.io/v1/text/chatcompletion_v2", envKey: "MINIMAX_API_KEY", reasoning: OFF },
  { id: "openrouter", label: "OpenRouter", dialect: "openai-chat", endpoint: "https://openrouter.ai/api/v1/chat/completions", envKey: "OPENROUTER_API_KEY", reasoning: OFF },
];

export function isDirectProvider(id: string): id is DirectProviderId {
  return (DIRECT_PROVIDERS as readonly string[]).includes(id);
}

export function directProvider(id: DirectProviderId): DirectProvider {
  const found = DIRECT_CATALOG.find((provider) => provider.id === id);
  if (!found) throw new Error(`provider direto desconhecido: ${id}`);
  return found;
}

export function cliProvider(id: CliProviderId): CliProvider {
  const found = CLI_CATALOG.find((provider) => provider.id === id);
  if (!found) throw new Error(`provider de CLI desconhecido: ${id}`);
  return found;
}

export interface ReasoningDecision {
  enabled: boolean;
  effort: string | null;
  /** Uma frase honesta para o log e para a ajuda. */
  description: string;
}

/**
 * Decide se esta chamada pede raciocínio.
 *
 * Nunca herda o default do provider: sem `--effort`, o catálogo manda, e o
 * catálogo diz `disabled`.
 */
export function decideReasoning(provider: DirectProvider, effort: string): ReasoningDecision {
  const requested = effort.trim();
  if (requested === "") {
    if (provider.reasoning.defaultMode === "disabled") {
      return { enabled: false, effort: null, description: "raciocínio desligado (nenhum --effort informado)" };
    }
    const fallback = provider.reasoning.fallback ?? provider.reasoning.supported[0] ?? null;
    return { enabled: fallback !== null, effort: fallback, description: `raciocínio em ${fallback ?? "desligado"} (default do catálogo)` };
  }
  if (requested === "none" || requested === "off" || requested === "disabled") {
    return { enabled: false, effort: null, description: "raciocínio desligado por pedido explícito" };
  }
  return { enabled: true, effort: requested, description: `raciocínio em ${requested}` };
}
