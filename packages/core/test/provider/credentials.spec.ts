import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

let workspace = "";
let file = "";

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "capivara-cred-"));
  file = join(workspace, "credentials.json");
});

afterEach(async () => {
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
