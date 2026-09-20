import { describe, expect, it } from "vitest";
import { parseAgyJson,
  buildInvocation,
  createLineSplitter,
  parseClaudeJson,
  parseCodexJsonl,
  parseOpencodeJsonl,
  readTranscript,
  summarizeCodexEvent,
} from "../../src/provider/index.js";

const transcrito = [
  '{"type":"thread.started","thread_id":"01a0"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"reasoning","text":"pensando"}}',
  '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"# Documento\\n\\ncorpo"}}',
  '{"type":"turn.completed","usage":{"input_tokens":14446,"cached_input_tokens":9984,"output_tokens":612,"reasoning_output_tokens":128}}',
].join("\n");

describe("transcrito do codex", () => {
  it("entrega a mensagem do agente, não o relatório de progresso", () => {
    const lido = parseCodexJsonl(transcrito);
    expect(lido.text).toBe("# Documento\n\ncorpo");
    expect(lido.raw).toBe(false);
  });

  it("conta os tokens, inclusive os que vieram de cache", () => {
    const lido = parseCodexJsonl(transcrito);
    expect(lido.usage).toEqual({ inputTokens: 14446, cachedInputTokens: 9984, outputTokens: 612, reasoningTokens: 128 });
  });

  it("a última mensagem vence, não a primeira", () => {
    const duas = [
      '{"type":"item.completed","item":{"type":"agent_message","text":"rascunho"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"final"}}',
    ].join("\n");
    expect(parseCodexJsonl(duas).text).toBe("final");
  });

  it("linha que não é JSON não derruba a leitura", () => {
    const sujo = ["aviso: algo", transcrito, "banner final"].join("\n");
    expect(parseCodexJsonl(sujo).text).toBe("# Documento\n\ncorpo");
  });

  it("sem mensagem nenhuma, devolve a saída crua em vez de engolir o erro", () => {
    const erro = "codex: authentication failed";
    const lido = parseCodexJsonl(erro);
    expect(lido.raw).toBe(true);
    expect(lido.text).toBe(erro);
  });
});

/*
 * As amostras abaixo foram capturadas das CLIs reais instaladas nesta máquina,
 * com um prompt de uma palavra. Nenhuma foi escrita de memória: o formato que um
 * adaptador supõe é exatamente onde ele quebra em silêncio.
 */

const CLAUDE = JSON.stringify({
  duration_api_ms: 2031,
  stop_reason: "end_turn",
  session_id: "3807fab1",
  total_cost_usd: 0.0963905,
  usage: {
    input_tokens: 2,
    cache_creation_input_tokens: 9023,
    cache_read_input_tokens: 10143,
    output_tokens: 5,
    output_tokens_details: { thinking_tokens: 0 },
  },
  is_error: false,
  num_turns: 1,
  subtype: "success",
  result: "# Documento\n\ncorpo",
  type: "result",
});

const OPENCODE = [
  { type: "step_start", sessionID: "ses_1", part: { type: "step-start" } },
  { type: "text", sessionID: "ses_1", part: { type: "text", text: "# Documento\n\n" } },
  { type: "text", sessionID: "ses_1", part: { type: "text", text: "corpo" } },
  {
    type: "step_finish",
    sessionID: "ses_1",
    part: {
      type: "step-finish",
      reason: "stop",
      tokens: { total: 8439, input: 8373, output: 2, reasoning: 64, cache: { write: 0, read: 12 } },
      cost: 0.00652725,
    },
  },
]
  .map((evento) => JSON.stringify(evento))
  .join("\n");

describe("transcrito do claude", () => {
  it("entrega o campo result, não o envelope da sessão", () => {
    const lido = parseClaudeJson(CLAUDE);
    expect(lido.text).toBe("# Documento\n\ncorpo");
    expect(lido.raw).toBe(false);
    expect(lido.text).not.toContain("session_id");
  });

  it("traz tokens e o custo em dólares que a CLI informa", () => {
    expect(parseClaudeJson(CLAUDE).usage).toEqual({
      // 2 fora do cache + 9023 de escrita + 10143 de leitura: tudo isso entrou.
      inputTokens: 19168,
      cachedInputTokens: 10143,
      outputTokens: 5,
      reasoningTokens: 0,
      costUsd: 0.0963905,
    });
  });

  it("erro declarado pela CLI devolve tudo, em vez de esconder a causa", () => {
    const erro = JSON.stringify({ is_error: true, result: "credenciais inválidas", usage: { input_tokens: 1, output_tokens: 0 } });
    const lido = parseClaudeJson(erro);
    expect(lido.raw).toBe(true);
    expect(lido.text).toContain("credenciais inválidas");
  });

  it("saída que não é JSON não vira documento", () => {
    const lido = parseClaudeJson("command not found: claude");
    expect(lido.raw).toBe(true);
    expect(lido.text).toBe("command not found: claude");
  });
});

describe("transcrito do opencode", () => {
  it("junta as partes de texto na ordem", () => {
    const lido = parseOpencodeJsonl(OPENCODE);
    expect(lido.text).toBe("# Documento\n\ncorpo");
    expect(lido.raw).toBe(false);
  });

  it("soma tokens e custo dos passos", () => {
    expect(parseOpencodeJsonl(OPENCODE).usage).toEqual({
      inputTokens: 8373,
      cachedInputTokens: 12,
      outputTokens: 2,
      reasoningTokens: 64,
      costUsd: 0.00652725,
    });
  });

  it("dois passos somam, porque a chamada é uma só", () => {
    const dois = [OPENCODE, OPENCODE].join("\n");
    expect(parseOpencodeJsonl(dois).usage?.inputTokens).toBe(16746);
  });
});

describe("cada provider lê o seu próprio formato", () => {
  it("o adaptador declara como a CLI fala", () => {
    const contexto = { projectRoot: "/projeto", runId: "init-1", stage: "authoring", language: "português do Brasil" };
    const config = { provider: "", model: "", effort: "", credential: "", command: "" };
    expect(buildInvocation("writer", { ...config, provider: "codex" }, contexto).transcript).toBe("codex-jsonl");
    expect(buildInvocation("writer", { ...config, provider: "claude" }, contexto).transcript).toBe("claude-json");
    expect(buildInvocation("writer", { ...config, provider: "opencode" }, contexto).transcript).toBe("opencode-jsonl");
  });

  it("o leitor certo é escolhido pelo tipo declarado", () => {
    expect(readTranscript("claude-json", CLAUDE).text).toBe("# Documento\n\ncorpo");
    expect(readTranscript("opencode-jsonl", OPENCODE).text).toBe("# Documento\n\ncorpo");
    expect(readTranscript("codex-jsonl", transcrito).text).toBe("# Documento\n\ncorpo");
  });
});

describe("janela de log ao vivo", () => {
  it("traduz o evento em uma linha legível", () => {
    expect(summarizeCodexEvent('{"type":"thread.started","thread_id":"x"}')).toBe("sessão aberta");
    expect(summarizeCodexEvent('{"type":"turn.started"}')).toBe("pensando");
    expect(summarizeCodexEvent('{"type":"item.completed","item":{"type":"reasoning"}}')).toBe("raciocinando");
  });

  it("comando aparece com o que foi rodado", () => {
    const linha = summarizeCodexEvent('{"type":"item.completed","item":{"type":"command_execution","command":"ls -la src"}}');
    expect(linha).toBe("$ ls -la src");
  });

  it('"resposta" fica reservada ao que o desenvolvedor dá', () => {
    // Na janela de log, "resposta recebida" foi lido como resposta do
    // desenvolvedor a uma pergunta que ele nunca viu.
    const linha = summarizeCodexEvent('{"type":"item.completed","item":{"type":"agent_message","text":"abc"}}');
    expect(linha).toBe("devolveu 3 caracteres");
    expect(linha).not.toContain("resposta");
  });

  it("evento desconhecido não polui a janela com JSON cru", () => {
    expect(summarizeCodexEvent('{"type":"algo.que.nao.conheco","payload":{"a":1}}')).toBeNull();
    expect(summarizeCodexEvent("isto não é json")).toBeNull();
    expect(summarizeCodexEvent("")).toBeNull();
  });

  it("o fim do turno traz os tokens de saída", () => {
    const linha = summarizeCodexEvent('{"type":"turn.completed","usage":{"output_tokens":612}}');
    expect(linha).toContain("612 tokens");
  });

  it("linha partida entre pedaços não vira lixo nem some", () => {
    const recebidas: string[] = [];
    const alimentar = createLineSplitter((line) => void recebidas.push(line));
    alimentar('{"type":"turn.st');
    alimentar('arted"}\n{"type":"thread.started"}\n');
    expect(recebidas).toEqual(['{"type":"turn.started"}', '{"type":"thread.started"}']);
  });
});

describe("entrada significa a mesma coisa em todo provider", () => {
  /** O envelope que a CLI do Claude de fato devolve. */
  const claude = JSON.stringify({
    result: "pronto",
    total_cost_usd: 0.0226,
    usage: {
      input_tokens: 9,
      cache_creation_input_tokens: 9309,
      cache_read_input_tokens: 13607,
      output_tokens: 333,
      output_tokens_details: { thinking_tokens: 326 },
    },
  });

  it("soma o que entrou, inclusive o que criou e leu cache", () => {
    // Ao pé da letra seriam 9 tokens; de fato entraram 22.925.
    expect(parseClaudeJson(claude).usage?.inputTokens).toBe(22925);
  });

  it("a parcela que veio de cache continua visível à parte", () => {
    expect(parseClaudeJson(claude).usage?.cachedInputTokens).toBe(13607);
  });

  it("o codex já reporta o total, e não é somado duas vezes", () => {
    const evento = JSON.stringify({ usage: { input_tokens: 126300, cached_input_tokens: 90000, output_tokens: 68700 } });
    const lido = parseCodexJsonl(`{"item":{"type":"agent_message","text":"ok"}}\n${evento}`);
    expect(lido.usage?.inputTokens).toBe(126300);
    expect(lido.usage?.cachedInputTokens).toBe(90000);
  });

  it("sem campos de cache, o número não muda", () => {
    const simples = JSON.stringify({ result: "ok", usage: { input_tokens: 500, output_tokens: 20 } });
    expect(parseClaudeJson(simples).usage?.inputTokens).toBe(500);
  });
});

describe("transcrito do antigravity", () => {
  /** A saída real de `agy --output-format json`, capturada ao integrar a CLI. */
  const AGY = JSON.stringify({
    conversation_id: "76845d2f-5800-4d8e-ac81-d68d31719000",
    status: "SUCCESS",
    response: "OK\n",
    duration_seconds: 1.98,
    num_turns: 1,
    usage: { input_tokens: 23771, output_tokens: 20, thinking_tokens: 19, cache_read_tokens: 0, total_tokens: 23791 },
  });

  it("entrega o campo response, não o envelope da conversa", () => {
    const lido = parseAgyJson(AGY);
    expect(lido.text).toBe("OK\n");
    expect(lido.raw).toBe(false);
    expect(lido.text).not.toContain("conversation_id");
  });

  it("lê os tokens na convenção desta CLI: entrada já somada, cache à parte", () => {
    expect(parseAgyJson(AGY).usage).toEqual({
      inputTokens: 23771,
      cachedInputTokens: 0,
      outputTokens: 20,
      reasoningTokens: 19,
    });
  });

  it("status diferente de SUCCESS devolve tudo, em vez de esconder a causa", () => {
    const falhou = JSON.stringify({ status: "ERROR", response: "", error: "modelo indisponível" });
    const lido = parseAgyJson(falhou);
    expect(lido.raw).toBe(true);
    expect(lido.text).toContain("modelo indisponível");
  });

  it("saída que não é o envelope volta como veio", () => {
    const lido = parseAgyJson("Error: unexpected argument");
    expect(lido.raw).toBe(true);
    expect(lido.text).toContain("unexpected argument");
  });

  it("o despachante escolhe este leitor pelo tipo do adaptador", () => {
    expect(readTranscript("agy-json", AGY).text).toBe("OK\n");
  });
});

describe("SUCCESS com resposta vazia não é sucesso", () => {
  /*
   * O envelope real do piloto 7: a CLI negou uma ferramenta — headless não tem a
   * quem perguntar — e encerrou a volta com SUCCESS e resposta vazia. Lido ao pé
   * da letra, duas fases do plano foram publicadas sem uma única task.
   */
  const NEGADO = JSON.stringify({
    conversation_id: "3a50d41c",
    status: "SUCCESS",
    response: "",
    usage: { input_tokens: 24569, output_tokens: 410, thinking_tokens: 343, cache_read_tokens: 0 },
    denied_actions: [{ action: "command", display_name: "RunCommand" }],
  });

  it("resposta vazia devolve tudo, para o diagnóstico chegar a quem chamou", () => {
    const lido = parseAgyJson(NEGADO);
    expect(lido.raw).toBe(true);
    expect(lido.text).toContain("denied_actions");
    expect(lido.text).toContain("RunCommand");
  });

  it("só espaços em branco também não é resposta", () => {
    expect(parseAgyJson(JSON.stringify({ status: "SUCCESS", response: "   \n  " })).raw).toBe(true);
  });

  it("os tokens continuam sendo lidos, mesmo na volta que falhou", () => {
    expect(parseAgyJson(NEGADO).usage?.inputTokens).toBe(24569);
  });
});
