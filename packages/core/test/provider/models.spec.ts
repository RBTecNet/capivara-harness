/**
 * A listagem de modelos, que existe para o wizard poder numerar em vez de exigir
 * que a pessoa saiba o identificador de cor.
 *
 * A regra que estes testes protegem é a de degradação: nada aqui pode derrubar
 * quem chamou. CLI ausente, desatualizada ou com formato novo devolve lista
 * vazia, e o wizard volta a pedir o nome digitado — que é o que ele fazia antes
 * de existir listagem.
 */

import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveCredential } from "../../src/provider/credentials.js";
import { DIRECT_CATALOG } from "../../src/provider/registry.js";
import { CLAUDE_FAMILIES, MODEL_LISTINGS, cliDisponivel, listarEfforts, listarModelos } from "../../src/provider/index.js";

let directory: string | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("modelos por API", () => {
  it.each(DIRECT_CATALOG)("$id: consulta a API com a chave no header e lê data[].id", async (provider) => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "modelo-1" }, { id: "modelo-1" }, { id: "modelo-2" }, {}, { id: "nome com espaços" }] })));
    const key = "sk-api-key-apenas-teste";
    const models = await listarModelos(provider.id, { [provider.envKey]: key, CAPIVARA_CONFIG_DIR: "/caminho/sem/credenciais" });
    expect(models).toEqual(["modelo-1", "modelo-2"]);
    const [url, request] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(provider.modelsEndpoint ?? provider.endpoint.replace(/(?:chat\/completions|messages)$/, "models"));
    expect(String(url)).not.toContain(key);
    expect(request?.headers).toMatchObject(provider.id === "anthropic" ? { "x-api-key": key, "anthropic-version": "2023-06-01" } : { Authorization: `Bearer ${key}` });
    expect(request?.redirect).toBe("error");
  });

  it.each(["deepseek", "minimax"])("%s usa a chave recém-salva no mesmo store do wizard", async (provider) => {
    directory = await mkdtemp(join(tmpdir(), "capivara-models-api-"));
    const file = join(directory, "credentials.json");
    await saveCredential({ id: "teste", label: "teste", provider, secret: "sk-salva-teste", default: true, createdAt: "agora" }, file);
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"data":[{"id":"modelo-teste"}]}'));
    expect(await listarModelos(provider, { CAPIVARA_CONFIG_DIR: directory })).toEqual(["modelo-teste"]);
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: "Bearer sk-salva-teste" });
  });

  it.each([401, 429, 500])("HTTP %s degrada para nome manual sem expor a resposta", async (status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("corpo com informação privada", { status }));
    const messages: string[] = [];
    expect(await listarModelos("deepseek", { DEEPSEEK_API_KEY: "sk-fake-test", CAPIVARA_CONFIG_DIR: "/ausente" }, undefined, (message) => messages.push(message))).toEqual([]);
    expect(messages.join("")).toContain(`HTTP ${status}`);
    expect(messages.join("")).not.toContain("corpo com informação privada");
    expect(messages.join("")).not.toContain("sk-fake-test");
  });

  it.each(["TimeoutError", "TypeError"])("diagnostica %s sem expor texto da exceção", async (name) => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(Object.assign(new Error("sk-chave-que-nao-pode-aparecer"), { name }));
    const messages: string[] = [];
    expect(await listarModelos("deepseek", { DEEPSEEK_API_KEY: "sk-fake-test", CAPIVARA_CONFIG_DIR: "/ausente" }, undefined, (message) => messages.push(message))).toEqual([]);
    expect(messages.join("")).toContain(name === "TimeoutError" ? "esgotou" : "verifique a conexão");
    expect(messages.join("")).not.toContain("sk-chave");
  });

  it("sem credencial não faz requisição de listagem", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    expect(await listarModelos("deepseek", { CAPIVARA_CONFIG_DIR: "/ausente" })).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

async function fakeCli(name: string, output: string): Promise<string> {
  directory = await mkdtemp(join(tmpdir(), "capivara-models-"));
  const binary = join(directory, name);
  await writeFile(binary, `#!${process.execPath}\nif (process.env.CAPIVARA_MODEL_TEST !== "presente") process.exit(2);\nprocess.stdout.write(${JSON.stringify(output)});\n`);
  await chmod(binary, 0o755);
  return binary;
}

describe("cada CLI separa identificador de descrição do seu jeito", () => {
  it("cursor: hífen cercado de espaço, e o cabeçalho não vira modelo", () => {
    const saida = ["Available models", "", "auto - Auto (default)", "gpt-5.3-codex-low - Codex 5.3 Low"].join("\n");
    expect(MODEL_LISTINGS.cursor?.parse(saida)).toEqual(["auto", "gpt-5.3-codex-low"]);
  });

  it("cursor: cores ANSI não fazem os modelos desaparecerem", () => {
    const saida = "\u001b[2mAvailable models\u001b[22m\n\n\u001b[32mauto\u001b[39m \u001b[2m- Auto\u001b[22m\n\u001b[36mgpt-5.3-codex-low\u001b[39m \u001b[2m- Codex 5.3 Low\u001b[22m\n";
    expect(MODEL_LISTINGS.cursor?.parse(saida)).toEqual(["auto", "gpt-5.3-codex-low"]);
  });

  it("agy: tabulação, e a linha de progresso não vira modelo", () => {
    const saida = ["Fetching available models...", "gemini-3.8-flash-high\tGemini 3.8 Flash (High)"].join("\n");
    expect(MODEL_LISTINGS.agy?.parse(saida)).toEqual(["gemini-3.8-flash-high"]);
  });

  it("opencode: só o identificador, um por linha", () => {
    expect(MODEL_LISTINGS.opencode?.parse("opencode/big-pickle\nopencode-go/glm-5.2")).toEqual([
      "opencode/big-pickle",
      "opencode-go/glm-5.2",
    ]);
  });

  it("opencode: preserva versões com dois-pontos e ignora avisos e cabeçalhos", () => {
    const saida = "Available models\nFetching available models...\n\u001b[36mollama/qwen3:8b\u001b[0m\r\nopencode/big-pickle\n";
    expect(MODEL_LISTINGS.opencode?.parse(saida)).toEqual(["ollama/qwen3:8b", "opencode/big-pickle"]);
  });

  it("codex: JSON, todos os modelos — primeiro os que o seletor dele mostra, depois os outros, com a dica", () => {
    const saida = JSON.stringify({
      models: [
        { slug: "gpt-experimental", visibility: "hidden" },
        { slug: "gpt-6-astra", visibility: "list" },
      ],
    });
    expect(MODEL_LISTINGS.codex?.parse(saida)).toEqual(["gpt-6-astra", "gpt-experimental"]);
    expect(MODEL_LISTINGS.codex?.dicas?.(saida)).toEqual({ "gpt-experimental": "o codex o esconde da própria lista" });
  });

  it("codex: a saída real de `codex debug models` (codex-cli 0.163.0) produz a lista completa, na ordem, e os efforts de cada um", async () => {
    const saida = await readFile(join(import.meta.dirname, "../fixtures/models/codex-debug-models.json"), "utf8");
    expect(MODEL_LISTINGS.codex?.parse(saida)).toEqual([
      "gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna",
      "gpt-6-chat-thinking", "gpt-reserve", "codex-auto-review",
    ]);
    expect(Object.keys(MODEL_LISTINGS.codex?.dicas?.(saida) ?? {})).toEqual(["gpt-6-chat-thinking", "gpt-reserve", "codex-auto-review"]);
    const efforts = MODEL_LISTINGS.codex?.efforts?.(saida) ?? {};
    expect(Object.keys(efforts)).toHaveLength(10);
    expect(efforts["gpt-reserve"]).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(efforts["gpt-6.1-sol"]).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);
  });

  it("claude: as famílias, porque a CLI resolve a versão sozinha", () => {
    expect(MODEL_LISTINGS.claude?.parse("")).toEqual(CLAUDE_FAMILIES);
    expect(CLAUDE_FAMILIES).toContain("opus");
    expect(CLAUDE_FAMILIES).toContain("haiku");
  });
});

describe.skipIf(process.platform === "win32")("o ambiente usado para consultar a CLI", () => {
  it.each(["opencode", "cursor"])("%s: procura o binário no PATH recebido", async (provider) => {
    const name = `capivara-test-${provider}`;
    const output = provider === "opencode" ? "opencode/big-pickle\n" : "auto - Auto (default)\n";
    const binary = await fakeCli(name, output);
    const env = {
      ...process.env,
      PATH: `${dirname(binary)}${delimiter}${process.env.PATH ?? ""}`,
      [`CAPIVARA_${provider.toUpperCase()}_BIN`]: name,
      CAPIVARA_MODEL_TEST: "presente",
    };
    expect(await cliDisponivel(provider, env)).toBe(true);
    expect(await listarModelos(provider, env)).toEqual([provider === "opencode" ? "opencode/big-pickle" : "auto"]);
  });

  it.each(["opencode", "cursor"])("%s: repassa o ambiente ao binário configurado por caminho absoluto", async (provider) => {
    const output = provider === "opencode" ? "opencode/big-pickle\n" : "auto - Auto (default)\n";
    const binary = await fakeCli(`capivara-test-${provider}`, output);
    const env = {
      ...process.env,
      [`CAPIVARA_${provider.toUpperCase()}_BIN`]: binary,
      CAPIVARA_MODEL_TEST: "presente",
    };
    expect(await listarModelos(provider, env)).toEqual([provider === "opencode" ? "opencode/big-pickle" : "auto"]);
  });

  it("a consulta de níveis usa o mesmo ambiente da consulta de modelos", async () => {
    const binary = await fakeCli("capivara-test-codex", JSON.stringify({
      models: [{ slug: "modelo-teste", supported_reasoning_levels: [{ effort: "high" }] }],
    }));
    expect(await listarEfforts("codex", "modelo-teste", {
      ...process.env,
      CAPIVARA_CODEX_BIN: binary,
      CAPIVARA_MODEL_TEST: "presente",
    })).toEqual(["high"]);
  });
});

describe("falhar aqui nunca derruba quem chamou", () => {
  it("provider que não sabe listar devolve vazio, não erro", async () => {
    expect(await listarModelos("openai")).toEqual([]);
    expect(await listarModelos("provider-que-nao-existe")).toEqual([]);
  });

  /*
   * O wizard lista TODOS os providers, inclusive os que não estão instalados —
   * saber que eles existem é útil. O que não pode é perguntar os modelos a uma
   * CLI ausente e esperar um erro de processo para descobrir o que `which` diria
   * na hora.
   */
  it("CLI ausente devolve vazio: não se pergunta a quem não está instalado", async () => {
    const semBinario = { CAPIVARA_CODEX_BIN: "/caminho/que/nao/existe/codex" } as NodeJS.ProcessEnv;
    expect(await listarModelos("codex", semBinario)).toEqual([]);
  });

  it("saída que não é o formato esperado devolve vazio, não lixo", () => {
    expect(MODEL_LISTINGS.codex?.parse("isto não é JSON")).toEqual([]);
    expect(MODEL_LISTINGS.cursor?.parse("erro: sessão expirada")).toEqual([]);
  });

  it("o claude responde sem precisar da CLI instalada: a lista é fixa", async () => {
    const semBinario = { CAPIVARA_CLAUDE_BIN: "/caminho/que/nao/existe" } as NodeJS.ProcessEnv;
    expect(await listarModelos("claude", semBinario)).toEqual(CLAUDE_FAMILIES);
  });
});

describe("os níveis de raciocínio que o modelo de fato aceita", () => {
  /*
   * O wizard oferecia `minimal` a todo mundo, e nenhum modelo atual do codex o
   * aceita. A chamada morria com `Unsupported value: 'minimal' is not supported
   * with this model`, e o run terminava em "o papel writer falhou com código 1
   * em skeleton" — depois de o desenvolvedor ter feito apenas o que o wizard
   * ofereceu.
   */
  const CODEX_JSON = JSON.stringify({
    models: [
      {
        slug: "gpt-6-astra",
        visibility: "list",
        supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }, { effort: "xhigh" }],
      },
      { slug: "gpt-5.5", visibility: "list", supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }] },
    ],
  });

  it("lê os níveis por modelo, e minimal não está entre eles", () => {
    const mapa = MODEL_LISTINGS.codex?.efforts?.(CODEX_JSON) ?? {};
    expect(mapa["gpt-6-astra"]).toEqual(["low", "medium", "high", "xhigh"]);
    expect(mapa["gpt-6-astra"]).not.toContain("minimal");
  });

  it("modelos diferentes aceitam níveis diferentes", () => {
    const mapa = MODEL_LISTINGS.codex?.efforts?.(CODEX_JSON) ?? {};
    expect(mapa["gpt-5.5"]).toEqual(["low", "medium"]);
    expect(mapa["gpt-5.5"]).not.toContain("xhigh");
  });

  it("saída ilegível devolve mapa vazio, e quem chamou usa a lista genérica", () => {
    expect(MODEL_LISTINGS.codex?.efforts?.("não é JSON")).toEqual({});
  });

  it("CLI que não informa níveis devolve null, distinguindo de modelo sem variantes", async () => {
    const { listarEfforts } = await import("../../src/provider/index.js");
    expect(await listarEfforts("opencode", "qualquer-modelo", { CAPIVARA_OPENCODE_BIN: "/cli-ausente" })).toBeNull();
    expect(await listarEfforts("claude", "opus")).toBeNull();
  });
});

describe.skipIf(process.platform === "win32")("OpenCode com a chave de API salva na Capivara", () => {
  it("a descoberta recebe a chave pelo ambiente e usa o servidor privado; níveis vêm do JSON real da CLI", async () => {
    directory = await mkdtemp(join(tmpdir(), "capivara-opencode-api-models-"));
    const file = join(directory, "credentials.json");
    await saveCredential({ id: "deepseek", label: "principal", provider: "deepseek", secret: "sk-api-teste-opencode", default: true, createdAt: "agora" }, file);
    const binary = join(directory, "opencode.mjs");
    await writeFile(binary, `#!${process.execPath}\nif (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(["api", "model.list", "--standalone"])) process.exit(2);\nconst data = process.env.DEEPSEEK_API_KEY === "sk-api-teste-opencode" ? [
      {id: "deepseek-flash", providerID: "deepseek", variants: [{id:"none"}, {id:"low"}, {id:"high"}, {id:"max"}]},
      {id: "sem-variantes", providerID: "deepseek", variants: []},
      {id: "oculto", providerID: "deepseek", enabled: false, variants: []}
    ] : [];\nconsole.log(JSON.stringify({location: {directory: process.cwd()}, data}));\n`);
    await chmod(binary, 0o755);
    const env = { ...process.env, CAPIVARA_CONFIG_DIR: directory, CAPIVARA_OPENCODE_BIN: binary, DEEPSEEK_API_KEY: "" };
    expect(await listarModelos("opencode", env)).toEqual(["deepseek/deepseek-flash", "deepseek/sem-variantes"]);
    expect(await listarEfforts("opencode", "deepseek/deepseek-flash", env)).toEqual(["none", "low", "high", "max"]);
    expect(await listarEfforts("opencode", "deepseek/sem-variantes", env)).toEqual([]);
    expect(await listarEfforts("opencode", "deepseek/inexistente", env)).toBeNull();
  });
});
