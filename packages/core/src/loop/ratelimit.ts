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

/**
 * A credencial que o provider recusou.
 *
 * Não é defeito do produto, e não é limite de uso: é o provider dizendo que não
 * vai trabalhar com esta sessão. Esperar não resolve — o limite volta sozinho, a
 * credencial não —, e repetir só queima a fase. No P02 do `assistencia2` o codex
 * começou a responder `401 Unauthorized: Incorrect API key provided` no meio do
 * build; o verificador do ciclo 2 recebeu isso, não emitiu linha nenhuma, e o
 * gate 3 contou como reprovação. O executor do ciclo 3 recebeu o mesmo em trinta
 * segundos, e o build parou. O produto não reprovou nenhuma das duas vezes.
 *
 * Olha só o FIM do log, pela mesma razão do limite de uso: a saída de teste do
 * projeto pode conter "401 Unauthorized" num asserto de rota protegida, e parar um
 * build porque o produto testou a própria autenticação seria o defeito inverso.
 * Por isso também "401" sozinho NÃO basta — só as frases com que as CLIs falam da
 * credencial DELAS.
 */
const CREDENCIAL_RECUSADA: readonly RegExp[] = [
  /incorrect api key provided/i,
  /invalid[_ -]?api[_ -]?key/i,
  /invalid x-api-key/i,
  /authentication_error/i,
  /oauth token (?:has )?expired/i,
  /not logged in/i,
  /please run `?\/?login`?/i,
  /run `?(?:codex|claude|opencode|cursor-agent|agy) login`?/i,
];

/** A linha em que o provider recusou a credencial, ou `null`. */
export function detectCredentialRejection(log: string): string | null {
  const tail = log.split("\n").slice(-TAIL_LINES);
  for (let indice = tail.length - 1; indice >= 0; indice -= 1) {
    const linha = tail[indice] ?? "";
    if (CREDENCIAL_RECUSADA.some((padrao) => padrao.test(linha))) {
      // A chave mascarada fica mascarada, mas nem o pedaço dela entra no relatório.
      return linha.replace(/sk-[A-Za-z0-9_*-]+/g, "sk-…").trim().slice(0, 240);
    }
  }
  return null;
}
