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
}

export interface Transcript {
  /** A resposta final do agente. */
  text: string;
  usage: TokenUsage | null;
  /** Verdadeiro quando nenhum evento de mensagem apareceu: o texto é o stdout cru. */
  raw: boolean;
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
