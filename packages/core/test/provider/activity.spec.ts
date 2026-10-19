import { describe, expect, it } from "vitest";
import { createLineSplitter, summarizeOpencodeEvent } from "../../src/provider/index.js";

const tool = (name: string, state: Record<string, unknown>): string => JSON.stringify({ type: "tool_use", part: { type: "tool", tool: name, state } });

describe("atividade do OpenCode", () => {
  it.each(["pending", "running", "completed", "error"])("resume arquivo em %s sem expor conteúdo", status => {
    const summary = summarizeOpencodeEvent(tool("write", { status, input: { path: "backend/src/server.ts", content: "conteúdo privado" } }));
    expect(summary).toContain("backend/src/server.ts");
    expect(summary).not.toContain("conteúdo privado");
  });

  it("não mostra argumentos, valores de ambiente ou raciocínio", () => {
    const summary = summarizeOpencodeEvent(tool("shell", { status: "completed", input: { command: "cd backend && TOKEN=segredo npm test --password outra-senha" }, output: "dados privados e segredos" }));
    expect(summary).toBe("comando concluído · npm");
    expect(summarizeOpencodeEvent(JSON.stringify({ type: "reasoning", part: { text: "pensamento privado" } }))).toBeNull();
    expect(summarizeOpencodeEvent(JSON.stringify({ type: "text", part: { text: "mensagem privada" } }))).toBe("modelo devolveu 16 caracteres");
  });

  it("mostra o último resultado de testes sem tratá-lo como gate aprovado", () => {
    const summary = summarizeOpencodeEvent(tool("shell", { status: "completed", input: { command: "npm test" }, output: "Tests 4 failed | 59 passed (63)\nTests 2 failed | 62 passed (64)\nEADDRINUSE" }));
    expect(summary).toContain("testes do executor: 62 passaram, 2 falharam");
    expect(summary).toContain("porta ocupada (EADDRINUSE)");
    expect(summary).not.toContain("59");
    expect(summary).not.toContain("G2");
  });

  it.each(["null", "[]", "{", "aviso", '{"type":"tool_use","part":null}'])("entrada desconhecida não derruba a observação: %s", value => {
    expect(summarizeOpencodeEvent(value)).toBeNull();
  });

  it("limita o buffer de linha e recupera o próximo evento completo", () => {
    const lines: string[] = [];
    const feed = createLineSplitter(line => lines.push(line), 12);
    feed("x".repeat(20));
    feed("resto\nok\npart");
    feed("ida\n");
    expect(lines).toEqual(["ok", "partida"]);
  });
});
