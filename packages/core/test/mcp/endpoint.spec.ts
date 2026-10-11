import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  configuredMcpUrl as configuredMcpUrlImpl,
  resolveMcpEndpoint as resolveMcpEndpointImpl,
  resolveMcpProject as resolveMcpProjectImpl,
} from "../../src/mcp/index.js";

const configDir = mkdtempSync(join(tmpdir(), "capivara-endpoint-config-"));
afterAll(() => rmSync(configDir, { recursive: true, force: true }));
const isolated = (environment: NodeJS.ProcessEnv = {}) => ({ CAPIVARA_CONFIG_DIR: configDir, ...environment });
const configuredMcpUrl = (explicit?: string, environment?: NodeJS.ProcessEnv) => configuredMcpUrlImpl(explicit, isolated(environment));
const resolveMcpEndpoint = (explicit?: string, environment?: NodeJS.ProcessEnv) => resolveMcpEndpointImpl(explicit, isolated(environment));
const resolveMcpProject = (
  flags: Parameters<typeof resolveMcpProjectImpl>[0],
  inherited: Parameters<typeof resolveMcpProjectImpl>[1] = null,
  environment?: NodeJS.ProcessEnv,
) => resolveMcpProjectImpl(flags, inherited, isolated(environment));

describe("configuração do MCP autenticado", () => {
  it("prioriza URL explícita, ambiente do Capivara e ambiente do doc-center", () => {
    const environment = { CAPIVARA_MCP_URL: "https://capivara.example/mcp", DOC_CENTER_URL: "https://docs.example/mcp" };
    expect(configuredMcpUrl(" https://explicit.example/mcp ", environment)).toBe("https://explicit.example/mcp");
    expect(configuredMcpUrl(undefined, environment)).toBe(environment.CAPIVARA_MCP_URL);
    expect(configuredMcpUrl(" ", { CAPIVARA_MCP_URL: " ", DOC_CENTER_URL: environment.DOC_CENTER_URL })).toBe(environment.DOC_CENTER_URL);
    expect(resolveMcpEndpoint(undefined, {})).toBeNull();
  });

  it("mantém MCP genérico sem token e usa Bearer somente no endpoint em memória", () => {
    expect(resolveMcpEndpoint("http://server.example/mcp", {})).toEqual({ url: "http://server.example/mcp" });
    const environment = { DOC_CENTER_URL: "https://docs.example/mcp", DOC_CENTER_TOKEN: "dc_example" };
    expect(resolveMcpEndpoint(undefined, environment)).toEqual({
      url: environment.DOC_CENTER_URL,
      headers: { authorization: "Bearer dc_example" },
    });
    expect(resolveMcpEndpoint("https://docs.example/mcp", {
      ...environment, CAPIVARA_MCP_TOKEN: "capivara_example",
    })?.headers?.authorization).toBe("Bearer capivara_example");
  });

  it("não envia um token global para outro servidor", () => {
    const secret = "dc_never_forward_this_secret";
    for (const environment of [
      { DOC_CENTER_URL: "https://docs.example/mcp", DOC_CENTER_TOKEN: secret },
      { CAPIVARA_MCP_URL: "https://docs.example/mcp", CAPIVARA_MCP_TOKEN: secret },
    ]) {
      expect(() => resolveMcpEndpoint("https://other.example/mcp", environment)).toThrow(/outro endpoint/);
      expect(() => resolveMcpEndpoint("https://docs.example/other", environment)).toThrow(/outro endpoint/);
      try { resolveMcpEndpoint("https://other.example/mcp", environment); }
      catch (error) { expect(String(error)).not.toContain(secret); }
    }
  });

  it("compara URLs normalizadas e permite token sozinho com URL explícita", () => {
    expect(resolveMcpEndpoint("https://DOCS.example:443/mcp", {
      DOC_CENTER_URL: "https://docs.example/mcp", DOC_CENTER_TOKEN: "dc_example",
    })?.headers?.authorization).toBe("Bearer dc_example");
    expect(resolveMcpEndpoint("https://other.example/mcp", { DOC_CENTER_TOKEN: "dc_example" })?.headers?.authorization).toBe("Bearer dc_example");
  });

  it("permite Bearer em HTTP remoto na porta 7777 e em loopback", () => {
    const environment = { DOC_CENTER_TOKEN: "dc_example" };
    for (const host of ["docs.example", "192.168.1.20", "localhost", "127.0.0.1", "127.0.0.2", "[::1]"]) {
      expect(resolveMcpEndpoint(`http://${host}:7777/mcp`, environment)).toEqual({
        url: `http://${host}:7777/mcp`, headers: { authorization: "Bearer dc_example" },
      });
    }
  });

  it.each([
    "not a URL", "file:///tmp/data", "https://user:password@docs.example/mcp",
    "https://docs.example/mcp?token=secret", "https://docs.example/mcp#secret",
    "https://docs.example/mcp?", "https://docs.example/mcp#",
  ])("recusa URL insegura sem reproduzir seu conteúdo: %s", (url) => {
    expect(() => resolveMcpEndpoint(url, {})).toThrow(/endpoint MCP/);
    try { resolveMcpEndpoint(url, {}); }
    catch (error) { expect(String(error)).not.toContain("secret"); expect(String(error)).not.toContain("password"); }
  });

  it("recusa caracteres de controle no token sem exibir seu valor", () => {
    expect(() => resolveMcpEndpoint("https://docs.example/mcp", { DOC_CENTER_TOKEN: "private\r\nvalue" })).toThrow(/caracteres inválidos/);
  });
});

describe("seleção de projeto e retomada", () => {
  const inherited = { url: "http://localhost:7777/mcp", projeto: "biblioteca" };
  const environment = { DOC_CENTER_URL: "https://docs.example/mcp", DOC_CENTER_TOKEN: "dc_example" };

  it("não transforma um init literal em init de projeto só porque existe URL no ambiente", () => {
    expect(resolveMcpProject({}, null, environment)).toEqual({});
    expect(resolveMcpProject({ mcpProject: "biblioteca" }, null, environment)).toEqual({
      mcp: environment.DOC_CENTER_URL, mcpProject: "biblioteca",
    });
  });

  it("migra a URL antiga do init para a atual do ambiente, mantendo o slug", () => {
    expect(resolveMcpProject({}, inherited, environment)).toEqual({ mcp: environment.DOC_CENTER_URL, mcpProject: "biblioteca" });
    expect(resolveMcpProject({}, inherited, {})).toEqual({ mcp: inherited.url, mcpProject: "biblioteca" });
  });

  it("preserva flags explícitas e herda somente os campos ausentes", () => {
    expect(resolveMcpProject({ mcpProject: "outro" }, inherited, environment)).toEqual({
      mcp: environment.DOC_CENTER_URL, mcpProject: "outro",
    });
    expect(resolveMcpProject({ mcp: "https://explicit.example/mcp" }, inherited, environment)).toEqual({
      mcp: "https://explicit.example/mcp", mcpProject: "biblioteca",
    });
    expect(resolveMcpProject({ mcp: "https://explicit.example/mcp", mcpProject: "outro" }, inherited, environment)).toEqual({
      mcp: "https://explicit.example/mcp", mcpProject: "outro",
    });
  });
});
