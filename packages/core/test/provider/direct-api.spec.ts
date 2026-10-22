import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildInvocation, DIRECT_CATALOG, runProvider } from "../../src/provider/index.js";
import type { Invocation } from "../../src/provider/index.js";
import { createAgentBridge } from "../../src/commands/agent.js";
import { saveCredential } from "../../src/provider/credentials.js";

const key = "sk-api-apenas-de-teste";
const limits = { firstOutputSeconds: 0, idleSeconds: 0, wallSeconds: 2, maxOutputBytes: 100000 };
let server: Server | undefined;
let directory: string | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

function invocation(provider = "minimax", effort = ""): Invocation {
  const definition = DIRECT_CATALOG.find((p) => p.id === provider)!;
  return buildInvocation("writer", { provider, model: provider === "minimax" ? "MiniMax-M3" : "modelo-teste", effort, credential: "", command: "" },
    { projectRoot: process.cwd(), runId: "api-test", language: "pt-BR", stage: "interview", environment: { [definition.envKey]: key } });
}
const answer = (text = "PONG") => new Response(JSON.stringify({ choices: [{ message: { content: text, reasoning_content: "não é o documento" }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 3 }, completion_tokens_details: { reasoning_tokens: 1 } } }));

describe("API direta executada pelo supervisor", () => {
  it.each(DIRECT_CATALOG)("$id envia HTTP sem subprocesso e extrai só texto final", async (provider) => {
    const anthropic = provider.dialect === "anthropic-messages";
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(anthropic
      ? new Response(JSON.stringify({ content: [{ type: "thinking", thinking: "interno" }, { type: "text", text: "PONG" }], stop_reason: "end_turn", usage: { input_tokens: 9, cache_read_input_tokens: 3, output_tokens: 4 } }))
      : answer());
    const call = invocation(provider.id);
    expect(call.args).not.toContain("--capivara-direct-api");
    const result = await runProvider({ invocation: call, prompt: "Pedido completo", limits });
    expect(result).toMatchObject({ exitCode: 0, stdout: "PONG", stderr: "", resultRead: true, usage: { inputTokens: 12, cachedInputTokens: 3, outputTokens: 4 } });
    const [endpoint, request] = fetcher.mock.calls[0]!;
    expect(endpoint).toBe(provider.endpoint);
    expect(request).toMatchObject({ method: "POST", redirect: "error", headers: anthropic ? { "x-api-key": key, "anthropic-version": "2023-06-01" } : { Authorization: `Bearer ${key}` } });
    const body = JSON.parse(String(request?.body));
    expect(body.messages).toEqual([{ role: "user", content: "Pedido completo" }]);
    expect(body.stream).toBe(false);
    expect(body.max_tokens ?? body.max_completion_tokens).toBe(32768);
    expect(body.tools).toBeUndefined();
    if (["minimax", "deepseek", "anthropic"].includes(provider.id)) expect(body.thinking.type).toBe("disabled");
    else if (provider.id === "openrouter") expect(body.reasoning.enabled).toBe(false);
    else expect(body.reasoning_effort).toBe("none");
  });

  it("effort explícito liga o raciocínio MiniMax sem misturá-lo ao texto", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(answer());
    await runProvider({ invocation: invocation("minimax", "high"), prompt: "Teste", limits });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ thinking: { type: "adaptive" }, reasoning_effort: "high", reasoning_split: true });
  });

  it.each(DIRECT_CATALOG)("$id respeita teto de tokens explícito sem mudar esforço", async provider => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(answer());
    const call = invocation(provider.id);
    call.env.CAPIVARA_API_MAX_OUTPUT_TOKENS = "49152";
    await runProvider({ invocation: call, prompt: "Teste", limits });
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.max_tokens ?? body.max_completion_tokens).toBe(49152);
  });

  it.each(["0", "-1", "1.5", "NaN", "9007199254740992"])("recusa teto inválido %s antes do HTTP", async value => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    const call = invocation("openrouter");
    call.env.CAPIVARA_API_MAX_OUTPUT_TOKENS = value;
    const result = await runProvider({ invocation: call, prompt: "Teste", limits });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("CAPIVARA_API_MAX_OUTPUT_TOKENS");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("corte por tokens conserva uso e parcial sanitizado, sem aprovar ou repetir", async () => {
    const partial = `- [ ] **Task:** parcial ${key}`;
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: partial, reasoning: "pensamento privado" }, finish_reason: "length" }],
      usage: { prompt_tokens: 8000, completion_tokens: 32768, completion_tokens_details: { reasoning_tokens: 32000 }, cost: 0.03 },
    })));
    const result = await runProvider({ invocation: invocation("openrouter", "high"), prompt: "Teste", limits });
    expect(result).toMatchObject({ exitCode: 1, stdout: "", resultRead: false, partialOutput: "- [ ] **Task:** parcial [REDACTED:OPENROUTER_API_KEY]", usage: { outputTokens: 32768, reasoningTokens: 32000, costUsd: 0.03 } });
    expect(result.stderr).toContain("teto solicitado: 32768");
    expect(result.stderr).toContain("raciocínio: 32000");
    expect(result.stderr).toContain("effort: high");
    expect(result.stderr).not.toContain("pensamento privado");
    expect(JSON.stringify(result)).not.toContain(key);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("corte sem métricas registra desconhecido em vez de inventar consumo", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "" }, finish_reason: "length" }] })));
    const result = await runProvider({ invocation: invocation("openrouter"), prompt: "Teste", limits });
    expect(result.stderr).toContain("saída: não informado");
    expect(result.stderr).toContain("raciocínio: não informado");
  });

  it("não cobra raciocínio obrigatório de MiniMax M2 sem autorização explícita", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(answer());
    const call = invocation();
    call.directApi!.model = "MiniMax-M2.7";
    const result = await runProvider({ invocation: call, prompt: "Teste", limits });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--effort explicitamente (thinking)");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sem chave não envia requisição", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    const call = invocation();
    delete call.env.MINIMAX_API_KEY;
    const result = await runProvider({ invocation: call, prompt: "Teste", limits });
    expect(result.stderr).toContain("capivara login minimax");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([401, 429, 500])("HTTP %s preserva diagnóstico e remove segredos também do callback", async (status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: { message: `credencial ${key}` }, private: "não registrar o corpo inteiro" }), { status }));
    const observed: string[] = [];
    const result = await runProvider({ invocation: invocation(), prompt: "Teste", limits, onOutput: (text) => observed.push(text) });
    expect(result).toMatchObject({ exitCode: 1, stdout: "", engineError: true, resultRead: false });
    expect(result.stderr).toContain(`HTTP ${status}`);
    expect(JSON.stringify([result, observed])).not.toContain(key);
    expect(result.stderr).not.toContain("corpo inteiro");
  });

  it.each([
    { body: "não é JSON", diagnosis: "JSON inválido" },
    { body: '{"choices":[{"message":{"reasoning_content":"apenas pensamento"}}]}', diagnosis: "sem texto final" },
    { body: '{"choices":[{"message":{"content":"parcial"},"finish_reason":"length"}]}', diagnosis: "limite de tokens" },
    { body: '{"base_resp":{"status_code":1008,"status_msg":"insufficient balance"}}', diagnosis: "insufficient balance" },
    { body: '{"choices":[{"message":{"content":"parcial"},"finish_reason":"tool_calls"}]}', diagnosis: "pediu ferramentas" },
  ])("não aprova resposta inválida: $diagnosis", async ({ body, diagnosis }) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body));
    const result = await runProvider({ invocation: invocation(), prompt: "Teste", limits });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(diagnosis);
  });

  it("teto de bytes impede JSON grande de passar como resposta válida", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(answer("x".repeat(200)));
    const result = await runProvider({ invocation: invocation(), prompt: "Teste", limits: { ...limits, maxOutputBytes: 50 } });
    expect(result).toMatchObject({ exitCode: 1, truncated: true, resultRead: false });
  });

  it("redige segredo no texto final e tolera observador com erro", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(answer(`Texto ${key}`));
    const result = await runProvider({ invocation: invocation(), prompt: "Teste", limits, onOutput: () => { throw Error("observador"); } });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain(key);
  });

  it.each([false, true])("HTTP real: limite de parede e cancelamento (cancel=%s)", async (cancel) => {
    server = createServer((_request, _response) => { /* servidor não responde */ });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    const call = invocation();
    call.directApi = { ...call.directApi!, provider: { ...call.directApi!.provider, endpoint: `http://127.0.0.1:${address.port}` } };
    const controller = new AbortController();
    const timer = cancel ? setTimeout(() => controller.abort(), 50) : undefined;
    try {
      const result = await runProvider({ invocation: call, prompt: "Teste", limits: { ...limits, wallSeconds: cancel ? 2 : 0.05 }, signal: controller.signal });
      expect(result.exitCode).toBe(cancel ? 1 : 124);
      expect(result.timedOut).toBe(cancel ? null : "wall");
      expect(result.stderr).toContain(cancel ? "cancelada" : "limite de tempo");
    } finally { if (timer) clearTimeout(timer); }
  });

  it("ponte usa a chave MiniMax salva e contabiliza a geração", async () => {
    directory = await mkdtemp(join(tmpdir(), "capivara-api-bridge-"));
    const file = join(directory, "credentials.json");
    await saveCredential({ id: "minimax", label: "principal", provider: "minimax", secret: key, default: true, createdAt: "agora" }, file);
    vi.stubEnv("MINIMAX_API_KEY", "");
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(answer());
    const config = { provider: "minimax", model: "MiniMax-M3", effort: "", credential: "", command: "" };
    const bridge = createAgentBridge({ projectRoot: directory, runId: "api", language: "pt-BR", roles: { writer: config, auditor: config, verifier: config, builder: config }, limits, credentialsFile: file });
    expect(await bridge({ role: "writer", stage: "interview", prompt: "Teste" })).toMatchObject({ exitCode: 0, stdout: "PONG", resultRead: true, usage: { inputTokens: 12 } });
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.minimax.io/v1/chat/completions");
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: `Bearer ${key}` });
  });

  it("HTTP real devolve texto UTF-8 sem enviar a credencial por query ou seguir redirect", async () => {
    const paths: string[] = [];
    server = createServer(async (request, response) => {
      paths.push(request.url ?? "");
      if (request.url === "/redirect") { response.writeHead(302, { Location: "/vazamento" }); response.end(); return; }
      expect(request.headers.authorization).toBe(`Bearer ${key}`);
      let body = "";
      for await (const chunk of request) body += String(chunk);
      expect(JSON.parse(body).messages[0].content).toBe("Pedido");
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ choices: [{ message: { content: "Olá, ação!" }, finish_reason: "stop" }] }));
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const call = invocation();
    call.directApi = { ...call.directApi!, provider: { ...call.directApi!.provider, endpoint: `${endpoint}/chat` } };
    expect(await runProvider({ invocation: call, prompt: "Pedido", limits })).toMatchObject({ exitCode: 0, stdout: "Olá, ação!" });
    call.directApi.provider = { ...call.directApi.provider, endpoint: `${endpoint}/redirect` };
    expect((await runProvider({ invocation: call, prompt: "Pedido", limits })).exitCode).toBe(1);
    expect(paths).toEqual(["/chat", "/redirect"]);
  });
});
