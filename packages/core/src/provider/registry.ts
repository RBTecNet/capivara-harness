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
  /** O que a documentação do provider diz de modelos que fogem da regra do catálogo. */
  modelos?: readonly { padrao: RegExp; raciocinio: RaciocinioDoModelo }[];
}

/** O raciocínio de um modelo, como a documentação do provider o declara (§131). */
export interface RaciocinioDoModelo {
  /** A API aceita desligar o raciocínio deste modelo. */
  desligavel: boolean;
  /** Os níveis do parâmetro de intensidade, em ordem crescente; vazio quando o modelo só liga ou desliga. */
  niveis: readonly string[];
  /** O nível que a API usa quando nenhum é enviado, quando a documentação o diz. */
  padrao?: string;
}

export interface DirectProvider {
  id: DirectProviderId;
  label: string;
  dialect: Dialect;
  endpoint: string;
  /** Descoberta explícita quando o endereço não se deriva do endpoint de inferência. */
  modelsEndpoint?: string;
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

/*
 * MiniMax, pela referência oficial das APIs compatíveis com OpenAI e com
 * Anthropic (platform.minimax.io/docs/api-reference/text-openai-api e
 * text-anthropic-api), conferida em 2026-10-22. O `/v1/models` só devolve os
 * identificadores, sem capacidade nenhuma; por isso ela fica aqui, num lugar só.
 *
 * - MiniMax-M3.1-Flash sempre raciocina: `thinking.type: "disabled"` (e
 *   `reasoning_effort: "none"`) volta HTTP 400, código 2013 — o que o plan do
 *   `init-dc741f0d7b92` registrou. A intensidade é `reasoning_effort` (OpenAI)
 *   ou `output_config.effort` (Anthropic), de low a max; omitida, vale max. O
 *   catálogo atual chama o modelo sem o "-Preview" da prévia.
 * - MiniMax-M3 desliga e liga (`adaptive`), sem parâmetro de intensidade.
 * - M2.x não desliga — o `disabled` é ignorado e o raciocínio seria cobrado —,
 *   e também não tem intensidade.
 */
const MINIMAX_MODELOS: ReasoningPolicy["modelos"] = [
  { padrao: /^MiniMax-M3\.1-Flash(?:-Preview)?$/, raciocinio: { desligavel: false, niveis: ["low", "medium", "high", "xhigh", "max"], padrao: "max" } },
  { padrao: /^MiniMax-M3$/, raciocinio: { desligavel: true, niveis: [] } },
  { padrao: /^MiniMax-M2(?:[.-]|$)/, raciocinio: { desligavel: false, niveis: [] } },
];

export const DIRECT_CATALOG: readonly DirectProvider[] = [
  { id: "openai", label: "OpenAI API", dialect: "openai-chat", endpoint: "https://api.openai.com/v1/chat/completions", envKey: "OPENAI_API_KEY", reasoning: { defaultMode: "disabled", supported: ["minimal", "low", "medium", "high"] } },
  { id: "anthropic", label: "Claude API (Anthropic)", dialect: "anthropic-messages", endpoint: "https://api.anthropic.com/v1/messages", envKey: "ANTHROPIC_API_KEY", reasoning: OFF },
  { id: "gemini", label: "Gemini API", dialect: "openai-chat", endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", envKey: "GEMINI_API_KEY", reasoning: OFF },
  { id: "deepseek", label: "DeepSeek API", dialect: "openai-chat", endpoint: "https://api.deepseek.com/chat/completions", envKey: "DEEPSEEK_API_KEY", reasoning: OFF },
  { id: "minimax", label: "MiniMax API", dialect: "openai-chat", endpoint: "https://api.minimax.io/v1/chat/completions", modelsEndpoint: "https://api.minimax.io/v1/models", envKey: "MINIMAX_API_KEY", reasoning: { ...OFF, modelos: MINIMAX_MODELOS } },
  { id: "openrouter", label: "OpenRouter", dialect: "openai-chat", endpoint: "https://openrouter.ai/api/v1/chat/completions", envKey: "OPENROUTER_API_KEY", reasoning: OFF },
];

export function isDirectProvider(id: string): id is DirectProviderId {
  return (DIRECT_PROVIDERS as readonly string[]).includes(id);
}

/** O identificador da API no catálogo do OpenCode. */
export function opencodeProviderId(id: string): string {
  return id === "gemini" ? "google" : id;
}

/** O raciocínio documentado deste modelo, ou null quando a documentação nada declara além do catálogo. */
export function raciocinioDoModelo(provider: DirectProvider, modelo: string): RaciocinioDoModelo | null {
  return provider.reasoning.modelos?.find((entrada) => entrada.padrao.test(modelo))?.raciocinio ?? null;
}

/**
 * Os efforts que o modelo aceita, no vocabulário de `--effort`: `none` desliga,
 * os níveis ligam com intensidade, e `thinking` liga quando o modelo não tem
 * intensidade — o mesmo nome que o OpenCode dá a essa variante do MiniMax-M3.
 */
export function effortsDoModelo(raciocinio: RaciocinioDoModelo): string[] {
  return [...(raciocinio.desligavel ? ["none"] : []), ...(raciocinio.niveis.length > 0 ? raciocinio.niveis : ["thinking"])];
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
