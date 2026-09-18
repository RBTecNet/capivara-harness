import { describe, expect, it } from "vitest";
import { parseCodexJsonl } from "../../src/provider/index.js";

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
