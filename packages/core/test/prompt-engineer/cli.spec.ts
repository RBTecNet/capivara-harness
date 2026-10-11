/** O comando real: resolve a origem, entrevista por pipe e publica um prompt reutilizável. */
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgram } from "../../src/cli-program.js";
import { buildMcpConnection, saveMcpConnection } from "../../src/config/global.js";
import { resolveRequest } from "../../src/init/index.js";
import { QUESTIONS_CONTRACT } from "../../src/interview/index.js";

const terminal = vi.hoisted(() => ({ lines: "", opened: 0 }));

// A fila e o readline são reais; apenas o stdin do processo de teste é trocado
// pelo pipe que o operador teria enviado ao comando.
vi.mock("node:readline/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:readline/promises")>();
  const { Readable } = await import("node:stream");
  return {
    ...original,
    createInterface: (options: Parameters<typeof original.createInterface>[0]) => {
      const lines = terminal.lines;
      terminal.lines = "";
      terminal.opened += 1;
      return original.createInterface({ ...options, input: Readable.from([lines]) });
    },
  };
});

const EMPTY_ANALYSIS = { contract: QUESTIONS_CONTRACT, questions: [], assumptions: [], omissions: [] };
const QUESTION_ANALYSIS = {
  ...EMPTY_ANALYSIS,
  questions: [{
    id: "Q-01", topic: "público", evidence: "O pedido não identifica quem opera as reservas.",
    decision: "Quem é o público inicial?", why: "Define os fluxos e o vocabulário da interface.",
    options: [
      { label: "Recepcionistas", consequence: "Priorizar a operação interna da pousada." },
      { label: "Hóspedes", consequence: "Priorizar reservas feitas pelo próprio hóspede." },
    ],
    recommended: "Recepcionistas", recommendationBasis: "O pedido descreve uma ferramenta de operação da pousada.",
  }],
};
const GENERATED_PROMPT = {
  contract: "capivara-prompt/v1", language: "en", objective: "Design a booking system for a small inn.",
  context: ["The inn currently manages room bookings manually."],
  requirements: ["Prevent overlapping bookings for the same room."],
  constraints: ["Preserve the user's explicit requirements."],
  steps: ["Describe the booking workflow and validate its edge cases."],
  acceptanceCriteria: ["Two bookings for the same room cannot overlap."],
  deliverables: ["A documented booking workflow with observable acceptance criteria."],
};

interface AdapterCall {
  role: string;
  stage: string;
  permission: string;
  model: string;
  language: string;
  prompt: string;
}

let directory: string;
let projectRoot: string;
let adapter: string;
let callsPath: string;
let output: string;
let previousExitCode: typeof process.exitCode;
let previousStdinTTY: PropertyDescriptor | undefined;
let server: Server | undefined;

async function fixture(options: { question?: boolean; language?: "en" | "pt"; failedStage?: string } = {}): Promise<void> {
  await writeFile(join(directory, "responses.json"), JSON.stringify({
    analysis: options.question ? [QUESTION_ANALYSIS, EMPTY_ANALYSIS] : [EMPTY_ANALYSIS],
    generation: {
      ...GENERATED_PROMPT, language: options.language ?? "en",
      ...(options.question ? { confirmedDecisions: [{ id: "Q-01", statement: "Receptionists are the initial audience." }] } : {}),
    },
    ...(options.failedStage ? { failedStage: options.failedStage } : {}),
  }), "utf8");
}

beforeEach(async () => {
  previousExitCode = process.exitCode;
  process.exitCode = undefined;
  terminal.lines = "";
  terminal.opened = 0;
  previousStdinTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  output = "";
  directory = await mkdtemp(join(tmpdir(), "capivara-prompt-cli-"));
  projectRoot = join(directory, "project");
  await mkdir(projectRoot);
  adapter = join(directory, "adapter.mjs");
  callsPath = join(directory, "calls.jsonl");
  for (const name of ["CAPIVARA_MCP_URL", "CAPIVARA_MCP_TOKEN", "DOC_CENTER_URL", "DOC_CENTER_TOKEN"]) vi.stubEnv(name, "");
  vi.stubEnv("CAPIVARA_CONFIG_DIR", join(directory, "global-config"));
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write);
  await writeFile(adapter, `#!/usr/bin/env node
import { appendFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const base = dirname(fileURLToPath(import.meta.url));
if (process.argv.includes("debug") && process.argv.includes("models")) {
  process.stdout.write(JSON.stringify({ models: [] }));
  process.exit(0);
}
let prompt = "";
for await (const chunk of process.stdin) prompt += String(chunk);
const previous = await readFile(join(base, "calls.jsonl"), "utf8").catch(() => "");
const calls = previous.trim() ? previous.trim().split("\\n").map((line) => JSON.parse(line)) : [];
const stage = process.env.CAPIVARA_STAGE?.replace(/^prompt-engineer:/, "");
await appendFile(join(base, "calls.jsonl"), JSON.stringify({
  role: process.env.CAPIVARA_ROLE, stage, permission: process.env.CAPIVARA_PERMISSION,
  model: process.env.CAPIVARA_MODEL, language: process.env.CAPIVARA_LANGUAGE, prompt,
}) + "\\n");
const responses = JSON.parse(await readFile(join(base, "responses.json"), "utf8"));
if (responses.failedStage === stage) {
  process.stderr.write("falha simulada do escritor");
  process.exit(7);
}
const respond = (content) => {
  const text = JSON.stringify(content);
  process.stdout.write(process.env.CAPIVARA_PROVIDER === "codex"
    ? JSON.stringify({ type: "item.completed", item: { type: "agent_message", text } }) + "\\n"
    : text);
};
if (stage === "interview") {
  const index = calls.filter((call) => call.stage === "interview").length;
  respond(responses.analysis[Math.min(index, responses.analysis.length - 1)]);
} else if (stage === "authoring") {
  respond(responses.generation);
} else {
  process.stderr.write("stage inesperado: " + stage);
  process.exitCode = 91;
}
`, "utf8");
  await chmod(adapter, 0o755);
  await fixture();
});

afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (previousStdinTTY) Object.defineProperty(process.stdin, "isTTY", previousStdinTTY);
  else Reflect.deleteProperty(process.stdin, "isTTY");
  process.exitCode = previousExitCode;
  await rm(directory, { recursive: true, force: true });
});

async function invoke(args: string[], provider = true): Promise<void> {
  await createProgram().parseAsync([
    "prompt-engineer", ...args, "--project", projectRoot, "--adapter", adapter,
    ...(provider ? ["--writer-provider", "custom"] : []), "--no-splash", "--no-modal",
  ], { from: "user" });
}

async function calls(): Promise<AdapterCall[]> {
  const text = await readFile(callsPath, "utf8").catch(() => "");
  return text.trim() ? text.trim().split("\n").map((line) => JSON.parse(line) as AdapterCall) : [];
}

async function startMcp(): Promise<{ url: string; token: string; requests: { method: string; authorization?: string; params: Record<string, unknown> }[] }> {
  const token = "prompt_cli_private_token";
  const requests: { method: string; authorization?: string; params: Record<string, unknown> }[] = [];
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += String(chunk); });
    request.on("end", () => {
      const rpc = JSON.parse(body) as { id?: number; method: string; params?: Record<string, unknown> };
      requests.push({ method: rpc.method, ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}), params: rpc.params ?? {} });
      if (request.headers.authorization !== `Bearer ${token}`) {
        response.writeHead(401).end();
        return;
      }
      if (rpc.id === undefined) { response.writeHead(202).end(); return; }
      let result: unknown = {};
      if (rpc.method === "initialize") result = { protocolVersion: "2025-06-18", serverInfo: { name: "prompt-library", version: "test" } };
      if (rpc.method === "resources/list") result = { resources: [
        { uri: "capivara://pousada/pedido", name: "Pedido" },
        { uri: "capivara://pousada/docs/memoria/ocupacao", name: "Regra de ocupação" },
      ] };
      if (rpc.method === "resources/read") result = { contents: [{ uri: rpc.params?.uri, text:
        rpc.params?.uri === "capivara://pousada/pedido" ? "Reservas recebidas da biblioteca MCP." : "Não permitir duas reservas no mesmo quarto e período.",
      }] };
      if (rpc.method === "prompts/get") result = { messages: [{ role: "user", content: { type: "text", text: "Prompt cru recebido por prompts/get." } }] };
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("listener de teste inválido");
  const url = `http://127.0.0.1:${address.port}/mcp`;
  saveMcpConnection(buildMcpConnection(url, address.port, token));
  return { url, token, requests };
}

describe("capivara prompt-engineer", () => {
  it("expõe as origens existentes e configura somente o escritor", () => {
    const command = createProgram().commands.find((candidate) => candidate.name() === "prompt-engineer");
    expect(command).toBeDefined();
    const flags = command?.options.map((option) => option.long) ?? [];
    expect(flags).toEqual(expect.arrayContaining([
      "--file", "--mcp", "--mcp-project", "--prompt", "--saida", "--language", "--project",
      "--provider", "--model", "--adapter", "--writer-provider", "--writer-model", "--max-interview-rounds",
      "--no-splash", "--no-modal",
    ]));
    for (const role of ["builder", "auditor", "verifier"]) expect(flags).not.toContain(`--${role}-provider`);
  });

  it("gera inglês por padrão, publica para reutilização e usa apenas o escritor em leitura", async () => {
    const raw = "Crie um sistema de reservas para uma pousada.";
    await invoke([raw, "--model", "global-model", "--writer-model", "writer-model"]);
    expect(process.exitCode).toBe(0);
    const published = await readFile(join(projectRoot, "prompt-engineered.md"), "utf8");
    expect(published).toContain(GENERATED_PROMPT.objective);
    expect(published).toContain(GENERATED_PROMPT.acceptanceCriteria[0]);
    expect(published).toMatch(/ponytail/i);
    expect(output).toContain(published.trim());
    expect(output).toContain("prompt-engineered.md");
    expect(output).toMatch(/capivara init .*--file/);
    const invocations = await calls();
    expect(invocations.map((call) => call.stage)).toEqual(["interview", "authoring"]);
    expect(invocations.every((call) => call.role === "writer" && call.permission === "read-only" && call.model === "writer-model")).toBe(true);
    expect(invocations[0]?.prompt).toContain(raw);
    await expect(access(join(projectRoot, ".capivara", "init"))).rejects.toThrow();
    await expect(access(join(projectRoot, ".git"))).rejects.toThrow();
  });

  it.each(["--file", "@"])("lê %s relativo ao projeto e salva em --saida para outra execução", async (source) => {
    const raw = "Pedido de arquivo: organizar reservas sem sobreposição.";
    await writeFile(join(projectRoot, "pedido.md"), raw, "utf8");
    const args = source === "--file" ? ["--file", "pedido.md"] : ["@pedido.md"];
    await invoke([...args, "--saida", "prompts/pronto.md"]);
    expect(process.exitCode).toBe(0);
    expect((await calls())[0]?.prompt).toContain(raw);
    const published = await readFile(join(projectRoot, "prompts", "pronto.md"), "utf8");
    const reused = await resolveRequest(projectRoot, { file: "prompts/pronto.md" });
    expect(reused).toMatchObject({ origin: "file", path: "prompts/pronto.md", text: published.trim() });
    expect(await readFile(join(projectRoot, "pedido.md"), "utf8")).toBe(raw);
    expect(output).toContain("prompts/pronto.md");
  });

  it("aceita o idioma português explicitamente", async () => {
    await fixture({ language: "pt" });
    await invoke(["Organizar um pedido de reservas.", "--language", "pt"]);
    expect(process.exitCode).toBe(0);
    const published = await readFile(join(projectRoot, "prompt-engineered.md"), "utf8");
    expect(published).toMatch(/Objetivo|Contexto/);
  });

  it("preserva o prompt cru quando --saida aponta para o próprio arquivo de entrada", async () => {
    const raw = "Este pedido original precisa continuar disponível.";
    await writeFile(join(projectRoot, "pedido.md"), raw, "utf8");
    await invoke(["--file", "pedido.md", "--saida", "pedido.md"]);
    expect(process.exitCode).toBe(2);
    expect(output).toContain("--saida");
    expect(await readFile(join(projectRoot, "pedido.md"), "utf8")).toBe(raw);
    expect(await calls()).toEqual([]);
  });

  it("diagnostica pedido ausente sem chamar modelo ou publicar arquivo", async () => {
    await invoke([]);
    expect(process.exitCode).toBe(2);
    expect(output).toContain("--file");
    expect(await calls()).toEqual([]);
    await expect(access(join(projectRoot, "prompt-engineered.md"))).rejects.toThrow();
  });

  it("diagnostica escritor ausente sem exigir outros papéis", async () => {
    await invoke(["Um sistema de reservas."], false);
    expect(process.exitCode).toBe(2);
    expect(output).toContain("--writer-provider");
    expect(output).toContain("não tem provider para: writer");
    expect(await calls()).toEqual([]);
    await expect(access(join(projectRoot, "prompt-engineered.md"))).rejects.toThrow();
  });

  it("consome respostas que chegaram por pipe antes da primeira pergunta", async () => {
    await fixture({ question: true });
    terminal.lines = "1\n";
    await invoke(["Um sistema de reservas."]);
    expect(process.exitCode).toBe(0);
    const invocations = await calls();
    expect(invocations.map((call) => call.stage)).toEqual(["interview", "interview", "authoring"]);
    expect(invocations.at(-1)?.prompt).toContain("Recepcionistas");
    expect(output).toContain("Quem é o público inicial?");
  });

  it("o wizard entrega ao engenheiro as respostas restantes do mesmo pipe", async () => {
    await fixture({ question: true });
    vi.stubEnv("CAPIVARA_CODEX_BIN", adapter);
    terminal.lines = [
      projectRoot, "6", "1", "Um sistema de reservas.", ".", "", // pasta, opção, origem, pedido e destino
      "1", "", "1", "n", "s", // codex, modelo padrão, effort desligado e executar
      "1", // a resposta pertence à entrevista, depois de o wizard terminar
      "",
    ].join("\n");
    await createProgram().parseAsync(["wizard"], { from: "user" });
    expect(process.exitCode).toBe(0);
    expect(terminal.opened).toBe(1);
    expect(output).toContain("Comando equivalente");
    expect(output).toContain("Quem é o público inicial?");
    expect((await calls()).at(-1)?.prompt).toContain("Recepcionistas");
    expect(await readFile(join(projectRoot, "prompt-engineered.md"), "utf8")).toContain("Receptionists are the initial audience.");
  });

  it("EOF durante a entrevista explica a interrupção e preserva o destino anterior", async () => {
    await fixture({ question: true });
    const destination = join(projectRoot, "prompt-engineered.md");
    await writeFile(destination, "prompt anterior que deve continuar disponível", "utf8");
    await invoke(["Um sistema de reservas."]);
    expect(process.exitCode).toBe(2);
    expect(output).toMatch(/entrada terminou|entrada acabou|fim da entrada/i);
    expect(output).not.toContain("ERR_USE_AFTER_CLOSE");
    expect(await readFile(destination, "utf8")).toBe("prompt anterior que deve continuar disponível");
    expect((await calls()).map((call) => call.stage)).toEqual(["interview"]);
  });

  it("falha do escritor na organização preserva o prompt anterior e informa o código", async () => {
    await fixture({ failedStage: "authoring" });
    const destination = join(projectRoot, "prompt-engineered.md");
    const previous = "Prompt aprovado anteriormente, que não deve ser substituído por uma falha.";
    await writeFile(destination, previous, "utf8");
    await invoke(["Um sistema de reservas."]);
    expect(process.exitCode).toBe(2);
    expect(output).toMatch(/falhou.*authoring.*7/i);
    expect(await readFile(destination, "utf8")).toBe(previous);
    expect((await calls()).map((call) => call.stage)).toEqual(["interview", "authoring"]);
  });

  it("lê projeto e documentos do MCP configurado, autenticando apenas as leituras", async () => {
    const mcp = await startMcp();
    await invoke(["--mcp-project", "pousada"]);
    expect(process.exitCode).toBe(0);
    const invocations = await calls();
    expect(invocations[0]?.prompt).toContain("Reservas recebidas da biblioteca MCP.");
    expect(invocations[0]?.prompt).toContain("Não permitir duas reservas no mesmo quarto e período.");
    expect(mcp.requests.length).toBeGreaterThan(0);
    expect(mcp.requests.every((request) => request.authorization === `Bearer ${mcp.token}`)).toBe(true);
    expect(mcp.requests.some((request) => request.method === "resources/read" && request.params.uri === "capivara://pousada/docs/memoria/ocupacao")).toBe(true);
    expect(mcp.requests.some((request) => request.method === "tools/call")).toBe(false);
    expect(output).not.toContain(mcp.token);
  });

  it("aceita um prompt do MCP por nome e endpoint explícito", async () => {
    const mcp = await startMcp();
    await invoke(["--mcp", mcp.url, "--prompt", "reservas"]);
    expect(process.exitCode).toBe(0);
    expect((await calls())[0]?.prompt).toContain("Prompt cru recebido por prompts/get.");
    expect(mcp.requests.some((request) => request.method === "prompts/get" && request.params.name === "reservas")).toBe(true);
    expect(output).not.toContain(mcp.token);
  });
});
