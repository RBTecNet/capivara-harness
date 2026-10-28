import type { DomainAgent, DomainAgentRequest, DomainEvent } from "./types.js";

export const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export const string = (value: unknown, fallback = ""): string => typeof value === "string" ? value.trim() : fallback;
export const strings = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))] : [];
export const records = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter(object) : [];

/** Decode model envelopes without requiring prose, fences or a particular title. */
export function jsonObject(text: string): Record<string, unknown> | null {
  const candidates = [text.trim(), ...[...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((match) => match[1] ?? "")];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) candidates.push(text.slice(start, index + 1));
    }
  }
  for (const candidate of candidates) {
    for (const variant of [candidate, candidate.replace(/,\s*([}\]])/g, "$1")]) {
      try {
        const parsed: unknown = JSON.parse(variant);
        if (object(parsed)) return parsed;
      } catch { /* Try an extracted object rather than discarding a useful response. */ }
    }
  }
  return null;
}

export function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error("Execução cancelada pelo usuário.");
}

export async function pause(ms: number, signal?: AbortSignal): Promise<void> {
  cancelled(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    const abort = (): void => { clearTimeout(timer); reject(signal?.reason ?? new Error("Execução cancelada pelo usuário.")); };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** A malformed answer is repaired in this execution, never promoted to product failure. */
export async function requestObject(options: {
  agent: DomainAgent;
  operation: DomainAgentRequest["operation"];
  prompt: string;
  signal?: AbortSignal;
  onEvent?: (event: DomainEvent) => void;
  contextChars?: number;
}): Promise<Record<string, unknown>> {
  let instruction = options.prompt;
  let previous = "";
  let repeated = 0;
  for (;;) {
    cancelled(options.signal);
    const response = await options.agent({ operation: options.operation, prompt: instruction, readOnly: true });
    const parsed = jsonObject(response);
    if (parsed) return parsed;
    repeated = response === previous ? repeated + 1 : 0;
    previous = response;
    options.onEvent?.({ type: "recovering", message: "A resposta não contém objeto legível; recuperando sua estrutura sem reabrir o produto.", subject: options.operation });
    if (repeated > 0) await pause(Math.min(30_000, repeated * 2_000), options.signal);
    const prefix = "Return one valid JSON object. Repair the preceding undecodable answer without changing the product facts:\n";
    const remaining = (options.contextChars ?? 24_000) - options.prompt.length - prefix.length - 4;
    // A formatting failure must not turn a correctly scoped request into a larger prompt.
    instruction = remaining > 200 ? `${options.prompt}\n\n${prefix}${response.slice(-Math.min(8_000, remaining))}` : options.prompt;
  }
}
