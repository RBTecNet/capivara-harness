/**
 * Detecção de limite de uso.
 *
 * Olha somente o FIM do log. Varrer o log inteiro faz a saída de teste do
 * projeto — um "429" num asserto de HTTP, um "Too Many Requests" num fixture —
 * disparar uma espera de meia hora que ninguém pediu.
 *
 * A espera não consome ciclo de correção: o provider indisponível não é um
 * defeito da implementação.
 */

export interface RateLimit {
  /** Epoch em segundos quando o log informa o horário do reset. */
  resetAt: number | null;
  matched: string;
}

const TAIL_LINES = 20;

const PATTERNS: Record<string, RegExp> = {
  claude: /usage limit reached/i,
  codex: /rate limit reached|quota exceeded|usage limit reached/i,
  opencode: /rate limit|quota exceeded/i,
  default: /rate limit reached|quota exceeded|usage limit reached/i,
};

export function detectRateLimit(log: string, engine = "default"): RateLimit | null {
  const tail = log.split("\n").slice(-TAIL_LINES).join("\n");
  const pattern = PATTERNS[engine] ?? PATTERNS.default!;
  const matched = pattern.exec(tail);
  if (!matched) return null;

  const epoch = /(?:usage limit reached|reset[a-z ]*)[^0-9]*([0-9]{10,13})/i.exec(tail)?.[1];
  const resetAt = epoch ? Number(epoch.length > 10 ? epoch.slice(0, 10) : epoch) : null;
  return { resetAt, matched: matched[0] };
}

export interface WaitPlan {
  seconds: number;
  reason: string;
}

export const DEFAULT_WAIT_SECONDS = 1800;
export const RESET_BUFFER_SECONDS = 60;

export function planWait(limit: RateLimit, now = Date.now()): WaitPlan {
  if (limit.resetAt === null) {
    return { seconds: DEFAULT_WAIT_SECONDS, reason: "limite de uso sem horário de reset informado" };
  }
  const seconds = Math.max(0, Math.ceil((limit.resetAt * 1000 - now) / 1000)) + RESET_BUFFER_SECONDS;
  return { seconds, reason: `limite de uso até ${new Date(limit.resetAt * 1000).toISOString()}` };
}
