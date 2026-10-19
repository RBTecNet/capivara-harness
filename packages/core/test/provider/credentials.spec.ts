import { mkdtemp, rm, stat } from "node:fs/promises";
import * as files from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mask,
  readCredentials,
  redact,
  removeCredential,
  saveCredential,
  selectCredential,
  toSafe,
} from "../../src/provider/index.js";
import type { CredentialRecord } from "../../src/provider/index.js";
import { withApiCredentials } from "../../src/provider/credentials.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, open: vi.fn(original.open) };
});

let workspace = "";
let file = "";

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "capivara-cred-"));
  file = join(workspace, "credentials.json");
});

afterEach(async () => {
  vi.mocked(files.open).mockReset();
  vi.restoreAllMocks();
  await rm(workspace, { recursive: true, force: true });
});

const record = (overrides: Partial<CredentialRecord> = {}): CredentialRecord => ({
  id: "deepseek-principal",
  label: "DeepSeek pessoal",
  provider: "deepseek",
  secret: "sk-valor-muito-secreto-aqui",
  default: true,
  createdAt: "2026-09-16T00:00:00.000Z",
  ...overrides,
});

describe("armazenamento", () => {
  it("grava e relê", async () => {
    await saveCredential(record(), file);
    expect((await readCredentials(file))[0]?.id).toBe("deepseek-principal");
  });

  it("o arquivo fica com permissão 0600", async () => {
    await saveCredential(record(), file);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("o temporário já é privado antes de escrever a chave", async () => {
    const { open } = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const observed: number[] = [];
    vi.mocked(files.open).mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (args[1] === "wx") {
        const write = handle.writeFile.bind(handle);
        vi.spyOn(handle, "writeFile").mockImplementation(async (...writeArgs) => {
          observed.push((await handle.stat()).mode & 0o777);
          return write(...writeArgs);
        });
      }
      return handle;
    });
    await saveCredential(record(), file);
    expect(observed).toEqual([0o600]);
  });

  it("só uma credencial por provider fica como default", async () => {
    await saveCredential(record(), file);
    await saveCredential(record({ id: "deepseek-trabalho", label: "DeepSeek trabalho", default: true }), file);
    const defaults = (await readCredentials(file)).filter((entry) => entry.default);
    expect(defaults.map((entry) => entry.id)).toEqual(["deepseek-trabalho"]);
  });

  it("remove e informa se havia algo para remover", async () => {
    await saveCredential(record(), file);
    expect(await removeCredential("deepseek-principal", file)).toBe(true);
    expect(await removeCredential("deepseek-principal", file)).toBe(false);
  });

  it("arquivo ausente devolve lista vazia em vez de explodir", async () => {
    expect(await readCredentials(join(workspace, "ausente.json"))).toEqual([]);
  });
});

describe("seleção", () => {
  const records = [
    record({ id: "a", label: "A", default: false }),
    record({ id: "b", label: "B", default: true }),
    record({ id: "c", provider: "openai", label: "C", default: true }),
  ];

  it("sem seletor, escolhe o default do provider", () => {
    expect(selectCredential(records, "deepseek", "")?.id).toBe("b");
  });

  it("aceita seletor por id ou por label", () => {
    expect(selectCredential(records, "deepseek", "a")?.id).toBe("a");
    expect(selectCredential(records, "deepseek", "A")?.id).toBe("a");
  });

  it("não cruza credencial entre providers", () => {
    expect(selectCredential(records, "minimax", "")).toBeNull();
  });
});

describe("chaves salvas para subprocessos OpenCode", () => {
  it("modelo google resolve a chave Gemini salva", () => {
    const records = [record({ provider: "gemini", secret: "gemini-key-de-teste" }), record()];
    const env = withApiCredentials(records, {}, ["google"]);
    expect(env.GEMINI_API_KEY).toBe("gemini-key-de-teste");
    expect(env.DEEPSEEK_API_KEY).toBeUndefined();
  });

  it("injeta só o provider selecionado e não modifica o ambiente original", () => {
    const environment = { PATH: "/bin" };
    const records = [record(), record({ id: "outro", provider: "openai", secret: "sk-outro-teste" })];
    const env = withApiCredentials(records, environment, ["deepseek"]);
    expect(env.DEEPSEEK_API_KEY).toBe(record().secret);
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(environment).toEqual({ PATH: "/bin" });
    expect(withApiCredentials(records, {}, ["opencode"]).DEEPSEEK_API_KEY).toBeUndefined();
  });

  it("preserva a chave do ambiente; seletor explícito escolhe a chave salva", () => {
    const environment = { DEEPSEEK_API_KEY: "sk-do-ambiente" };
    expect(withApiCredentials([record()], environment, ["deepseek"]).DEEPSEEK_API_KEY).toBe("sk-do-ambiente");
    expect(withApiCredentials([record()], environment, ["deepseek"], record().id).DEEPSEEK_API_KEY).toBe(record().secret);
  });
});

describe("exposição", () => {
  it("a forma segura nunca carrega o segredo", () => {
    const safe = toSafe(record()) as unknown as Record<string, unknown>;
    expect(safe.secret).toBeUndefined();
    expect(JSON.stringify(safe)).not.toContain("sk-valor");
  });

  it("mask mostra o formato, nunca o valor", () => {
    expect(mask("sk-valor-muito-secreto-aqui")).not.toContain("valor-muito");
    expect(mask("curto")).toBe("*****");
  });

  it("redact troca o segredo pelo nome da variável", () => {
    const texto = redact("a chave é sk-abcdefghijk fim", { OPENAI_API_KEY: "sk-abcdefghijk" });
    expect(texto).toBe("a chave é [REDACTED:OPENAI_API_KEY] fim");
  });

  it("redact ignora variáveis não sensíveis e valores curtos", () => {
    expect(redact("valor xyz", { HOME: "xyz", API_KEY: "curto" })).toBe("valor xyz");
  });
});
