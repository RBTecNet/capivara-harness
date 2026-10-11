import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveMcpConnection, type SavedMcpConnection } from "../../src/config/global.js";
import { configuredMcpUrl, createMcpClient, resolveMcpEndpoint, resolveMcpProject } from "../../src/mcp/index.js";

let root = "";
let file = "";
const principal: SavedMcpConnection = { url: "https://docs.example/mcp", port: 443, token: "dc_saved_principal_secret_0123456789" };
const secondary: SavedMcpConnection = { url: "https://other.example:8443/mcp", port: 8443, token: "dc_saved_secondary_secret_9876543210" };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "capivara-global-mcp-resolver-"));
  file = join(root, "config.json");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function environment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { CAPIVARA_CONFIG_DIR: root, ...extra };
}

function erroDe(chamada: () => unknown): Error {
  try {
    chamada();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }
  throw new Error("a operação deveria ter sido recusada");
}

describe("conexão MCP persistida e descoberta pelo resolver", () => {
  it("arquivo ausente mantém a API sem configuração e permite MCP genérico explícito", () => {
    expect(configuredMcpUrl(undefined, environment())).toBeUndefined();
    expect(resolveMcpEndpoint(undefined, environment())).toBeNull();
    expect(resolveMcpEndpoint("http://generic.example/mcp", environment())).toEqual({ url: "http://generic.example/mcp" });
  });

  it("prioriza flag, ambiente Capivara, ambiente doc-center e depois o servidor salvo", async () => {
    await saveMcpConnection(principal, file);
    const capivaraUrl = "https://capivara.example/mcp";
    const docUrl = "https://doc-environment.example/mcp";
    expect(configuredMcpUrl(" https://explicit.example/mcp ", environment({ CAPIVARA_MCP_URL: capivaraUrl, DOC_CENTER_URL: docUrl }))).toBe("https://explicit.example/mcp");
    expect(configuredMcpUrl(undefined, environment({ CAPIVARA_MCP_URL: capivaraUrl, DOC_CENTER_URL: docUrl }))).toBe(capivaraUrl);
    expect(configuredMcpUrl(" ", environment({ CAPIVARA_MCP_URL: " ", DOC_CENTER_URL: docUrl }))).toBe(docUrl);
    expect(configuredMcpUrl(undefined, environment())).toBe(principal.url);
  });

  it("o token salvo reaparece em novas consultas sem depender do ambiente do processo", async () => {
    await saveMcpConnection(principal, file);
    expect(resolveMcpEndpoint(undefined, environment())).toEqual({ url: principal.url, headers: { authorization: `Bearer ${principal.token}` } });

    const rotated = { ...principal, token: "dc_rotated_saved_secret_1357924680" };
    await saveMcpConnection(rotated, file);
    expect(resolveMcpEndpoint(undefined, { CAPIVARA_CONFIG_DIR: root })).toEqual({ url: principal.url, headers: { authorization: `Bearer ${rotated.token}` } });
  });

  it("resolve HTTP remoto persistido na porta 7777 sem exportar token e autentica o cliente", async () => {
    const connection: SavedMcpConnection = {
      url: "http://docs.example:7777/mcp", port: 7777, token: "dc_saved_http_secret_0123456789",
    };
    await saveMcpConnection(connection, file);
    const endpoint = resolveMcpEndpoint(undefined, { CAPIVARA_CONFIG_DIR: root });
    expect(endpoint).toEqual({ url: connection.url, headers: { authorization: `Bearer ${connection.token}` } });
    if (!endpoint) throw new Error("conexão HTTP persistida indisponível");
    const fetchImpl = vi.fn<typeof fetch>(async (_url, options) => {
      const rpc = JSON.parse(String(options?.body)) as { id?: number; method: string };
      if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result: {
        protocolVersion: "2025-06-18", serverInfo: { name: "doc-center", version: "1" },
      } });
    });
    await createMcpClient(endpoint, { fetchImpl }).initialize();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetchImpl.mock.calls) {
      expect(url).toBe(connection.url);
      expect(options?.redirect).toBe("error");
      expect(new Headers(options?.headers).get("authorization")).toBe(`Bearer ${connection.token}`);
    }
  });

  it("prioriza os tokens Capivara e doc-center sobre a credencial persistida", async () => {
    await saveMcpConnection(principal, file);
    const capivaraToken = "dc_capivara_environment_secret";
    const docToken = "dc_doc_environment_secret";
    expect(resolveMcpEndpoint(undefined, environment({ CAPIVARA_MCP_TOKEN: capivaraToken, DOC_CENTER_TOKEN: docToken }))?.headers?.authorization).toBe(`Bearer ${capivaraToken}`);
    expect(resolveMcpEndpoint(undefined, environment({ CAPIVARA_MCP_TOKEN: " ", DOC_CENTER_TOKEN: docToken }))?.headers?.authorization).toBe(`Bearer ${docToken}`);
    expect(resolveMcpEndpoint(undefined, environment())?.headers?.authorization).toBe(`Bearer ${principal.token}`);
  });

  it("usa o token da URL explícita correspondente em vez do token do padrão", async () => {
    await saveMcpConnection(principal, file);
    await saveMcpConnection(secondary, file);
    expect(configuredMcpUrl(undefined, environment())).toBe(secondary.url);
    expect(resolveMcpEndpoint("https://DOCS.example:443/mcp", environment())).toEqual({ url: principal.url, headers: { authorization: `Bearer ${principal.token}` } });
    expect(resolveMcpEndpoint(secondary.url, environment())).toEqual({ url: secondary.url, headers: { authorization: `Bearer ${secondary.token}` } });
  });

  it.each([
    "https://unknown.example/mcp",
    "https://docs.example/another",
    "https://docs.example:8443/mcp",
    "http://docs.example/mcp",
    "http://generic.example/mcp",
  ])("não envia o token salvo para outra origem, porta ou caminho: %s", async (url) => {
    await saveMcpConnection(principal, file);
    expect(resolveMcpEndpoint(url, environment())).toEqual({ url });
    expect(JSON.stringify(resolveMcpEndpoint(url, environment()))).not.toContain(principal.token);
  });

  it("uma URL do ambiente pode selecionar outra conexão persistida pelo endereço", async () => {
    await saveMcpConnection(secondary, file);
    await saveMcpConnection(principal, file);
    const endpoint = resolveMcpEndpoint(undefined, environment({ DOC_CENTER_URL: secondary.url }));
    expect(endpoint).toEqual({ url: secondary.url, headers: { authorization: `Bearer ${secondary.token}` } });
  });

  it.each(["CAPIVARA", "DOC_CENTER"] as const)("mantém o erro de token de ambiente %s associado a outra URL", async (kind) => {
    await saveMcpConnection(principal, file);
    const secret = "dc_environment_never_forward_secret";
    const configured = kind === "CAPIVARA"
      ? { CAPIVARA_MCP_URL: principal.url, CAPIVARA_MCP_TOKEN: secret }
      : { DOC_CENTER_URL: principal.url, DOC_CENTER_TOKEN: secret };
    const error = erroDe(() => resolveMcpEndpoint(secondary.url, environment(configured)));

    expect(error.message).toMatch(/outro endpoint/);
    expect(error.message).not.toContain(secret);
    expect(error.message).not.toContain(principal.token);
  });

  it("um token de ambiente sem URL associada continua válido com URL explícita", async () => {
    await saveMcpConnection(principal, file);
    const secret = "dc_intentionally_explicit_environment_secret";
    expect(resolveMcpEndpoint(secondary.url, environment({ DOC_CENTER_TOKEN: secret }))).toEqual({ url: secondary.url, headers: { authorization: `Bearer ${secret}` } });
  });

  it("diretórios de configuração distintos não compartilham conexão nem token", async () => {
    await saveMcpConnection(principal, file);
    const otherDir = join(root, "other-user");
    await saveMcpConnection(secondary, join(otherDir, "config.json"));

    expect(resolveMcpEndpoint(undefined, environment())?.headers?.authorization).toBe(`Bearer ${principal.token}`);
    expect(resolveMcpEndpoint(undefined, { CAPIVARA_CONFIG_DIR: otherDir })?.headers?.authorization).toBe(`Bearer ${secondary.token}`);
    expect(resolveMcpEndpoint(principal.url, { CAPIVARA_CONFIG_DIR: otherDir })).toEqual({ url: principal.url });
  });

  it("configuração malformada falha sem reproduzir o token e permanece intacta", async () => {
    const raw = `{"version":1,"secret":"${principal.token}"`;
    await writeFile(file, raw, { mode: 0o600 });
    const error = erroDe(() => resolveMcpEndpoint(undefined, environment()));

    expect(error.message).not.toContain(principal.token);
    expect(await readFile(file, "utf8")).toBe(raw);
  });

  it("o cliente usa o Bearer resolvido e não inclui o token no erro remoto", async () => {
    await saveMcpConnection(principal, file);
    const endpoint = resolveMcpEndpoint(undefined, environment());
    if (!endpoint) throw new Error("conexão persistida indisponível");
    const fetchImpl = vi.fn<typeof fetch>(async (_url, options) => {
      const pedido = JSON.parse(String(options?.body)) as { id?: number; method: string };
      if (pedido.method === "notifications/initialized") return new Response(null, { status: 202 });
      const result = pedido.method === "tools/call"
        ? { isError: true, content: [{ type: "text", text: `projeto não encontrado; Bearer ${principal.token}` }] }
        : { protocolVersion: "2025-06-18", serverInfo: { name: "doc-center", version: "1" } };
      return Response.json({ jsonrpc: "2.0", id: pedido.id, result });
    });
    const client = createMcpClient(endpoint, { fetchImpl });
    await client.initialize();
    await expect(client.callTool("buscar", { projeto: "biblioteca" })).rejects.toThrow(/projeto não encontrado/);

    for (const [url, options] of fetchImpl.mock.calls) {
      expect(url).toBe(principal.url);
      expect(new Headers(options?.headers).get("authorization")).toBe(`Bearer ${principal.token}`);
    }
    try { await client.callTool("buscar"); }
    catch (error) { expect(String(error)).not.toContain(principal.token); }
  });
});

describe("seleção de projeto usando o padrão global", () => {
  const inherited = { url: "http://localhost:7777/mcp", projeto: "biblioteca" };

  it("um init literal mantém sua entrada local mesmo com uma conexão salva", async () => {
    await saveMcpConnection(principal, file);
    expect(resolveMcpProject({}, null, environment())).toEqual({});
  });

  it("um slug explícito encontra a conexão salva sem configurar variáveis MCP", async () => {
    await saveMcpConnection(principal, file);
    expect(resolveMcpProject({ mcpProject: "biblioteca" }, null, environment())).toEqual({ mcp: principal.url, mcpProject: "biblioteca" });
  });

  it("retoma o slug do projeto e migra a antiga URL local para o padrão salvo", async () => {
    await saveMcpConnection(principal, file);
    expect(resolveMcpProject({}, inherited, environment())).toEqual({ mcp: principal.url, mcpProject: inherited.projeto });
  });

  it("flags explícitas prevalecem sobre o padrão, herdando apenas campos ausentes", async () => {
    await saveMcpConnection(principal, file);
    expect(resolveMcpProject({ mcp: secondary.url }, inherited, environment())).toEqual({ mcp: secondary.url, mcpProject: inherited.projeto });
    expect(resolveMcpProject({ mcpProject: "outro" }, inherited, environment())).toEqual({ mcp: principal.url, mcpProject: "outro" });
    expect(resolveMcpProject({ mcp: secondary.url, mcpProject: "outro" }, inherited, environment())).toEqual({ mcp: secondary.url, mcpProject: "outro" });
  });

  it("sem conexão global mantém a antiga URL e o slug herdados", () => {
    expect(resolveMcpProject({}, inherited, environment())).toEqual({ mcp: inherited.url, mcpProject: inherited.projeto });
  });
});
