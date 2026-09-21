/**
 * O cliente MCP, contra um servidor HTTP de verdade.
 *
 * Um duplo de `fetch` provaria que sabemos montar o objeto que nós mesmos
 * esperamos. O que precisa ser provado é outra coisa: que a conversa acontece
 * sobre HTTP como o protocolo manda — cabeçalhos, sessão, e as DUAS formas de
 * resposta que um servidor pode escolher.
 */

import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { McpError, createMcpClient, fetchProjectMaterial } from "../../src/mcp/index.js";

interface Recebido {
  method: string;
  params: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
}

let server: Server;
let url = "";
let recebidos: Recebido[] = [];
/** O que o servidor responde a cada método, por nome. */
let respostas: Record<string, unknown> = {};
/** O texto de cada recurso, para o servidor responder por URI como um de verdade. */
let textosPorUri: Record<string, string> = {};
let modo: "json" | "sse" = "json";
let erroJsonRpc: { code: number; message: string } | null = null;

beforeEach(async () => {
  recebidos = [];
  respostas = {};
  textosPorUri = {};
  erroJsonRpc = null;
  modo = "json";

  server = createServer((req, res) => {
    let corpo = "";
    req.on("data", (pedaco) => (corpo += pedaco));
    req.on("end", () => {
      const pedido = JSON.parse(corpo) as { id?: number; method: string; params?: Record<string, unknown> };
      recebidos.push({ method: pedido.method, params: pedido.params ?? {}, headers: req.headers });

      // Notificação não tem id nem resposta.
      if (pedido.id === undefined) {
        res.writeHead(202).end();
        return;
      }

      const uri = typeof pedido.params?.uri === "string" ? pedido.params.uri : "";
      const porUri =
        pedido.method === "resources/read" && uri in textosPorUri
          ? { contents: [{ uri, type: "text", text: textosPorUri[uri] }] }
          : null;

      const envelope = erroJsonRpc
        ? { jsonrpc: "2.0", id: pedido.id, error: erroJsonRpc }
        : { jsonrpc: "2.0", id: pedido.id, result: porUri ?? respostas[pedido.method] ?? {} };

      if (modo === "sse") {
        res.writeHead(200, { "content-type": "text/event-stream", "mcp-session-id": "sessao-1" });
        res.end(`event: message\ndata: ${JSON.stringify(envelope)}\n\n`);
        return;
      }
      res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "sessao-1" });
      res.end(JSON.stringify(envelope));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endereco = server.address();
  url = typeof endereco === "object" && endereco ? `http://127.0.0.1:${endereco.port}/mcp` : "";
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function cliente() {
  return createMcpClient({ url }, { timeoutSeconds: 5 });
}

describe("o aperto de mão", () => {
  it("apresenta-se, guarda quem respondeu e avisa que está pronto", async () => {
    respostas["initialize"] = { protocolVersion: "2025-06-18", serverInfo: { name: "biblioteca", version: "1.0.0" } };
    const mcp = cliente();
    await mcp.initialize();

    expect(mcp.server?.name).toBe("biblioteca");
    expect(recebidos[0]?.method).toBe("initialize");
    expect((recebidos[0]?.params.clientInfo as { name: string }).name).toBe("capivara");
    // A notificação de pronto é parte do protocolo, não um detalhe opcional.
    expect(recebidos[1]?.method).toBe("notifications/initialized");
  });

  it("devolve a sessão e a versão em toda chamada seguinte", async () => {
    respostas["initialize"] = { protocolVersion: "2025-03-26", serverInfo: { name: "x", version: "1" } };
    respostas["resources/list"] = { resources: [] };
    const mcp = cliente();
    await mcp.initialize();
    await mcp.listResources();

    const ultima = recebidos[recebidos.length - 1]!;
    expect(ultima.headers["mcp-session-id"]).toBe("sessao-1");
    // A versão devolvida pelo servidor, não a nossa: é ele quem manda no acordo.
    expect(ultima.headers["mcp-protocol-version"]).toBe("2025-03-26");
  });
});

describe("as duas formas de o servidor responder", () => {
  it("lê o objeto JSON direto", async () => {
    respostas["initialize"] = { serverInfo: { name: "a", version: "1" } };
    respostas["resources/read"] = { contents: [{ uri: "capivara://p/pedido", text: "um sistema de reservas" }] };
    const mcp = cliente();
    await mcp.initialize();
    expect(await mcp.readResource("capivara://p/pedido")).toBe("um sistema de reservas");
  });

  it("lê a mesma resposta dentro de um fluxo de eventos", async () => {
    modo = "sse";
    respostas["initialize"] = { serverInfo: { name: "a", version: "1" } };
    respostas["resources/read"] = { contents: [{ uri: "capivara://p/pedido", text: "um sistema de reservas" }] };
    const mcp = cliente();
    await mcp.initialize();
    expect(await mcp.readResource("capivara://p/pedido")).toBe("um sistema de reservas");
  });
});

describe("quando dá errado", () => {
  it("o erro do protocolo vira mensagem com o método que falhou", async () => {
    respostas["initialize"] = { serverInfo: { name: "a", version: "1" } };
    const mcp = cliente();
    await mcp.initialize();

    erroJsonRpc = { code: -32602, message: "prompt desconhecido: biblioteca" };
    await expect(mcp.prompt("biblioteca")).rejects.toThrow(/prompts\/get.*prompt desconhecido/);
  });

  /*
   * Uma ferramenta que falha responde 200 com `isError`. Sem esta leitura, o
   * texto do erro viraria conteúdo e seguiria run adentro como se fosse dado.
   */
  it("ferramenta que falha não vira conteúdo", async () => {
    respostas["initialize"] = { serverInfo: { name: "a", version: "1" } };
    respostas["tools/call"] = { isError: true, content: [{ type: "text", text: "projeto não encontrado" }] };
    const mcp = cliente();
    await mcp.initialize();
    await expect(mcp.callTool("buscar", { projeto: "x" })).rejects.toThrow(/projeto não encontrado/);
  });

  it("servidor fora do ar diz onde e por quê, sem stack trace", async () => {
    const mcp = createMcpClient({ url: "http://127.0.0.1:1/mcp" }, { timeoutSeconds: 2 });
    await expect(mcp.initialize()).rejects.toThrow(McpError);
    await expect(mcp.initialize()).rejects.toThrow(/não consegui falar com o servidor MCP em http:\/\/127\.0\.0\.1:1\/mcp/);
  });
});

describe("o material de um projeto", () => {
  beforeEach(() => {
    respostas["initialize"] = { serverInfo: { name: "biblioteca", version: "1" } };
    respostas["resources/list"] = {
      resources: [
        { uri: "capivara://biblioteca/pedido", name: "pedido" },
        { uri: "capivara://biblioteca/docs/memoria/estilo", name: "estilo de código" },
        { uri: "capivara://biblioteca/docs/tecnica/banco", name: "modelo do banco" },
        // De outro projeto e da área geral: não é o que este run pediu.
        { uri: "capivara://outro/docs/memoria/nada", name: "de outro projeto" },
        { uri: "capivara://geral/docs/skill/qualquer", name: "da área geral" },
      ],
    };
  });

  it("traz o pedido e só os documentos daquele projeto", async () => {
    textosPorUri = {
      "capivara://biblioteca/pedido": "uma base documental com abas",
      "capivara://biblioteca/docs/memoria/estilo": "português no código",
      "capivara://biblioteca/docs/tecnica/banco": "SQLite, uma tabela por tipo",
      "capivara://outro/docs/memoria/nada": "não deveria ser lido",
      "capivara://geral/docs/skill/qualquer": "não deveria ser lido",
    };
    const mcp = cliente();
    await mcp.initialize();

    const material = await fetchProjectMaterial(mcp, "biblioteca");
    expect(material.request).toBe("uma base documental com abas");
    expect(material.documents.map((documento) => documento.uri)).toEqual([
      "capivara://biblioteca/docs/memoria/estilo",
      "capivara://biblioteca/docs/tecnica/banco",
    ]);
    expect(material.documents[0]?.text).toBe("português no código");

    // O que não é do projeto não chega nem a ser lido: puxar o acervo inteiro é
    // exatamente o que a seleção por projeto existe para evitar.
    const lidos = recebidos.filter((chamada) => chamada.method === "resources/read").map((chamada) => chamada.params.uri);
    expect(lidos).not.toContain("capivara://outro/docs/memoria/nada");
    expect(lidos).not.toContain("capivara://geral/docs/skill/qualquer");
  });

  it("projeto inexistente diz quais existem, em vez de devolver vazio", async () => {
    const mcp = cliente();
    await mcp.initialize();
    await expect(fetchProjectMaterial(mcp, "inventado")).rejects.toThrow(/não existe na base documental/);
    await expect(fetchProjectMaterial(mcp, "inventado")).rejects.toThrow(/biblioteca/);
  });
});
