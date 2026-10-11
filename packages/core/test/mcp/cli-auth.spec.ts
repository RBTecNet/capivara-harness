/** Exercita os comandos reais contra HTTP autenticado, sem executar modelos. */
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgram } from "../../src/cli-program.js";
import { runInit, writeRequestState, requestFromLibrary } from "../../src/init/index.js";
import { runBuild } from "../../src/loop/index.js";
import { runWizard } from "../../src/commands/wizard.js";
import { runSurvey } from "../../src/survey/index.js";
import { artifactPaths } from "../../src/state/index.js";

vi.mock("../../src/init/index.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/init/index.js")>(),
  runInit: vi.fn(),
}));
vi.mock("../../src/loop/index.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/loop/index.js")>(),
  runBuild: vi.fn(),
}));
vi.mock("../../src/commands/wizard.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/commands/wizard.js")>(),
  runWizard: vi.fn(),
}));
vi.mock("../../src/survey/index.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/survey/index.js")>(),
  runSurvey: vi.fn(),
}));

const TOKEN = "dc_cli_test_secret";
const memoria = { natureza: "decisao" as const, titulo: "Stack", conteudo: "Usar Node", procedencia: "run-test" };
let server: Server;
let url: string;
let root: string;
let output: string;
let previousExitCode: typeof process.exitCode;
let recebidos: { method: string; authorization: string | undefined; params: Record<string, unknown> }[];

beforeEach(async () => {
  previousExitCode = process.exitCode;
  process.exitCode = undefined;
  vi.clearAllMocks();
  for (const name of ["CAPIVARA_MCP_URL", "CAPIVARA_MCP_TOKEN", "DOC_CENTER_URL", "DOC_CENTER_TOKEN"]) vi.stubEnv(name, "");
  output = "";
  vi.spyOn(process.stdout, "write").mockImplementation(((text: string | Uint8Array) => {
    output += String(text);
    return true;
  }) as typeof process.stdout.write);
  root = await mkdtemp(join(tmpdir(), "capivara-cli-mcp-"));
  vi.stubEnv("CAPIVARA_CONFIG_DIR", join(root, "global-config"));
  recebidos = [];
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += String(chunk); });
    req.on("end", () => {
      const rpc = JSON.parse(body) as { id?: number; method: string; params?: Record<string, unknown> };
      recebidos.push({ method: rpc.method, authorization: req.headers.authorization, params: rpc.params ?? {} });
      if (req.headers.authorization !== `Bearer ${TOKEN}`) {
        res.writeHead(401, { "content-type": "application/json" }).end('{"erro":"não autenticado"}');
        return;
      }
      if (rpc.id === undefined) { res.writeHead(202).end(); return; }
      let result: unknown = {};
      if (rpc.method === "initialize") result = { protocolVersion: "2025-06-18", serverInfo: { name: "doc-center", version: "test" } };
      if (rpc.method === "resources/list") result = { resources: [
        { uri: "capivara://biblioteca/pedido", name: "Pedido" },
        { uri: "capivara://outro/pedido", name: "Outro pedido" },
      ] };
      if (rpc.method === "resources/read") result = { contents: [{ uri: rpc.params?.uri, text: "um sistema de biblioteca" }] };
      if (rpc.method === "prompts/list") result = { prompts: [{ name: "biblioteca", title: "Biblioteca" }] };
      if (rpc.method === "prompts/get") result = { messages: [{ role: "user", content: { type: "text", text: "um sistema de biblioteca" } }] };
      if (rpc.method === "tools/call") result = { content: [{ type: "text", text: "registrado" }] };
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("listener do teste inválido");
  url = `http://127.0.0.1:${address.port}/mcp`;
  vi.stubEnv("DOC_CENTER_URL", url);
  vi.stubEnv("DOC_CENTER_TOKEN", TOKEN);

  vi.mocked(runInit).mockImplementation(async (options) => {
    await writeRequestState(options.projectRoot, options.request);
    await options.onMemorias?.([memoria]);
    const readiness = { ready: true, checks: [], contractErrors: [] };
    return {
      runId: "init-test", readiness, rendered: "PLAN READY",
      report: { ready: true, published: [], phases: 0, tasks: 0, mvpCutPhase: 0,
        coverage: { stories: 0, entities: 0, workflows: 0 },
        checkpoint: { decisions: [], assumptions: [], deferrals: [], ambiguities: [] },
        remarks: [], costs: [], readiness },
    };
  });
  vi.mocked(runBuild).mockImplementation(async (options) => {
    await options.onMemorias?.([memoria]);
    return { runId: "build-test", exitCode: 0, phases: [], warnings: [], errors: [], acceptance: null };
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = previousExitCode;
});

async function command(...args: string[]): Promise<void> {
  await createProgram().parseAsync([...args, "--project", root, "--provider", "codex", "--no-splash", "--no-modal"], { from: "user" });
}

function expectAuthenticated(): void {
  expect(recebidos.length).toBeGreaterThan(0);
  expect(recebidos.every((request) => request.authorization === `Bearer ${TOKEN}`)).toBe(true);
  expect(recebidos.some((request) => request.method === "notifications/initialized")).toBe(true);
  expect(output).not.toContain(TOKEN);
}

describe("comandos com doc-center autenticado", () => {
  it("init lê projeto e registra memórias usando o token sem persistir o segredo", async () => {
    await command("init", "--mcp-project", "biblioteca", "--no-commit", "--no-dashboard");
    expectAuthenticated();
    expect(process.exitCode).toBe(0);
    expect(vi.mocked(runInit).mock.calls[0]?.[0].request).toMatchObject({ origin: "mcp", path: "capivara://biblioteca/pedido", base: url });
    expect(recebidos.some((request) => request.method === "tools/call" && request.params.name === "registrar_memoria")).toBe(true);
    const persisted = await readFile(join(artifactPaths(root).handoffs, "pedido.json"), "utf8");
    expect(persisted).not.toContain(TOKEN);
    expect(persisted).not.toMatch(/authorization|headers/i);
  });

  it("init --prompt aceita URL do ambiente sem exigir um projeto", async () => {
    await command("init", "--prompt", "biblioteca", "--no-commit", "--no-dashboard");
    expectAuthenticated();
    expect(vi.mocked(runInit).mock.calls[0]?.[0].request).toMatchObject({ origin: "mcp", path: "prompt:biblioteca", base: url });
    expect(recebidos.some((request) => request.method === "prompts/get")).toBe(true);
  });

  it("um pedido literal não consulta a base só porque o ambiente tem URL e token", async () => {
    await command("init", "um sistema local", "--no-commit", "--no-dashboard");
    expect(recebidos).toEqual([]);
    expect(vi.mocked(runInit).mock.calls[0]?.[0].request).toMatchObject({ origin: "text", text: "um sistema local" });
    expect(vi.mocked(runInit).mock.calls[0]?.[0].request.base).toBeUndefined();
  });

  it("build retoma o slug e migra a URL local antiga para a do ambiente", async () => {
    await writeRequestState(root, requestFromLibrary("biblioteca", "um sistema de biblioteca", "http://localhost:1/mcp"));
    await command("build", "--no-dashboard");
    expectAuthenticated();
    expect(process.exitCode).toBe(0);
    expect(recebidos.some((request) => request.method === "resources/read" && request.params.uri === "capivara://biblioteca/pedido")).toBe(true);
    const tool = recebidos.find((request) => request.params.name === "registrar_memoria");
    expect(tool?.params.arguments).toMatchObject({ projeto: "biblioteca" });
  });

  it("build preserva o slug explícito em vez de sobrescrevê-lo com o herdado", async () => {
    await writeRequestState(root, requestFromLibrary("biblioteca", "um sistema de biblioteca", "http://localhost:1/mcp"));
    await command("build", "--mcp", url, "--mcp-project", "outro", "--no-dashboard");
    expectAuthenticated();
    expect(recebidos.some((request) => request.method === "resources/read" && request.params.uri === "capivara://outro/pedido")).toBe(true);
    expect(recebidos.find((request) => request.params.name === "registrar_memoria")?.params.arguments).toMatchObject({ projeto: "outro" });
  });

  it("wizard usa o ambiente do doc-center e autentica todas as leituras", async () => {
    vi.mocked(runWizard).mockImplementation(async (options) => {
      expect(options.defaultMcpUrl).toBe(url);
      await options.listMcpProjects?.(url);
      await options.listMcpPrompts?.(url);
      await options.readMcpPrompt?.(url, "biblioteca");
      return null;
    });
    await createProgram().parseAsync(["wizard"], { from: "user" });
    expectAuthenticated();
    expect(recebidos.some((request) => request.method === "resources/list")).toBe(true);
    expect(recebidos.some((request) => request.method === "prompts/list")).toBe(true);
    expect(recebidos.some((request) => request.method === "prompts/get")).toBe(true);
  });

  it("survey autentica o envio e mostra o projeto sem adivinhar a origem web", async () => {
    vi.mocked(runSurvey).mockImplementation(async (options) => {
      expect(options.base?.projeto).toBe("biblioteca");
      expect(await options.base?.existe("biblioteca")).toBe(true);
      const sent = await options.base?.enviar("biblioteca", "# Levantamento");
      return {
        survey: { contract: "capivara-survey/v1", application: "Biblioteca", stack: [], domains: [], rules: [], flows: [], entities: [], questions: [], integrations: [], deadCode: [] },
        coverage: { claimed: 0, total: 0, unclaimed: [], domainsWithoutRules: [], domainsWithoutFlows: [] }, written: [], markdown: "# Levantamento",
        destino: { slug: "biblioteca", enviado: sent?.ok === true, mensagem: sent?.mensagem ?? "" },
      };
    });
    await command("survey", "--mcp-project", "biblioteca", "--saida", join(root, "survey"));
    expectAuthenticated();
    expect(recebidos.some((request) => request.params.name === "registrar_levantamento")).toBe(true);
    expect(output).toContain('projeto "biblioteca"');
    expect(output).not.toContain("/projeto/");
  });

  it("não transmite o token ao endpoint de outra base", async () => {
    await command("init", "--mcp", "https://another.example/mcp", "--mcp-project", "biblioteca", "--no-commit", "--no-dashboard");
    expect(recebidos).toEqual([]);
    expect(runInit).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
    expect(output).toContain("outro endpoint");
    expect(output).not.toContain(TOKEN);
  });
});
