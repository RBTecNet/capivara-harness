/**
 * MiniMax pelas três portas da Capivara (§131): a API direta do INIT e do PLAN,
 * o OpenCode do BUILD, e o wizard que oferece modelo e effort às duas.
 *
 * A CLI falsa reproduz o que o OpenCode 2.0.32 real fez nesta máquina, contra um
 * servidor local (nenhuma chamada paga): o catálogo traz o MiniMax-M3.1-Flash
 * SEM variantes e o MiniMax-M3 com `none` e `thinking`; variantes declaradas na
 * configuração (`OPENCODE_CONFIG_CONTENT`) entram na listagem e na chamada, e
 * levam os `settings` ao corpo da requisição; `#variante` que o modelo não tem
 * morre em "Variant unavailable", código 1, antes de qualquer requisição.
 */

import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentBridge, DEFAULT_LIMITS } from "../../src/commands/agent.js";
import { runWizard } from "../../src/commands/wizard.js";
import { buildInvocation, DIRECT_CATALOG, listarEfforts, runProvider } from "../../src/provider/index.js";
import { saveCredential } from "../../src/provider/credentials.js";
import type { RoleConfig } from "../../src/provider/index.js";

const key = "sk-minimax-apenas-teste";
const limits = { firstOutputSeconds: 0, idleSeconds: 0, wallSeconds: 2, maxOutputBytes: 100000 };
let directory = "";

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), "capivara-minimax-131-")));
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

const OPENCODE = `#!${process.execPath}
const args = process.argv.slice(2);
const config = process.env.OPENCODE_CONFIG_CONTENT ? JSON.parse(process.env.OPENCODE_CONFIG_CONTENT) : {};
const catalogo = {
  "minimax/MiniMax-M3.1-Flash": [],
  "minimax-coding-plan/MiniMax-M3.1-Flash": [],
  "minimax-cn/MiniMax-M3.1-Flash": [],
  "minimax/MiniMax-M3": [{ id: "none", settings: { thinking: { type: "disabled" } } }, { id: "thinking", settings: { thinking: { type: "adaptive" } } }],
  "deepseek/deepseek-flash": [{ id: "high", settings: { reasoningEffort: "high" } }],
};
const variantes = (modelo) => {
  const [provider, ...resto] = modelo.split("/");
  const daConfig = config.provider?.[provider]?.models?.[resto.join("/")]?.variants ?? {};
  const todas = new Map((catalogo[modelo] ?? []).map((v) => [v.id, v.settings]));
  for (const [id, settings] of Object.entries(daConfig)) todas.set(id, settings);
  return [...todas].map(([id, settings]) => ({ id, settings }));
};
if (args[0] === "api") {
  console.log(JSON.stringify({ data: Object.keys(catalogo).map((modelo) => ({ id: modelo.split("/").slice(1).join("/"), providerID: modelo.split("/")[0], variants: variantes(modelo) })) }));
  process.exit(0);
}
for await (const c of process.stdin) void c;
const pedido = args[args.indexOf("--model") + 1];
const [modelo, variante] = pedido.split("#");
const escolhida = variante === undefined ? { settings: {} } : variantes(modelo).find((v) => v.id === variante);
if (!escolhida) {
  console.log(JSON.stringify({ type: "error", error: { type: "provider.no-route", message: "Variant unavailable for " + modelo + ": " + variante } }));
  process.exit(1);
}
console.log(JSON.stringify({ type: "text", part: { type: "text", text: JSON.stringify({ modelo, corpo: escolhida.settings, minimax: config.provider?.minimax ?? null, provedores: config.provider ?? null, temChave: process.env.MINIMAX_API_KEY === ${JSON.stringify(key)}, permission: config.permission ? "presente" : "ausente", outro: config.outro ?? null }) } }));
`;

async function opencodeFalso(): Promise<string> {
  const binary = join(directory, "opencode.mjs");
  await writeFile(binary, OPENCODE);
  await chmod(binary, 0o755);
  vi.stubEnv("CAPIVARA_OPENCODE_BIN", binary);
  return binary;
}

const direta = (model: string, effort: string) => buildInvocation("writer", { provider: "minimax", model, effort, credential: "", command: "" },
  { projectRoot: process.cwd(), runId: "api-131", language: "pt-BR", stage: "interview", environment: { MINIMAX_API_KEY: key } });
const resposta = () => new Response(JSON.stringify({ choices: [{ message: { content: "PONG" }, finish_reason: "stop" }] }));

describe("API direta do MiniMax (INIT e PLAN)", () => {
  /*
   * O 400 do plan `init-dc741f0d7b92`: "model MiniMax-M3.1-Flash requires
   * adaptive thinking; thinking.type="disabled" (including reasoning.effort=none)
   * is not allowed (2013)". A guarda só conhecia o nome da prévia, com "-Preview".
   */
  it.each(["MiniMax-M3.1-Flash", "MiniMax-M3.1-Flash-Preview"])("%s sem effort não manda desligar o raciocínio: recusa antes do HTTP e diz os efforts aceitos", async (model) => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(resposta());
    const result = await runProvider({ invocation: direta(model, ""), prompt: "Teste", limits });
    expect(fetcher).not.toHaveBeenCalled();
    expect(result).toMatchObject({ exitCode: 1, engineError: true, resultRead: false });
    expect(result.stderr).toContain(`${model} não permite desligar o raciocínio`);
    expect(result.stderr).toContain("low, medium, high, xhigh, max");
    expect(result.stderr).not.toContain(key);
  });

  it.each(["none", "off", "disabled"])("MiniMax-M3.1-Flash com effort %s também é recusado sem requisição", async (effort) => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(resposta());
    expect((await runProvider({ invocation: direta("MiniMax-M3.1-Flash", effort), prompt: "Teste", limits })).exitCode).toBe(1);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["thinking", "minimal", "XHIGH"])("MiniMax-M3.1-Flash com effort %s, fora dos níveis documentados, é recusado sem requisição", async (effort) => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(resposta());
    const result = await runProvider({ invocation: direta("MiniMax-M3.1-Flash", effort), prompt: "Teste", limits });
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`não aceita o effort "${effort}"`);
    expect(result.stderr).toContain("low, medium, high, xhigh, max");
  });

  it("MiniMax-M3 e M2.x, sem níveis documentados, continuam aceitando o effort que já aceitavam", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => resposta());
    expect((await runProvider({ invocation: direta("MiniMax-M3", "high"), prompt: "Teste", limits })).exitCode).toBe(0);
    expect((await runProvider({ invocation: direta("MiniMax-M2.7", "low"), prompt: "Teste", limits })).exitCode).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(["low", "xhigh", "max"])("MiniMax-M3.1-Flash com %s envia raciocínio adaptativo e a intensidade documentada", async (effort) => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(resposta());
    const result = await runProvider({ invocation: direta("MiniMax-M3.1-Flash", effort), prompt: "Teste", limits });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ model: "MiniMax-M3.1-Flash", thinking: { type: "adaptive" }, reasoning_effort: effort, reasoning_split: true });
  });

  it("MiniMax-M3, que desliga, continua desligando sem effort", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(resposta());
    await runProvider({ invocation: direta("MiniMax-M3", ""), prompt: "Teste", limits });
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("MiniMax-M2.x não desliga e não tem intensidade: a recusa orienta thinking", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(resposta());
    const recusa = await runProvider({ invocation: direta("MiniMax-M2.7", ""), prompt: "Teste", limits });
    expect(recusa.stderr).toContain("--effort explicitamente (thinking)");
    expect(fetcher).not.toHaveBeenCalled();
    await runProvider({ invocation: direta("MiniMax-M2.7", "thinking"), prompt: "Teste", limits });
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("efforts por modelo vêm da documentação; o que ela não declara continua sem lista", async () => {
    expect(await listarEfforts("minimax", "MiniMax-M3.1-Flash")).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(await listarEfforts("minimax", "MiniMax-M3")).toEqual(["none", "thinking"]);
    expect(await listarEfforts("minimax", "MiniMax-M2.5-highspeed")).toEqual(["thinking"]);
    expect(await listarEfforts("minimax", "MiniMax-M9")).toBeNull();
    for (const provider of DIRECT_CATALOG.filter((item) => item.id !== "minimax")) expect(await listarEfforts(provider.id, "MiniMax-M3.1-Flash")).toBeNull();
  });
});

describe("MiniMax pelo OpenCode (BUILD)", () => {
  it("a listagem passa a mostrar as intensidades do M3.1-Flash, e o resto do catálogo fica como a CLI declara", async () => {
    await opencodeFalso();
    const env = { ...process.env, CAPIVARA_CONFIG_DIR: directory };
    expect(await listarEfforts("opencode", "minimax/MiniMax-M3.1-Flash", env)).toEqual(["low", "medium", "high", "xhigh", "max"]);
    // A rota do Coding Plan vai ao mesmo endereço documentado; as -cn, não conferidas, ficam como a CLI declara.
    expect(await listarEfforts("opencode", "minimax-coding-plan/MiniMax-M3.1-Flash", env)).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(await listarEfforts("opencode", "minimax-cn/MiniMax-M3.1-Flash", env)).toEqual([]);
    expect(await listarEfforts("opencode", "minimax/MiniMax-M3", env)).toEqual(["none", "thinking"]);
    expect(await listarEfforts("opencode", "deepseek/deepseek-flash", env)).toEqual(["high"]);
  });

  it("sem a CLI respondendo, a listagem ainda dá os níveis que a chamada injeta; configuração ilegível não dá nada", async () => {
    const ausente = { ...process.env, CAPIVARA_CONFIG_DIR: directory, CAPIVARA_OPENCODE_BIN: join(directory, "nao-existe") };
    expect(await listarEfforts("opencode", "minimax/MiniMax-M3.1-Flash", ausente)).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(await listarEfforts("opencode", "minimax/MiniMax-M3", ausente)).toBeNull();
    await opencodeFalso();
    expect(await listarEfforts("opencode", "minimax/MiniMax-M3.1-Flash", { ...process.env, CAPIVARA_CONFIG_DIR: directory, OPENCODE_CONFIG_CONTENT: "{ não é json" })).toBeNull();
  });

  const papel = (model: string, effort: string): RoleConfig => ({ provider: "opencode", model, effort, credential: "", command: "" });
  const ponte = (config: RoleConfig) => createAgentBridge({ projectRoot: directory, runId: "build-131", language: "pt-BR",
    roles: { writer: config, auditor: config, builder: config, verifier: config }, limits: DEFAULT_LIMITS, credentialsFile: join(directory, "credentials.json") });

  it.each(["low", "xhigh"])("o executor com effort %s chega ao modelo com output_config.effort, em vez de Variant unavailable", async (effort) => {
    await opencodeFalso();
    const response = await ponte(papel("minimax/MiniMax-M3.1-Flash", effort))({ role: "builder", stage: "implement", prompt: "Teste." });
    expect(response.exitCode).toBe(0);
    expect(JSON.parse(response.stdout)).toMatchObject({ modelo: "minimax/MiniMax-M3.1-Flash", corpo: { output_config: { effort } }, permission: "presente" });
  });

  it("a chave salva vai pelo ambiente do provider, nunca pela configuração injetada", async () => {
    await opencodeFalso();
    vi.stubEnv("MINIMAX_API_KEY", "");
    await saveCredential({ id: "minimax", label: "principal", provider: "minimax", secret: key, default: true, createdAt: "agora" }, join(directory, "credentials.json"));
    const response = await ponte(papel("minimax/MiniMax-M3.1-Flash", "high"))({ role: "builder", stage: "implement", prompt: "Teste." });
    const lido = JSON.parse(response.stdout);
    expect(lido).toMatchObject({ temChave: true, corpo: { output_config: { effort: "high" } } });
    expect(JSON.stringify(lido.provedores)).not.toContain(key);
  });

  it("o Coding Plan recebe as mesmas variantes; as rotas -cn continuam como a CLI as declara", async () => {
    await opencodeFalso();
    const plano = JSON.parse((await ponte(papel("minimax-coding-plan/MiniMax-M3.1-Flash", "medium"))({ role: "builder", stage: "implement", prompt: "Teste." })).stdout);
    expect(plano).toMatchObject({ corpo: { output_config: { effort: "medium" } } });
    expect(Object.keys(plano.provedores)).toEqual(["minimax-coding-plan"]);
    const cn = await ponte(papel("minimax-cn/MiniMax-M3.1-Flash", "medium"))({ role: "builder", stage: "implement", prompt: "Teste." });
    expect(cn.exitCode).not.toBe(0);
    expect(cn.stdout + cn.stderr).toContain("Variant unavailable");
  });

  it("configuração do OpenCode ilegível recusa antes de qualquer inferência", async () => {
    await opencodeFalso();
    vi.stubEnv("OPENCODE_CONFIG_CONTENT", "{ não é json");
    await expect(ponte(papel("minimax/MiniMax-M3.1-Flash", "low"))({ role: "builder", stage: "implement", prompt: "Teste." })).rejects.toThrow("OPENCODE_CONFIG_CONTENT");
  });

  it("a configuração da pessoa é preservada, e a variante que ela declarou vale sobre a documentada", async () => {
    await opencodeFalso();
    vi.stubEnv("OPENCODE_CONFIG_CONTENT", JSON.stringify({ outro: "intacto", provider: { minimax: { options: { timeout: 1 }, models: { "MiniMax-M3.1-Flash": { variants: { low: { output_config: { effort: "medium" } } } } } } } }));
    const response = await ponte(papel("minimax/MiniMax-M3.1-Flash", "low"))({ role: "builder", stage: "implement", prompt: "Teste." });
    const lido = JSON.parse(response.stdout);
    expect(lido).toMatchObject({ corpo: { output_config: { effort: "medium" } }, outro: "intacto" });
    expect(lido.minimax.options).toEqual({ timeout: 1 });
    expect(Object.keys(lido.minimax.models["MiniMax-M3.1-Flash"].variants)).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it.each([
    { model: "minimax/MiniMax-M3", effort: "thinking", corpo: { thinking: { type: "adaptive" } } },
    { model: "minimax/MiniMax-M3.1-Flash", effort: "", corpo: {} },
    { model: "deepseek/deepseek-flash", effort: "high", corpo: { reasoningEffort: "high" } },
  ])("$model com effort '$effort': o corpo da requisição não ganha intensidade que não foi pedida", async ({ model, effort, corpo }) => {
    await opencodeFalso();
    const response = await ponte(papel(model, effort))({ role: "builder", stage: "implement", prompt: "Teste." });
    const lido = JSON.parse(response.stdout);
    expect(lido.corpo).toEqual(corpo);
    if (model !== "minimax/MiniMax-M3.1-Flash") expect(lido.minimax).toBeNull();
  });

  it("variante que o modelo não tem continua recusada pela CLI, sem o Core inventar outra", async () => {
    await opencodeFalso();
    const response = await ponte(papel("minimax/MiniMax-M3.1-Flash", "none"))({ role: "builder", stage: "implement", prompt: "Teste." });
    expect(response.exitCode).not.toBe(0);
    expect(response.stdout + response.stderr).toContain("Variant unavailable");
  });
});

describe("o wizard oferece o mesmo MiniMax no INIT, no PLAN e no BUILD", () => {
  function roteiro(respostas: string[]) {
    const escrito: string[] = [];
    let posicao = 0;
    return {
      tela: () => escrito.join(""),
      deps: {
        io: { ask: async () => respostas[posicao++] ?? "", write: (text: string) => void escrito.push(text) },
        cwd: "/projeto",
        fileExists: async (path: string) => path.endsWith("pedido.md"),
        directoryExists: async () => true,
        configureApi: async () => true,
        listModels: async (provider: string) => provider === "minimax" ? ["MiniMax-M3.1-Flash", "MiniMax-M3", "MiniMax-M2.7"] : ["minimax/MiniMax-M3.1-Flash", "minimax/MiniMax-M3", "deepseek/deepseek-flash"],
        // A listagem real: documentação para a API direta, a CLI (falsa) para o OpenCode.
        listEfforts: (provider: string, model: string) => listarEfforts(provider, model, { ...process.env, CAPIVARA_CONFIG_DIR: directory }),
      },
    };
  }
  /** O bloco de opções da pergunta de intensidade, como a tela mostrou. */
  const opcoesDoEffort = (tela: string): string => tela.split("Intensidade de raciocínio?")[1]?.split("Escolha")[0] ?? "";

  it.each([
    { estagio: "init", inicio: ["", "1", "1", "uma agenda", "."] },
    { estagio: "plan", inicio: ["", "2", "pedido.md"] },
  ])("$estagio com MiniMax-M3.1-Flash direto: só os níveis aceitos, sem 'desligado', e o padrão é o mais econômico", async ({ estagio, inicio }) => {
    await opencodeFalso();
    const { deps, tela } = roteiro([...inicio, "11", "1", "", "n", "n"]);
    const result = await runWizard({ ...deps, requestRecorded: async () => false });
    expect(result?.argv).toEqual(expect.arrayContaining([estagio, "--provider", "minimax", "--model", "MiniMax-M3.1-Flash", "--effort", "low"]));
    const opcoes = opcoesDoEffort(tela());
    expect(opcoes).toContain("1) low");
    expect(opcoes).toContain("5) max");
    expect(opcoes).not.toContain("desligado");
  });

  it("init com MiniMax-M3 direto oferece desligar e ligar, e não intensidades que o modelo não tem", async () => {
    await opencodeFalso();
    const { deps, tela } = roteiro(["", "1", "1", "uma agenda", ".", "11", "2", "2", "n", "n"]);
    const result = await runWizard(deps);
    expect(result?.argv).toEqual(expect.arrayContaining(["--model", "MiniMax-M3", "--effort", "thinking"]));
    const opcoes = opcoesDoEffort(tela());
    expect(opcoes).toContain("desligado");
    expect(opcoes).not.toMatch(/\b(low|medium|high)\b/);
  });

  it("build com MiniMax-M3.1-Flash via OpenCode oferece os mesmos níveis, e o escolhido vira a variante da chamada", async () => {
    await opencodeFalso();
    // pasta, build, minimax, modelo 1, effort 5 (xhigh: depois do padrão do modelo), sem ajuste, serial, teste, ciclos, reparos, não executar
    const { deps, tela } = roteiro(["", "3", "11", "1", "5", "n", "1", "", "", "", "n"]);
    const result = await runWizard(deps);
    expect(result?.answers.global).toEqual({ provider: "opencode", model: "minimax/MiniMax-M3.1-Flash", effort: "xhigh" });
    const opcoes = opcoesDoEffort(tela());
    expect(opcoes).toContain("padrão do modelo");
    for (const nivel of ["low", "medium", "high", "xhigh", "max"]) expect(opcoes).toContain(nivel);
    expect(opcoes).not.toContain("desligado");
  });

  it("no build, o padrão do modelo diz o que a API usa sem escolha, e continua sendo o padrão da pergunta", async () => {
    await opencodeFalso();
    const { deps, tela } = roteiro(["", "3", "11", "1", "", "n", "1", "", "", "", "n"]);
    const result = await runWizard(deps);
    expect(result?.answers.global).toEqual({ provider: "opencode", model: "minimax/MiniMax-M3.1-Flash" });
    expect(opcoesDoEffort(tela())).toContain("sem escolha, a API usa max");
  });

  it("no build, sem resposta da CLI, os níveis vêm do que a chamada injeta, sem um 'desligado' que seria o max", async () => {
    vi.stubEnv("CAPIVARA_OPENCODE_BIN", join(directory, "nao-existe"));
    const { deps, tela } = roteiro(["", "3", "11", "1", "2", "n", "1", "", "", "", "n"]);
    const result = await runWizard(deps);
    expect(result?.answers.global).toEqual({ provider: "opencode", model: "minimax/MiniMax-M3.1-Flash", effort: "low" });
    expect(opcoesDoEffort(tela())).not.toContain("desligado");
  });
});
