import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgram } from "../../src/cli-program.js";

let directory: string;
let output: string;
let errors: string;
let previousExit: typeof process.exitCode;
let previousTTY: PropertyDescriptor | undefined;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "capivara-provider-models-"));
  previousExit = process.exitCode;
  process.exitCode = undefined;
  previousTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  vi.stubEnv("CAPIVARA_CONFIG_DIR", directory);
  vi.stubEnv("DEEPSEEK_API_KEY", "sk-api-ficticia-de-teste");
  vi.stubEnv("MINIMAX_API_KEY", "sk-api-ficticia-de-teste");
  output = errors = "";
  vi.spyOn(process.stdout, "write").mockImplementation(((s: string | Uint8Array) => { output += String(s); return true; }) as typeof process.stdout.write);
  vi.spyOn(process.stderr, "write").mockImplementation(((s: string | Uint8Array) => { errors += String(s); return true; }) as typeof process.stderr.write);
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"data":[{"id":"modelo-api-1"},{"id":"modelo-api-2"}]}'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = previousExit;
  if (previousTTY) Object.defineProperty(process.stdin, "isTTY", previousTTY);
  else Reflect.deleteProperty(process.stdin, "isTTY");
  await rm(directory, { recursive: true, force: true });
});

describe("listagem e seleção de modelos de API", () => {
  it.each(["deepseek", "minimax"])("%s lista os identificadores sem abrir tarefa ou chamar inferência", async (provider) => {
    await createProgram().parseAsync(["providers", "models", provider], { from: "user" });
    expect(output).toBe("modelo-api-1\nmodelo-api-2\n");
    expect(errors).toBe("");
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(provider === "minimax" ? "https://api.minimax.io/v1/models" : "https://api.deepseek.com/models");
  });

  it("JSON contém só os modelos", async () => {
    await createProgram().parseAsync(["providers", "models", "deepseek", "--json"], { from: "user" });
    expect(JSON.parse(output)).toEqual(["modelo-api-1", "modelo-api-2"]);
  });

  it.each(["deepseek", "minimax"])("%s: credencial recusada mostra HTTP e termina sem expor corpo nem segredo", async (provider) => {
    vi.mocked(fetch).mockResolvedValue(new Response("sk-api-ficticia-de-teste", { status: 401 }));
    await createProgram().parseAsync(["providers", "models", provider], { from: "user" });
    expect(errors).toContain("HTTP 401");
    expect(process.exitCode).toBe(2);
    expect(output + errors).not.toContain("sk-api-ficticia");
  });

  it("comando direto com provider mas sem modelo orienta a escolha antes de executar", async () => {
    await createProgram().parseAsync(["prompt-engineer", "Teste de escolha", "--provider", "deepseek", "--project", directory], { from: "user" });
    expect(output).toContain("falta escolher o modelo");
    expect(output).toContain("providers models deepseek");
    expect(output).not.toContain("não tem provider");
    expect(process.exitCode).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
  });
});
