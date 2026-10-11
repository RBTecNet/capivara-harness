import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpError, createMcpClient } from "../../src/mcp/client.js";

interface Pedido {
  id?: number;
  method: string;
  params?: Record<string, unknown>;
  path: string;
  httpMethod: string;
  headers: IncomingHttpHeaders;
}

interface Resposta {
  status: number;
  body: string;
  headers?: Record<string, string>;
}

const servidores: Server[] = [];
const token = "dc_transport_secret_0123456789";
const apiKey = "api_transport_secret_9876543210";
const cookieValue = "cookie_transport_secret_456789";
const cookie = `doc_center_session=${cookieValue}`;

function envelope(pedido: Pedido, result: unknown = {}): Resposta {
  return {
    status: 200,
    body: JSON.stringify({ jsonrpc: "2.0", id: pedido.id, result }),
    headers: { "content-type": "application/json" },
  };
}

function respostaNormal(pedido: Pedido): Resposta {
  if (pedido.method === "notifications/initialized") return { status: 202, body: "" };
  if (pedido.method === "initialize") {
    const resposta = envelope(pedido, {
      protocolVersion: "2025-03-26",
      serverInfo: { name: "doc-center-autenticado", version: "1.0.0" },
    });
    return { ...resposta, headers: { ...resposta.headers, "mcp-session-id": "sessao-autenticada" } };
  }
  return envelope(pedido, { contents: [{ text: "Conteúdo do projeto." }] });
}

async function servidor(responder: (pedido: Pedido) => Resposta = respostaNormal) {
  const recebidos: Pedido[] = [];
  const http = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (parte: string) => { body += parte; });
    req.on("end", () => {
      try {
        const rpc = JSON.parse(body) as Pick<Pedido, "id" | "method" | "params">;
        const pedido: Pedido = {
          ...rpc,
          path: req.url ?? "",
          httpMethod: req.method ?? "",
          headers: req.headers,
        };
        recebidos.push(pedido);
        const resposta = responder(pedido);
        res.writeHead(resposta.status, resposta.headers).end(resposta.body);
      } catch {
        res.writeHead(500).end("erro na fixture HTTP");
      }
    });
  });
  servidores.push(http);
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(0, "127.0.0.1", resolve);
  });
  const endereco = http.address();
  if (!endereco || typeof endereco === "string") throw new Error("porta HTTP indisponível");
  return { url: `http://127.0.0.1:${endereco.port}/mcp`, recebidos };
}

afterEach(async () => {
  await Promise.all(servidores.splice(0).map((http) => new Promise<void>((resolve, reject) => {
    http.close((erro) => erro ? reject(erro) : resolve());
    http.closeAllConnections();
  })));
  vi.unstubAllEnvs();
});

async function erroDe(chamada: () => Promise<unknown>): Promise<McpError> {
  try {
    await chamada();
  } catch (erro) {
    expect(erro).toBeInstanceOf(McpError);
    return erro as McpError;
  }
  throw new Error("a chamada deveria ter sido recusada");
}

function fetchSemRede() {
  return vi.fn<typeof fetch>(async (_url, options) => {
    const pedido = JSON.parse(String(options?.body)) as Pedido;
    const resposta = respostaNormal(pedido);
    return new Response(resposta.body || null, { status: resposta.status, ...(resposta.headers ? { headers: resposta.headers } : {}) });
  });
}

describe("credenciais no transporte MCP real", () => {
  it("envia os cabeçalhos na inicialização, na notificação e na leitura, preservando sessão e versão", async () => {
    const fixture = await servidor();
    const mcp = createMcpClient({
      url: fixture.url,
      headers: { aUtHoRiZaTiOn: `Bearer ${token}`, Cookie: cookie, "X-Api-Key": apiKey },
    });
    await mcp.initialize();
    expect(await mcp.readResource("capivara://biblioteca/pedido")).toBe("Conteúdo do projeto.");

    expect(fixture.recebidos.map((pedido) => pedido.method)).toEqual([
      "initialize", "notifications/initialized", "resources/read",
    ]);
    for (const pedido of fixture.recebidos) {
      expect(pedido.httpMethod).toBe("POST");
      expect(pedido.path).toBe("/mcp");
      expect(pedido.headers.authorization).toBe(`Bearer ${token}`);
      expect(pedido.headers.cookie).toBe(cookie);
      expect(pedido.headers["x-api-key"]).toBe(apiKey);
    }
    expect(fixture.recebidos[0]?.id).toBeTypeOf("number");
    expect(fixture.recebidos[1]?.id).toBeUndefined();
    for (const pedido of fixture.recebidos.slice(1)) {
      expect(pedido.headers["mcp-session-id"]).toBe("sessao-autenticada");
      expect(pedido.headers["mcp-protocol-version"]).toBe("2025-03-26");
    }
  });

  it.each([
    [401, "initialize"], [403, "initialize"],
    [401, "notifications/initialized"], [403, "notifications/initialized"],
  ] as const)("HTTP %i em %s interrompe o handshake e explica a autenticação sem ecoar o corpo", async (status, method) => {
    const fixture = await servidor((pedido) => pedido.method === method
      ? { status, body: `corpo confidencial: Bearer ${token}; ${apiKey}; ${cookie}` }
      : respostaNormal(pedido));
    const mcp = createMcpClient({ url: fixture.url, headers: { authorization: `Bearer ${token}` } });
    const erro = await erroDe(() => mcp.initialize());

    expect(erro.code).toBe(status);
    expect(erro.message).toContain(String(status));
    expect(erro.message).toMatch(/token/i);
    expect(erro.message).toMatch(status === 401 ? /token|autentica/i : /permiss|escopo/i);
    expect(erro.message).not.toContain("corpo confidencial");
    expect(erro.message).not.toContain(token);
    expect(erro.message).not.toContain(apiKey);
    expect(erro.message).not.toContain(cookie);
    expect(erro.message).not.toContain(fixture.url);
    expect(fixture.recebidos.map((pedido) => pedido.method)).toEqual(
      method === "initialize" ? ["initialize"] : ["initialize", "notifications/initialized"],
    );
  });

  it.each([401, 403])("listPrompts propaga HTTP %i em vez de simular uma lista vazia", async (status) => {
    const fixture = await servidor((pedido) => pedido.method === "prompts/list"
      ? { status, body: `Bearer ${token}` }
      : respostaNormal(pedido));
    const mcp = createMcpClient({ url: fixture.url, headers: { Authorization: `Bearer ${token}` } });
    await mcp.initialize();

    const erro = await erroDe(() => mcp.listPrompts());
    expect(erro.code).toBe(status);
    expect(erro.message).toContain(String(status));
    expect(erro.message).toMatch(/token/i);
    expect(erro.message).not.toContain(token);
  });

  it.each([307, 308])("não segue redirecionamento HTTP %i nem encaminha o token ao destino", async (status) => {
    const fixture = await servidor((pedido) => pedido.path === "/mcp"
      ? { status, body: "", headers: { location: "/capturar-credenciais" } }
      : respostaNormal(pedido));
    const mcp = createMcpClient({ url: fixture.url, headers: { authorization: `Bearer ${token}`, Cookie: cookie } });

    const erro = await erroDe(() => mcp.initialize());
    expect(erro.message).not.toContain(token);
    expect(erro.message).not.toContain(cookie);
    expect(fixture.recebidos).toHaveLength(1);
    expect(fixture.recebidos[0]?.path).toBe("/mcp");
    expect(fixture.recebidos.some((pedido) => pedido.path === "/capturar-credenciais")).toBe(false);
  });
});

describe("erros úteis sem segredos", () => {
  it("redige Bearer e valores de cabeçalhos em erros JSON-RPC mantendo o prompt desconhecido", async () => {
    const fixture = await servidor((pedido) => pedido.method === "prompts/get"
      ? {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: pedido.id, error: {
          code: -32602,
          message: `prompt desconhecido: biblioteca; Bearer ${token}; Bearer outro-token-servidor; ${apiKey}; ${cookie}; sessão=${cookieValue}`,
        } }),
      }
      : respostaNormal(pedido));
    const mcp = createMcpClient({ url: fixture.url, headers: { Authorization: `Bearer ${token}`, "X-Api-Key": apiKey, Cookie: cookie } });
    await mcp.initialize();
    const erro = await erroDe(() => mcp.prompt("biblioteca"));

    expect(erro.code).toBe(-32602);
    expect(erro.message).toMatch(/prompts\/get.*prompt desconhecido: biblioteca/);
    for (const segredo of [token, "outro-token-servidor", apiKey, cookie, cookieValue]) expect(erro.message).not.toContain(segredo);
  });

  it("redige erros de ferramentas sem transformar projeto não encontrado em conteúdo", async () => {
    const fixture = await servidor((pedido) => pedido.method === "tools/call"
      ? envelope(pedido, { isError: true, content: [{ type: "text", text: `projeto não encontrado: biblioteca; Bearer ${token}; ${apiKey}` }] })
      : respostaNormal(pedido));
    const mcp = createMcpClient({ url: fixture.url, headers: { Authorization: `Bearer ${token}`, "X-Api-Key": apiKey } });
    await mcp.initialize();
    const erro = await erroDe(() => mcp.callTool("buscar", { projeto: "biblioteca" }));

    expect(erro.message).toContain("projeto não encontrado: biblioteca");
    expect(erro.message).not.toContain(token);
    expect(erro.message).not.toContain(apiKey);
  });

  it("não imprime credenciais de uma resposta inválida ao indicar falha de JSON", async () => {
    const fixture = await servidor((pedido) => pedido.method === "resources/read"
      ? { status: 200, headers: { "content-type": "application/json" }, body: `JSON inválido: Bearer ${token}; ${apiKey}; ${cookie}` }
      : respostaNormal(pedido));
    const mcp = createMcpClient({ url: fixture.url, headers: { Authorization: `Bearer ${token}`, "X-Api-Key": apiKey, Cookie: cookie } });
    await mcp.initialize();
    const erro = await erroDe(() => mcp.readResource("capivara://biblioteca/pedido"));

    expect(erro.message).toMatch(/JSON/);
    for (const segredo of [token, apiKey, cookie]) expect(erro.message).not.toContain(segredo);
  });

  it.each([200, 500])("redige um segredo longo antes de truncar o corpo do erro HTTP %i", async (status) => {
    const longToken = "long_secret_" + "mcp123ABC".repeat(45);
    const fixture = await servidor((pedido) => pedido.method === "resources/read"
      ? {
        status,
        headers: { "content-type": "application/json" },
        body: `JSON inválido; chave=${longToken}; detalhe posterior`,
      }
      : respostaNormal(pedido));
    const mcp = createMcpClient({ url: fixture.url, headers: { "X-Api-Key": longToken } });
    await mcp.initialize();
    const erro = await erroDe(() => mcp.readResource("capivara://biblioteca/pedido"));

    expect(erro.message).toMatch(status === 200 ? /JSON/ : /500/);
    expect(erro.message).not.toContain(longToken.slice(0, 80));
    expect(erro.message).not.toContain("long_secret_");
  });

  it("redige valores de ambiente do provider refletidos no erro do servidor", async () => {
    const providerKey = "sk-provider-secret-abcdefghijklmnopqrst";
    vi.stubEnv("OPENAI_API_KEY", providerKey);
    const fixture = await servidor((pedido) => pedido.method === "tools/call"
      ? envelope(pedido, { isError: true, content: [{ type: "text", text: `projeto não encontrado; provider=${providerKey}` }] })
      : respostaNormal(pedido));
    const mcp = createMcpClient({ url: fixture.url, headers: { Authorization: `Bearer ${token}` } });
    await mcp.initialize();
    const erro = await erroDe(() => mcp.callTool("buscar"));

    expect(erro.message).toContain("projeto não encontrado");
    expect(erro.message).not.toContain(providerKey);
  });

  it("redige erros de rede injetados, preservando a causa útil", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error(`conexão recusada: Bearer ${token}; ${apiKey}; ${cookie}`);
    });
    const mcp = createMcpClient({ url: "https://doc-center.example/mcp", headers: { Authorization: `Bearer ${token}`, "X-Api-Key": apiKey, Cookie: cookie } }, { fetchImpl });
    const erro = await erroDe(() => mcp.initialize());

    expect(erro.message).toContain("não consegui falar com o servidor MCP");
    expect(erro.message).toContain("conexão recusada");
    for (const segredo of [token, apiKey, cookie]) expect(erro.message).not.toContain(segredo);
  });

  it("redige uma falha de rede ao ler o corpo da resposta", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, options) => {
      const pedido = JSON.parse(String(options?.body)) as Pedido;
      const resposta = respostaNormal(pedido);
      const response = new Response(resposta.body || null, { status: resposta.status, ...(resposta.headers ? { headers: resposta.headers } : {}) });
      if (pedido.method === "resources/read") {
        vi.spyOn(response, "text").mockRejectedValue(new Error(`stream interrompido; Bearer ${token}; ${apiKey}`));
      }
      return response;
    });
    const mcp = createMcpClient({ url: "https://doc-center.example/mcp", headers: { Authorization: `Bearer ${token}`, "X-Api-Key": apiKey } }, { fetchImpl });
    await mcp.initialize();
    const erro = await erroDe(() => mcp.readResource("capivara://biblioteca/pedido"));

    expect(erro.message).toContain("não consegui falar com o servidor MCP");
    expect(erro.message).toContain("stream interrompido");
    expect(erro.message).not.toContain(token);
    expect(erro.message).not.toContain(apiKey);
  });
});

describe("URL e cabeçalhos HTTP ou HTTPS", () => {
  it.each([
    "não é uma URL",
    "file:///tmp/mcp",
    "ftp://doc-center.example/mcp",
    "https://usuario:senha@doc-center.example/mcp",
    "https://doc-center.example/mcp?token=segredo",
    "https://doc-center.example/mcp#segredo",
  ])("recusa URL inválida ou com credenciais, query ou fragmento: %s", (url) => {
    const fetchImpl = fetchSemRede();
    expect(() => createMcpClient({ url }, { fetchImpl })).toThrow(McpError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    { authorization: `Bearer ${token}` },
    { AUTHORIZATION: `Bearer ${token}` },
    { cOoKiE: cookie },
    { "X-Api-Key": apiKey },
    { "X-Auth-Token": token },
    { "Proxy-Authorization": `Bearer ${token}` },
    { Authorization: `Bearer ${token}`, Cookie: cookie, "X-Api-Key": apiKey },
  ])("preserva cabeçalhos de autenticação em HTTP remoto sem seguir redirects (%#)", async (headers) => {
    const fetchImpl = fetchSemRede();
    const url = "http://doc-center.example:7777/mcp";
    const client = createMcpClient({ url, headers }, { fetchImpl });
    await client.initialize();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [calledUrl, options] of fetchImpl.mock.calls) {
      expect(calledUrl).toBe(url);
      expect(options?.redirect).toBe("error");
      const received = new Headers(options?.headers);
      for (const [name, value] of Object.entries(headers)) expect(received.get(name)).toBe(value);
    }
  });

  it.each([
    "http://localhost:7777/mcp",
    "http://127.0.0.1:7777/mcp",
    "http://127.0.0.2:7777/mcp",
    "http://[::1]:7777/mcp",
    "http://doc-center.example:7777/mcp",
    "https://doc-center.example/mcp",
  ])("permite HTTP ou HTTPS com token: %s", async (url) => {
    const fetchImpl = fetchSemRede();
    const mcp = createMcpClient({ url, headers: { Authorization: `Bearer ${token}` } }, { fetchImpl });
    await mcp.initialize();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [, options] of fetchImpl.mock.calls) {
      expect(options?.redirect).toBe("error");
      expect(new Headers(options?.headers).get("authorization")).toBe(`Bearer ${token}`);
    }
  });

  it.each([undefined, { "X-Client-Name": "capivara" }])("preserva HTTP remoto sem credenciais para servidores genéricos", async (headers) => {
    const fetchImpl = fetchSemRede();
    const mcp = createMcpClient({ url: "http://mcp-generico.example/mcp", ...(headers ? { headers } : {}) }, { fetchImpl });
    await mcp.initialize();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
