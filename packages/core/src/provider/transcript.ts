/**
 * Leitura do transcrito de uma CLI que fala JSONL.
 *
 * Duas coisas se ganham ao pedir eventos em vez de texto solto.
 *
 * A primeira é a resposta exata. Raspar o stdout de uma sessão inteira obriga a
 * adivinhar onde termina o relatório de progresso e começa a resposta; o evento
 * diz qual item é a mensagem do agente, e não sobra dúvida.
 *
 * A segunda é o custo. Sem eventos, a telemetria só sabe contar chamadas e
 * segundos — foi o que o painel mostrou nos três primeiros pilotos. O evento de
 * fim de turno traz os tokens, inclusive os que vieram de cache.
 *
 * E há um efeito colateral que vale tanto quanto: um fluxo contínuo de eventos
 * mantém o relógio de ocioso rearmado. Uma CLI que fica muda enquanto pensa é
 * indistinguível de uma travada, e foi assim que o piloto 3 perdeu uma chamada
 * viva aos 600 segundos.
 */

export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** Só quando a CLI informa; nem todas informam. */
  costUsd?: number;
}

/** Como cada CLI fala. Ausente significa texto puro, sem envelope. */
export type TranscriptKind = "codex-jsonl" | "claude-json" | "opencode-jsonl" | "agy-json" | "cursor-json";

export interface Transcript {
  /** A resposta final do agente. */
  text: string;
  usage: TokenUsage | null;
  /** Verdadeiro quando nenhum evento de mensagem apareceu: o texto é o stdout cru. */
  raw: boolean;
  /**
   * A própria CLI declarou a volta como erro.
   *
   * Distinto de `raw`: uma volta pode vir crua porque o envelope não chegou —
   * processo morto, saída truncada — e isso não é a CLI dizendo que falhou. Quem
   * decide se a chamada valeu precisa das duas coisas separadas.
   */
  error?: true;
}

interface CodexEvent {
  type?: string;
  item?: { type?: string; text?: string };
  usage?: Record<string, unknown>;
}

function inteiro(source: Record<string, unknown> | undefined, key: string): number {
  const value = source?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Extrai a última mensagem do agente e o uso de tokens.
 *
 * Linha que não é JSON é ignorada em silêncio: a CLI pode escrever aviso ou
 * banner fora do fluxo, e isso não é motivo para perder a resposta.
 *
 * Sem nenhuma mensagem de agente, devolve o stdout inteiro marcado como cru —
 * engolir a saída de um erro seria trocar um diagnóstico por um vazio.
 */
export function parseCodexJsonl(stdout: string): Transcript {
  let text: string | null = null;
  let usage: TokenUsage | null = null;

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || !trimmed.startsWith("{")) continue;

    let event: CodexEvent;
    try {
      event = JSON.parse(trimmed) as CodexEvent;
    } catch {
      continue;
    }

    if (event.item?.type === "agent_message" && typeof event.item.text === "string") {
      text = event.item.text;
    }
    if (event.usage) {
      usage = {
        inputTokens: inteiro(event.usage, "input_tokens"),
        cachedInputTokens: inteiro(event.usage, "cached_input_tokens"),
        outputTokens: inteiro(event.usage, "output_tokens"),
        reasoningTokens: inteiro(event.usage, "reasoning_output_tokens"),
      };
    }
  }

  return text === null ? { text: stdout, usage, raw: true } : { text, usage, raw: false };
}

/**
 * `claude -p --output-format json` devolve UM objeto por chamada.
 *
 * A resposta fica em `result`; o resto do objeto é contabilidade da sessão. Sem
 * esta leitura, o documento publicado seria o objeto inteiro — envelope, custo,
 * estatística de subagentes e tudo.
 */
export function parseClaudeJson(stdout: string): Transcript {
  const objeto = ultimoObjeto(stdout);
  if (!objeto) return { text: stdout, usage: null, raw: true };

  const uso = objeto.usage as Record<string, unknown> | undefined;
  const detalhes = uso?.["output_tokens_details"] as Record<string, unknown> | undefined;
  const custo = objeto["total_cost_usd"];

  /*
   * Os dois providers chamam de `input_tokens` coisas diferentes.
   *
   * No codex o campo já é o total, e `cached_input_tokens` é um subconjunto
   * informativo dele. No Claude é o contrário: `input_tokens` conta só o que NÃO
   * veio de cache, e a criação e a leitura de cache são parcelas à parte. Lido
   * ao pé da letra, um prompt de 23 mil tokens era relatado como 9 — uma
   * subestimação de 2500 vezes, que faria qualquer comparação de custo entre
   * providers dizer o contrário da verdade.
   *
   * Aqui `inputTokens` significa a mesma coisa para todo provider: tudo o que
   * entrou. `cachedInputTokens` continua sendo a parcela que veio de cache, para
   * quem quiser saber quanto foi barato.
   */
  const usage: TokenUsage | null = uso
    ? {
        inputTokens:
          inteiro(uso, "input_tokens") + inteiro(uso, "cache_creation_input_tokens") + inteiro(uso, "cache_read_input_tokens"),
        cachedInputTokens: inteiro(uso, "cache_read_input_tokens"),
        outputTokens: inteiro(uso, "output_tokens"),
        reasoningTokens: inteiro(detalhes, "thinking_tokens"),
        ...(typeof custo === "number" ? { costUsd: custo } : {}),
      }
    : null;

  // Erro reportado pela própria CLI: devolve tudo, porque o diagnóstico pode
  // estar em qualquer campo do envelope e engoli-lo é trocar causa por vazio.
  if (objeto["is_error"] === true) return { text: stdout, usage, raw: true, error: true };

  const resultado = objeto["result"];
  if (typeof resultado !== "string") return { text: stdout, usage, raw: true };
  return { text: resultado, usage, raw: false };
}

/**
 * `opencode run --format json` transmite partes.
 *
 * O texto do agente chega em pedaços `type: "text"`, que são concatenados na
 * ordem; `step_finish` fecha cada passo com tokens e custo, e uma resposta com
 * várias etapas traz vários — somados, porque a chamada é uma só.
 */
export function parseOpencodeJsonl(stdout: string): Transcript {
  const pedacos: string[] = [];
  let usage: TokenUsage | null = null;

  for (const evento of objetos(stdout)) {
    const parte = evento["part"] as Record<string, unknown> | undefined;
    if (parte?.["type"] === "text" && typeof parte["text"] === "string") {
      pedacos.push(parte["text"]);
      continue;
    }

    const tokens = parte?.["tokens"] as Record<string, unknown> | undefined;
    if (!tokens) continue;
    const cache = tokens["cache"] as Record<string, unknown> | undefined;
    const custo = parte?.["cost"];
    const somado: TokenUsage = {
      inputTokens: (usage?.inputTokens ?? 0) + inteiro(tokens, "input"),
      cachedInputTokens: (usage?.cachedInputTokens ?? 0) + inteiro(cache, "read"),
      outputTokens: (usage?.outputTokens ?? 0) + inteiro(tokens, "output"),
      reasoningTokens: (usage?.reasoningTokens ?? 0) + inteiro(tokens, "reasoning"),
    };
    const acumulado: number = (usage?.costUsd ?? 0) + (typeof custo === "number" ? custo : 0);
    usage = acumulado > 0 ? { ...somado, costUsd: acumulado } : somado;
  }

  return pedacos.length === 0 ? { text: stdout, usage, raw: true } : { text: pedacos.join(""), usage, raw: false };
}

/** Objetos JSON, um por linha, ignorando o que não for JSON. */
function* objetos(stdout: string): Generator<Record<string, unknown>> {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || !trimmed.startsWith("{")) continue;
    try {
      yield JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      /* linha que não é JSON não derruba a leitura */
    }
  }
}

/**
 * O último objeto completo da saída.
 *
 * Tenta o stdout inteiro primeiro — é o caso normal, um objeto só — e cai para a
 * última linha que for JSON quando a CLI escreveu algo em volta.
 */
function ultimoObjeto(stdout: string): Record<string, unknown> | null {
  try {
    const inteiro = JSON.parse(stdout.trim()) as Record<string, unknown>;
    if (inteiro && typeof inteiro === "object") return inteiro;
  } catch {
    /* segue para a leitura linha a linha */
  }
  let ultimo: Record<string, unknown> | null = null;
  for (const objeto of objetos(stdout)) ultimo = objeto;
  return ultimo;
}

/**
 * O envelope do Antigravity: um objeto só, com o texto em `response`.
 *
 * `status` é a própria CLI dizendo se a volta deu certo. Qualquer coisa diferente
 * de SUCCESS devolve tudo como veio: o diagnóstico está nesse envelope, e
 * entregar `response` sozinho trocaria a causa por uma resposta truncada.
 *
 * Os tokens vêm somados em `input_tokens`, com o cache reportado à parte — a
 * mesma convenção do codex, e o oposto da do Claude. Confundir as duas foi um
 * defeito real: um prompt de 23 mil tokens relatado como 9.
 */
export function parseAgyJson(stdout: string): Transcript {
  const objeto = ultimoObjeto(stdout);
  if (!objeto) return { text: stdout, usage: null, raw: true };

  const uso = objeto["usage"] as Record<string, unknown> | undefined;
  const usage: TokenUsage | null = uso
    ? {
        inputTokens: inteiro(uso, "input_tokens"),
        cachedInputTokens: inteiro(uso, "cache_read_tokens"),
        outputTokens: inteiro(uso, "output_tokens"),
        reasoningTokens: inteiro(uso, "thinking_tokens"),
      }
    : null;

  if (objeto["status"] !== "SUCCESS") return { text: stdout, usage, raw: true, error: true };

  const resposta = objeto["response"];
  if (typeof resposta !== "string") return { text: stdout, usage, raw: true };

  /*
   * SUCCESS com resposta vazia não é sucesso.
   *
   * Quando uma ferramenta é negada — e em modo headless não há a quem perguntar,
   * então ela é negada — esta CLI encerra a volta com `status: SUCCESS`,
   * `response: ""` e a lista em `denied_actions`. Lido ao pé da letra, o vazio
   * vira a resposta do papel: no piloto 7, duas das três fases do plano foram
   * publicadas sem uma única task, e o log anunciou "fase 1 pronta".
   *
   * Devolver tudo aqui faz o diagnóstico chegar a quem chamou, com o nome da
   * ferramenta negada dentro dele.
   */
  if (resposta.trim() === "") return { text: stdout, usage, raw: true };
  return { text: resposta, usage, raw: false };
}

/**
 * O envelope do Cursor Agent: um objeto de resultado, com o texto em `result`.
 *
 * `is_error` é a própria CLI dizendo se a volta deu certo; qualquer coisa fora do
 * caminho feliz devolve tudo, porque o diagnóstico está no envelope.
 *
 * Os campos de uso vêm em camelCase — `inputTokens`, não `input_tokens` — e o
 * total já inclui o que veio de cache, como no codex e ao contrário do Claude.
 * Verificado chamando a CLI duas vezes: `cacheReadTokens` fica estável enquanto
 * `inputTokens` acompanha o tamanho do prompt.
 */
export function parseCursorJson(stdout: string): Transcript {
  const objeto = ultimoObjeto(stdout);
  if (!objeto) return { text: stdout, usage: null, raw: true };

  const uso = objeto["usage"] as Record<string, unknown> | undefined;
  const usage: TokenUsage | null = uso
    ? {
        inputTokens: inteiro(uso, "inputTokens"),
        cachedInputTokens: inteiro(uso, "cacheReadTokens"),
        outputTokens: inteiro(uso, "outputTokens"),
        reasoningTokens: 0,
      }
    : null;

  if (objeto["is_error"] === true) return { text: stdout, usage, raw: true, error: true };

  const resultado = objeto["result"];
  if (typeof resultado !== "string" || resultado.trim() === "") return { text: stdout, usage, raw: true };
  return { text: resultado, usage, raw: false };
}

/** Lê o transcrito conforme a CLI que o produziu. */
export function readTranscript(kind: TranscriptKind, stdout: string): Transcript {
  if (kind === "claude-json") return parseClaudeJson(stdout);
  if (kind === "opencode-jsonl") return parseOpencodeJsonl(stdout);
  if (kind === "agy-json") return parseAgyJson(stdout);
  if (kind === "cursor-json") return parseCursorJson(stdout);
  return parseCodexJsonl(stdout);
}

/**
 * Uma linha de evento vira uma linha de log legível.
 *
 * O que interessa a quem olha a tela é saber que ALGO está acontecendo e o quê,
 * não reconstituir a sessão. Evento que não se reconhece devolve `null` e
 * simplesmente não aparece — poluir a janela com JSON cru seria pior que o
 * silêncio que isto veio resolver.
 */
export function summarizeCodexEvent(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed === "" || !trimmed.startsWith("{")) return null;

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }

  const tipo = typeof event["type"] === "string" ? (event["type"] as string) : "";
  const item = event["item"] as Record<string, unknown> | undefined;
  const itemType = typeof item?.["type"] === "string" ? (item["type"] as string) : "";

  if (tipo === "thread.started") return "sessão aberta";
  if (tipo === "turn.started") return "pensando";

  if (itemType === "reasoning") return "raciocinando";
  if (itemType === "command_execution" || itemType === "local_shell_call") {
    const comando = primeiraLinha(item?.["command"]);
    return comando ? `$ ${comando}` : "rodando um comando";
  }
  if (itemType === "file_change" || itemType === "patch_apply") return "alterando arquivo";
  if (itemType === "web_search") return "buscando na web";
  if (itemType === "agent_message") {
    /*
     * "resposta" é o que o DESENVOLVEDOR dá a uma pergunta. Usar a mesma palavra
     * para a saída do modelo fez alguém ler o painel e perguntar que respostas
     * eram aquelas que ele não tinha dado — na tela que existe justamente para
     * dizer o que está acontecendo.
     */
    const texto = typeof item?.["text"] === "string" ? (item["text"] as string) : "";
    return `devolveu ${texto.length} caracteres`;
  }

  if (tipo === "turn.completed") {
    const usage = event["usage"] as Record<string, unknown> | undefined;
    const saida = inteiro(usage, "output_tokens");
    return saida > 0 ? `turno concluído · ${saida} tokens de saída` : "turno concluído";
  }
  if (tipo === "turn.failed" || tipo === "error") return "o provider reportou erro";

  return null;
}

function primeiraLinha(valor: unknown): string {
  const texto = typeof valor === "string" ? valor : Array.isArray(valor) ? valor.join(" ") : "";
  const linha = texto.split("\n")[0] ?? "";
  return linha.length > 70 ? `${linha.slice(0, 69)}…` : linha;
}

/**
 * Acumula pedaços e entrega linhas inteiras.
 *
 * Um chunk de stdout corta no meio de uma linha com frequência; entregar o
 * pedaço partido ao parser produziria lixo ou silêncio.
 */
export function createLineSplitter(onLine: (line: string) => void): (chunk: string) => void {
  let resto = "";
  return (chunk) => {
    const partes = `${resto}${chunk}`.split("\n");
    resto = partes.pop() ?? "";
    for (const parte of partes) onLine(parte);
  };
}
