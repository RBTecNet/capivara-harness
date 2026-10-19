import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureApiCredential, configureApi } from "../../src/commands/api-login.js";
import { readCredentials, saveCredential } from "../../src/provider/credentials.js";
import { DIRECT_CATALOG } from "../../src/provider/registry.js";
import { runWizardDePapeis } from "../../src/commands/wizard.js";
import { CLI_PROVIDERS, DIRECT_PROVIDERS } from "../../src/provider/index.js";
import { rolesFromFlags } from "../../src/commands/options.js";

let directory: string;
let file: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "capivara-api-login-"));
  file = join(directory, "credentials.json");
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response('{"data":{"is_management_key":false,"is_provisioning_key":false}}'));
});
afterEach(async () => { vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); });

describe("configuração de API antes de escolher modelos", () => {
  it("OpenRouter: troca a chave de gerenciamento dentro do wizard antes de listar modelos", async () => {
    const oldKey = "sk-management-apenas-teste";
    const newKey = "sk-inference-apenas-teste";
    await saveCredential({ id: "openrouter", label: "principal", provider: "openrouter", secret: oldKey, default: true, createdAt: "agora" }, file);
    vi.mocked(fetch).mockImplementation(async (_url, options) => new Response(JSON.stringify({ data: { is_management_key: (options?.headers as Record<string, string>).Authorization === `Bearer ${oldKey}` } })));
    const answers = ["1", "1"];
    const written: string[] = [];
    const config = rolesFromFlags({ provider: "openrouter" });
    const listModels = vi.fn(async () => {
      expect((await readCredentials(file))[0]?.secret).toBe(newKey);
      return ["nvidia/modelo:free"];
    });
    const result = await runWizardDePapeis({ cwd: directory, comando: "init", faltando: ["writer"], current: config,
      fileExists: async () => false, directoryExists: async () => true,
      io: { ask: async () => { const next = answers.shift(); if (next === undefined) throw new Error("fim"); return next; }, secret: async () => newKey, write: (text) => void written.push(text) },
      configureApi: (provider, io) => ensureApiCredential(provider, io, { environment: {}, credentialsFile: file }), listModels,
    });
    expect(result?.roles.writer).toEqual({ provider: "openrouter", model: "nvidia/modelo:free" });
    expect(listModels).toHaveBeenCalledExactlyOnceWith("openrouter");
    expect(written.join("")).toContain("substituir chave de API");
    expect(written.join("")).not.toContain(oldKey);
    expect(written.join("")).not.toContain(newKey);
  });

  it("OpenRouter: cancelar substituição preserva a chave salva e não pede segredo", async () => {
    await saveCredential({ id: "openrouter", label: "principal", provider: "openrouter", secret: "sk-management-teste", default: true, createdAt: "agora" }, file);
    const before = await readFile(file, "utf8");
    vi.mocked(fetch).mockResolvedValue(new Response('{"data":{"is_management_key":true}}'));
    const io = { ask: async () => "2", secret: vi.fn(), write: vi.fn() };
    expect(await ensureApiCredential("openrouter", io, { environment: {}, credentialsFile: file })).toBe(false);
    expect(io.secret).not.toHaveBeenCalled();
    expect(await readFile(file, "utf8")).toBe(before);
  });

  it("OpenRouter: não salva chave de gerenciamento recém-digitada", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{"data":{"is_provisioning_key":true}}'));
    const io = { ask: async () => "1", secret: vi.fn(async () => {
      if (io.secret.mock.calls.length > 1) throw new Error("campo reaberto automaticamente");
      return "sk-management-teste";
    }), write: vi.fn() };
    expect(await ensureApiCredential("openrouter", io, { environment: {}, credentialsFile: file })).toBe(false);
    expect(io.secret).toHaveBeenCalledOnce();
    expect(await readCredentials(file)).toEqual([]);
  });

  it("OpenRouter: reenviar a chave salva recusada oferece saída sem consultar ou pedir a chave de novo", async () => {
    const key = "sk-management-teste";
    await saveCredential({ id: "openrouter", label: "principal", provider: "openrouter", secret: key, default: true, createdAt: "agora" }, file);
    const before = await readFile(file, "utf8");
    vi.mocked(fetch).mockImplementation(async () => new Response('{"data":{"is_management_key":true}}'));
    const answers = ["1", ""];
    const io = {
      ask: vi.fn(async () => { const next = answers.shift(); if (next === undefined) throw new Error("repetição inesperada"); return next; }),
      secret: vi.fn(async () => { if (io.secret.mock.calls.length > 1) throw new Error("campo reaberto automaticamente"); return key; }),
      write: vi.fn(),
    };
    expect(await ensureApiCredential("openrouter", io, { environment: {}, credentialsFile: file })).toBe(false);
    expect(fetch).toHaveBeenCalledOnce();
    expect(io.secret).toHaveBeenCalledOnce();
    expect(io.ask.mock.calls).toHaveLength(2);
    const output = io.write.mock.calls.map((call) => call[0]).join("");
    expect(output).toContain("chave já foi recusada");
    expect(output).toContain("digitar outra chave");
    expect(output).not.toContain(key);
    expect(await readFile(file, "utf8")).toBe(before);
  });

  it("OpenRouter: só reabre a entrada oculta depois da escolha explícita e avança com chave válida", async () => {
    const rejected = "sk-management-teste";
    const valid = "sk-inference-teste";
    vi.mocked(fetch).mockImplementation(async (_url, options) => new Response(JSON.stringify({ data: { is_management_key: (options?.headers as Record<string, string>).Authorization === `Bearer ${rejected}` } })));
    let retryAllowed = false;
    const io = {
      ask: vi.fn(),
      select: vi.fn(async (title: string, choices: readonly { label: string }[], defaultIndex: number) => {
        expect(title).toContain("Chave recusada");
        expect(choices[defaultIndex]?.label).toBe("voltar ao provider");
        retryAllowed = true;
        return choices.findIndex((choice) => choice.label === "digitar outra chave");
      }),
      secret: vi.fn(async () => {
        if (io.secret.mock.calls.length === 1) return rejected;
        expect(retryAllowed).toBe(true);
        return valid;
      }),
      write: vi.fn(),
    };
    expect(await ensureApiCredential("openrouter", io, { environment: {}, credentialsFile: file, force: true })).toBe(true);
    expect(io.select).toHaveBeenCalledOnce();
    expect(io.secret).toHaveBeenCalledTimes(2);
    expect((await readCredentials(file))[0]?.secret).toBe(valid);
  });

  it("OpenRouter: recuperação com cursor preserva a chave anterior ao voltar", async () => {
    const savedKey = "sk-generation-antiga";
    await saveCredential({ id: "openrouter", label: "principal", provider: "openrouter", secret: savedKey, default: true, createdAt: "agora" }, file);
    const before = await readFile(file, "utf8");
    vi.mocked(fetch).mockImplementation(async () => new Response('{"data":{"is_management_key":true}}'));
    const io = { ask: vi.fn(), secret: vi.fn(async () => {
      if (io.secret.mock.calls.length > 1) throw new Error("campo reaberto automaticamente");
      return "sk-management-nova";
    }), select: vi.fn(async () => 0), write: vi.fn() };
    expect(await ensureApiCredential("openrouter", io, { environment: {}, credentialsFile: file, force: true })).toBe(false);
    expect(io.secret).toHaveBeenCalledOnce();
    expect(io.select).toHaveBeenCalledOnce();
    expect(await readFile(file, "utf8")).toBe(before);
  });

  it("caracteres inválidos também oferecem saída sem reabrir o campo automaticamente", async () => {
    const io = { ask: vi.fn(async () => ""), secret: vi.fn(async () => {
      if (io.secret.mock.calls.length > 1) throw new Error("campo reaberto automaticamente");
      return "sk com espaços";
    }), write: vi.fn() };
    expect(await ensureApiCredential("deepseek", io, { environment: {}, credentialsFile: file, force: true })).toBe(false);
    expect(io.secret).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    expect(await readCredentials(file)).toEqual([]);
  });

  it("OpenRouter: indisponibilidade permite repetir a consulta sem substituir a chave", async () => {
    await saveCredential({ id: "openrouter", label: "principal", provider: "openrouter", secret: "sk-valida-teste", default: true, createdAt: "agora" }, file);
    const before = await readFile(file, "utf8");
    vi.mocked(fetch).mockResolvedValueOnce(new Response("", { status: 500 }));
    const io = { ask: vi.fn(async () => "1"), secret: vi.fn(), write: vi.fn() };
    expect(await ensureApiCredential("openrouter", io, { environment: {}, credentialsFile: file })).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(io.secret).not.toHaveBeenCalled();
    expect(await readFile(file, "utf8")).toBe(before);
  });

  it("MiniMax num papel de leitura consulta a listagem e mantém o identificador da API", async () => {
    const current = rolesFromFlags({ provider: "minimax" });
    const io = { ask: vi.fn(async () => "2"), write: vi.fn() };
    const listModels = vi.fn(async () => ["MiniMax-M3", "MiniMax-M2.7"]);
    const result = await runWizardDePapeis({ cwd: directory, comando: "init", faltando: ["writer"], current, io,
      fileExists: async () => false, directoryExists: async () => true, configureApi: async () => true, listModels,
    });
    expect(result?.roles.writer).toEqual({ provider: "minimax", model: "MiniMax-M2.7" });
    expect(listModels).toHaveBeenCalledExactlyOnceWith("minimax");
    expect(io.write.mock.calls.map((call) => call[0]).join("")).toContain("MiniMax-M3");
  });

  it("API escolhida no build cadastra a chave antes de consultar o OpenCode", async () => {
    const answers = ["10", "1", "1", "1", "n"];
    const output: string[] = [];
    const secret = "sk-build-chave-apenas-de-teste";
    const listModels = vi.fn(async (_provider: string) => {
      expect((await readCredentials(file))[0]?.secret).toBe(secret);
      return ["deepseek/deepseek-flash", "opencode/outro"];
    });
    const result = await runWizardDePapeis({
      cwd: directory, comando: "build", faltando: ["builder", "verifier"], fileExists: async () => false, directoryExists: async () => true,
      io: { ask: async () => { const next = answers.shift(); if (next === undefined) throw new Error("fim"); return next; }, secret: async () => secret, write: (s) => void output.push(s) },
      configureApi: (provider, io) => ensureApiCredential(provider, io, { environment: {}, credentialsFile: file }),
      listModels,
    });
    expect(listModels.mock.calls).toEqual([["opencode"]]);
    expect(result?.global).toEqual({ provider: "opencode", model: "deepseek/deepseek-flash" });
    expect(output.join("")).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("comando com provider de API já escolhido pede só o modelo e mantém os papéis configurados", async () => {
    const current = rolesFromFlags({ provider: "deepseek", effort: "high", auditorModel: "modelo-fixo" });
    const io = { ask: vi.fn(async () => "2"), write: vi.fn() };
    const listModels = vi.fn(async (_provider: string) => ["modelo-1", "modelo-2"]);
    const result = await runWizardDePapeis({
      cwd: directory, comando: "init", faltando: ["writer", "verifier"], current,
      fileExists: async () => false, directoryExists: async () => true, io,
      configureApi: async () => true, listModels,
    });
    expect(result).toEqual({ global: {}, roles: { writer: { provider: "deepseek", model: "modelo-2" }, verifier: { provider: "deepseek", model: "modelo-2" } } });
    expect(listModels.mock.calls).toEqual([["deepseek"]]);
    expect(io.ask).toHaveBeenCalledOnce();
    expect(io.write.mock.calls.map((c) => c[0]).join("")).not.toContain("Qual provider usar");
    expect(current.auditor.model).toBe("modelo-fixo");
    expect(current.writer.effort).toBe("high");
  });
  it.each(DIRECT_CATALOG.map((p) => p.id))("%s sem chave oferece cadastro e salva sem expor o valor", async (provider) => {
    const written: string[] = [];
    const io = { ask: vi.fn(async () => "1"), secret: vi.fn(async () => "sk-chave-apenas-de-teste"), write: (s: string) => void written.push(s) };
    expect(await ensureApiCredential(provider, io, { environment: {}, credentialsFile: file })).toBe(true);
    expect(io.secret).toHaveBeenCalledOnce();
    expect((await readCredentials(file))[0]).toMatchObject({ provider, default: true, secret: "sk-chave-apenas-de-teste" });
    expect(written.join("")).not.toContain("sk-chave");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    await ensureApiCredential(provider, io, { environment: {}, credentialsFile: file });
    expect(io.secret).toHaveBeenCalledOnce();
  });

  it("usa chave de ambiente sem pedir cadastro nem persistir", async () => {
    const io = { ask: vi.fn(), secret: vi.fn(), write: vi.fn() };
    expect(await ensureApiCredential("deepseek", io, { environment: { DEEPSEEK_API_KEY: "sk-env-teste" }, credentialsFile: file })).toBe(true);
    expect(io.ask).not.toHaveBeenCalled();
    expect(io.secret).not.toHaveBeenCalled();
    expect(await readCredentials(file)).toEqual([]);
  });

  it("voltar ou chave vazia não salva nada", async () => {
    const io = { ask: async () => "2", secret: vi.fn(async () => ""), write: vi.fn() };
    expect(await ensureApiCredential("deepseek", io, { environment: {}, credentialsFile: file })).toBe(false);
    expect(io.secret).not.toHaveBeenCalled();
    expect(await ensureApiCredential("deepseek", { ...io, ask: async () => "1" }, { environment: {}, credentialsFile: file })).toBe(false);
    expect(await readCredentials(file)).toEqual([]);
  });

  it("renovar uma chave preserva o id e a seleção por label", async () => {
    const io = { ask: async () => "1", secret: async () => "sk-primeira-teste", write: vi.fn() };
    await ensureApiCredential("deepseek", io, { environment: {}, credentialsFile: file });
    const original = (await readCredentials(file))[0]!;
    await ensureApiCredential("deepseek", { ...io, secret: async () => "sk-renovada-teste" }, { environment: {}, credentialsFile: file, force: true });
    expect(await readCredentials(file)).toEqual([{ ...original, secret: "sk-renovada-teste" }]);
  });

  it("sem chave, voltar ao provider não consulta uma lista vazia nem pede modelo", async () => {
    const providers = [...CLI_PROVIDERS, ...DIRECT_PROVIDERS];
    const answers = [String(providers.indexOf("deepseek") + 1), "2", "1", "", "1", "n"];
    const listModels = vi.fn(async (_provider: string): Promise<string[]> => []);
    const result = await runWizardDePapeis({
      cwd: directory, comando: "init", faltando: ["writer"], fileExists: async () => false, directoryExists: async () => true,
      io: { ask: async () => { const next = answers.shift(); if (next === undefined) throw new Error("fim"); return next; }, secret: vi.fn(), write: vi.fn() },
      configureApi: (provider, io) => ensureApiCredential(provider, io, { environment: {}, credentialsFile: file }), listModels,
    });
    expect(result?.global.provider).toBe("codex");
    expect(listModels.mock.calls.map((c) => c[0])).toEqual(["codex"]);
    expect(await readCredentials(file)).toEqual([]);
  });

  it("lista indisponível exige modelo explícito e aceita voltar", async () => {
    const providers = [...CLI_PROVIDERS, ...DIRECT_PROVIDERS];
    const answers = [String(providers.indexOf("deepseek") + 1), "", "deepseek-exato", "1", "n"];
    const written: string[] = [];
    const result = await runWizardDePapeis({
      cwd: directory, comando: "init", faltando: ["writer"], fileExists: async () => false, directoryExists: async () => true,
      io: { ask: async () => { const next = answers.shift(); if (next === undefined) throw new Error("fim"); return next; }, write: (s) => void written.push(s) },
      configureApi: async () => true, listModels: async () => [],
    });
    expect(result?.global.model).toBe("deepseek-exato");
    expect(written.join("")).toContain("Informe um modelo explícito para este provider");
  });

  it("o atalho salva a chave vinda de pipe e nunca a imprime", async () => {
    let output = "";
    await configureApi("deepseek", {
      input: Readable.from(["sk-pipe-teste-12345\n"]), output: new Writable({ write(chunk, _encoding, done) { output += chunk; done(); } }),
      environment: {}, credentialsFile: file,
    });
    expect(output).not.toContain("sk-pipe");
    expect((await readCredentials(file))[0]?.secret).toBe("sk-pipe-teste-12345");
  });

  it("o wizard curto configura a API antes de listar os modelos e não põe a chave no comando", async () => {
    const providers = [...CLI_PROVIDERS, ...DIRECT_PROVIDERS];
    const answers = [String(providers.indexOf("deepseek") + 1), "1", "1", "1", "n"];
    const output: string[] = [];
    const secret = "sk-wizard-teste-12345";
    const result = await runWizardDePapeis({
      cwd: directory, comando: "init", faltando: ["writer"], fileExists: async () => false, directoryExists: async () => true,
      io: { ask: async () => { const next = answers.shift(); if (next === undefined) throw new Error("fim"); return next; }, secret: async () => secret, write: (s) => void output.push(s) },
      configureApi: (provider, io) => ensureApiCredential(provider, io, { environment: {}, credentialsFile: file }),
      listModels: async () => {
        expect((await readCredentials(file))[0]?.secret).toBe(secret);
        return ["deepseek-modelo-teste"];
      },
    });
    expect(result?.global).toMatchObject({ provider: "deepseek", model: "deepseek-modelo-teste" });
    expect(output.join("")).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(await readFile(file, "utf8")).toContain(secret);
  });
});
