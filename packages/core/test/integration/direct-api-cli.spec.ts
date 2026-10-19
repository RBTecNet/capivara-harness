import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgram } from "../../src/cli-program.js";

let directory: string;
let output: string;
let previousExit: typeof process.exitCode;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "capivara-direct-cli-"));
  previousExit = process.exitCode;
  process.exitCode = undefined;
  output = "";
  vi.stubEnv("CAPIVARA_CONFIG_DIR", directory);
  vi.stubEnv("MINIMAX_API_KEY", "sk-teste-cli-apenas");
  vi.stubEnv("OPENROUTER_API_KEY", "sk-teste-cli-apenas");
  vi.spyOn(process.stdout, "write").mockImplementation(((text: string | Uint8Array) => { output += String(text); return true; }) as typeof process.stdout.write);
  vi.spyOn(process.stderr, "write").mockImplementation(((text: string | Uint8Array) => { output += String(text); return true; }) as typeof process.stderr.write);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = previousExit;
  await rm(directory, { recursive: true, force: true });
});

describe("init com API direta pela CLI", () => {
  it("corte por tokens guarda parcial separado e consumo, sem publicar documento ou repetir", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "documento parcial sk-teste-cli-apenas", reasoning: "pensamento privado" }, finish_reason: "length" }],
      usage: { prompt_tokens: 3000, completion_tokens: 32768, completion_tokens_details: { reasoning_tokens: 32000 } },
    })));
    await createProgram().parseAsync(["init", "um aplicativo de tarefas", "--provider", "openrouter", "--model", "vendor/model", "--project", directory, "--no-dashboard"], { from: "user" });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(2);
    expect(output).toContain("atingiu o limite de tokens");
    expect(output).toContain("CAPIVARA_API_MAX_OUTPUT_TOKENS");
    expect(output).not.toContain("Verifique o modelo e a credencial");
    expect(output).not.toContain("sk-teste-cli-apenas");
    const [run] = await readdir(join(directory, ".capivara/runs"));
    const logs = join(directory, ".capivara/runs", run!, "logs");
    const names = await readdir(logs);
    const [partial] = names.filter(name => name.endsWith(".partial.txt"));
    expect(partial).toBeDefined();
    expect(await readFile(join(logs, partial!), "utf8")).toMatch(/^documento parcial \[REDACTED:[A-Z_]+\]$/);
    const [name] = names.filter(name => name.endsWith(".log"));
    const log = await readFile(join(logs, name!), "utf8");
    expect(log).toContain("raciocínio: 32000");
    expect(log).toContain("modelo: vendor/model");
    expect(log).not.toContain("pensamento privado");
    await expect(readFile(join(directory, ".capivara/init/skeleton.md"), "utf8")).rejects.toThrow();
  });
  it.each(["minimax", "openrouter"])("%s: chama a API e preserva stderr na evidência e na parada", async (provider) => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: { message: "invalid API key sk-teste-cli-apenas" } }), { status: 401 }));
    await createProgram().parseAsync(["init", "um aplicativo de tarefas", "--provider", provider, "--model", provider === "minimax" ? "MiniMax-M3" : "vendor/model", "--project", directory, "--no-dashboard"], { from: "user" });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(output).toContain("HTTP 401");
    expect(output).not.toContain("sk-teste-cli-apenas");
    expect(output).not.toContain("troque o modelo");
    expect(output).not.toContain("código 9");
    expect(process.exitCode).toBe(2);
    const [run] = await readdir(join(directory, ".capivara/runs"));
    const logsDirectory = join(directory, ".capivara/runs", run!, "logs");
    const [logName] = (await readdir(logsDirectory)).filter(name => name.startsWith("interview.skeleton.writer.1-1."));
    expect(logName).toBeDefined();
    const log = await readFile(join(logsDirectory, logName!), "utf8");
    expect(log).toContain("HTTP 401");
    expect(log).not.toContain("sk-teste-cli-apenas");
  });
});
