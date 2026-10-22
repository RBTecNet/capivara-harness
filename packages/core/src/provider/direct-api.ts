/** APIs de texto dos papéis de leitura. Não executa ferramentas nem subprocessos. */
import { effortsDoModelo, raciocinioDoModelo, type DirectProvider, type ReasoningDecision } from "./registry.js";
import type { RunOptions, RunResult } from "./supervisor.js";
import type { TokenUsage } from "./transcript.js";
import { redact } from "./redact.js";

export interface DirectApiInvocation {
  provider: DirectProvider;
  model: string;
  reasoning: ReasoningDecision;
}

function requestBody(api: DirectApiInvocation, prompt: string, maxOutputTokens: number): Record<string, unknown> {
  const { provider, model, reasoning } = api;
  const body: Record<string, unknown> = { model, messages: [{ role: "user", content: prompt }], stream: false };
  if (provider.dialect === "anthropic-messages") {
    const budgets: Record<string, number> = { low: 1024, medium: 4096, high: 8192, max: 16384 };
    body.max_tokens = maxOutputTokens;
    body.thinking = reasoning.enabled
      ? { type: "enabled", budget_tokens: budgets[reasoning.effort ?? "medium"] ?? 4096 }
      : { type: "disabled" };
  } else if (provider.id === "minimax") {
    body.max_completion_tokens = maxOutputTokens;
    body.thinking = { type: reasoning.enabled ? "adaptive" : "disabled" };
    body.reasoning_split = true;
    if (reasoning.enabled && reasoning.effort && reasoning.effort !== "thinking") body.reasoning_effort = reasoning.effort;
  } else if (provider.id === "deepseek") {
    body.max_tokens = maxOutputTokens;
    body.thinking = { type: reasoning.enabled ? "enabled" : "disabled" };
    if (reasoning.enabled) body.reasoning_effort = reasoning.effort;
  } else if (provider.id === "openrouter") {
    body.max_tokens = maxOutputTokens;
    body.reasoning = { enabled: reasoning.enabled, ...(reasoning.enabled ? { effort: reasoning.effort } : {}) };
  } else {
    body.max_completion_tokens = maxOutputTokens;
    body.reasoning_effort = reasoning.enabled ? reasoning.effort : "none";
  }
  return body;
}

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown): string => typeof value === "string" ? value : "";
const count = (value: unknown): number => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;

function readUsage(body: Record<string, unknown>, anthropic: boolean): TokenUsage | undefined {
  if (!body.usage || typeof body.usage !== "object") return undefined;
  const usage = object(body.usage);
  const cost = usage.cost;
  return {
    inputTokens: anthropic ? count(usage.input_tokens) + count(usage.cache_read_input_tokens) + count(usage.cache_creation_input_tokens) : count(usage.prompt_tokens),
    cachedInputTokens: anthropic ? count(usage.cache_read_input_tokens) : count(object(usage.prompt_tokens_details).cached_tokens),
    outputTokens: count(anthropic ? usage.output_tokens : usage.completion_tokens),
    reasoningTokens: count(object(usage.completion_tokens_details).reasoning_tokens),
    ...(typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? { costUsd: cost } : {}),
  };
}

export async function runDirectApi(options: RunOptions): Promise<RunResult> {
  const { invocation, limits } = options;
  const api = invocation.directApi!;
  const { provider } = api;
  const startedAt = Date.now();
  const secret = invocation.env[provider.envKey]?.trim() ?? "";
  const sanitize = (text: string): string => {
    const safe = redact(text, invocation.env);
    return secret ? safe.split(secret).join(`[REDACTED:${provider.envKey}]`) : safe;
  };
  const controller = new AbortController();
  let timedOut: RunResult["timedOut"] = null;
  let truncated = false;
  let firstOutputMilliseconds: number | null = null;
  let usage: TokenUsage | undefined;
  let partialOutput: string | undefined;
  const finish = (text: string, error = false): RunResult => {
    const safe = sanitize(text);
    try { options.onOutput?.(safe, error ? "err" : "out"); } catch { /* observador não derruba a chamada */ }
    return {
      exitCode: timedOut ? 124 : error ? 1 : 0,
      stdout: error ? "" : safe,
      stderr: error ? safe : "",
      timedOut, truncated, firstOutputMilliseconds,
      durationMilliseconds: Date.now() - startedAt,
      resultRead: !error,
      ...(error ? { engineError: true } : {}),
      ...(usage ? { usage } : {}),
      ...(partialOutput ? { partialOutput } : {}),
    };
  };
  if (!secret) return finish(`${provider.id}: nenhuma chave de API configurada. Use capivara login ${provider.id}.`, true);
  const configuredTokens = invocation.env.CAPIVARA_API_MAX_OUTPUT_TOKENS?.trim() ?? "";
  const maxOutputTokens = configuredTokens ? Number(configuredTokens) : 32768;
  if ((configuredTokens && !/^\d+$/.test(configuredTokens)) || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0) {
    return finish("CAPIVARA_API_MAX_OUTPUT_TOKENS deve ser um inteiro positivo seguro; nenhuma requisição foi enviada.", true);
  }
  /*
   * O que a documentação do modelo diz (§131). Modelo que não desliga: pedir
   * `disabled` é HTTP 400, ou raciocínio cobrado sem ninguém ter pedido. Modelo
   * com níveis: outro valor é 400, e `thinking` (sem nível) cairia no padrão da
   * API — o `max` do M3.1-Flash — sem ninguém ter escolhido.
   */
  const documentado = raciocinioDoModelo(provider, api.model);
  if (documentado && !documentado.desligavel && !api.reasoning.enabled) {
    return finish(`${provider.id}: ${api.model} não permite desligar o raciocínio. Informe --effort explicitamente (${effortsDoModelo(documentado).join(", ")}); nenhuma requisição foi enviada.`, true);
  }
  if (documentado && documentado.niveis.length > 0 && api.reasoning.enabled && !documentado.niveis.includes(api.reasoning.effort ?? "")) {
    return finish(`${provider.id}: ${api.model} não aceita o effort "${api.reasoning.effort ?? ""}". Informe --effort com um destes: ${documentado.niveis.join(", ")}; nenhuma requisição foi enviada.`, true);
  }
  const abort = (): void => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = limits.wallSeconds > 0 ? setTimeout(() => { timedOut = "wall"; controller.abort(); }, limits.wallSeconds * 1000) : null;
  try {
    const anthropic = provider.dialect === "anthropic-messages";
    const response = await fetch(provider.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(anthropic ? { "x-api-key": secret, "anthropic-version": "2023-06-01" } : { Authorization: `Bearer ${secret}` }),
      },
      body: JSON.stringify(requestBody(api, options.prompt, maxOutputTokens)),
      redirect: "error",
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    let raw = "";
    let bytes = 0;
    const decoder = new TextDecoder();
    if (reader) {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        firstOutputMilliseconds ??= Date.now() - startedAt;
        bytes += chunk.value.byteLength;
        if (bytes > limits.maxOutputBytes) {
          truncated = true;
          controller.abort();
          await reader.cancel().catch(() => undefined);
          return finish(`${provider.id}: a resposta da API excedeu o limite de bytes; nenhum texto parcial foi aprovado.`, true);
        }
        raw += decoder.decode(chunk.value, { stream: true });
      }
      raw += decoder.decode();
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { return finish(`${provider.id}: ${response.ok ? "a API respondeu JSON inválido" : `HTTP ${response.status} — ${response.statusText}`}.`, true); }
    const body = object(parsed);
    const failure = string(object(body.error).message) || string(body.error);
    const base = object(body.base_resp);
    const baseFailed = typeof base.status_code === "number" && base.status_code !== 0;
    if (!response.ok || body.error || baseFailed) {
      return finish(`${provider.id}: HTTP ${response.status}${baseFailed ? ` (código ${base.status_code})` : ""} — ${(failure || string(base.status_msg) || response.statusText).slice(0, 2000)}`, true);
    }
    usage = readUsage(body, anthropic);
    const choice = object(array(body.choices)[0]);
    const message = object(choice.message);
    const stop = anthropic ? body.stop_reason : choice.finish_reason;
    const content = anthropic ? body.content : message.content;
    const text = typeof content === "string" ? content : array(content).filter((part) => object(part).type === "text").map((part) => string(object(part).text)).join("");
    if (stop === "length" || stop === "max_tokens") {
      partialOutput = sanitize(text);
      const rawUsage = object(body.usage);
      const metric = (value: unknown): string => typeof value === "number" && Number.isFinite(value) && value >= 0 ? String(value) : "não informado";
      return finish([
        `${provider.id}: a geração atingiu o limite de tokens; o documento ficou incompleto e não foi aprovado.`,
        `modelo: ${api.model}; effort: ${api.reasoning.enabled ? api.reasoning.effort ?? "padrão" : "none"}; teto solicitado: ${maxOutputTokens}; término: ${stop}.`,
        `Tokens — entrada: ${metric(anthropic ? rawUsage.input_tokens : rawUsage.prompt_tokens)}; saída: ${metric(anthropic ? rawUsage.output_tokens : rawUsage.completion_tokens)}; raciocínio: ${metric(object(rawUsage.completion_tokens_details).reasoning_tokens)}.`,
        `Texto visível parcial: ${text.length} caractere(s); não será publicado ou usado como documento.`,
        "O teto de saída pode incluir raciocínio e texto final. Ajuste CAPIVARA_API_MAX_OUTPUT_TOKENS ou o effort explicitamente conforme o modelo aceitar; nenhuma repetição automática foi feita.",
      ].join("\n"), true);
    }
    if (stop === "tool_calls" || stop === "tool_use") return finish(`${provider.id}: a API pediu ferramentas em vez de concluir o texto; este papel de API não executa ferramentas.`, true);
    if (!text.trim()) return finish(`${provider.id}: a API terminou sem texto final${string(message.refusal) ? ` — ${string(message.refusal).slice(0, 1000)}` : ""}; reasoning, thinking e tool calls não são documentos.`, true);
    return finish(text);
  } catch (error) {
    return finish(timedOut ? `${provider.id}: a chamada à API excedeu o limite de tempo (wall).`
      : options.signal?.aborted ? `${provider.id}: chamada à API cancelada.`
      : `${provider.id}: falhou antes de o modelo responder — ${error instanceof Error ? error.message : "erro de conexão"}.`, true);
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
