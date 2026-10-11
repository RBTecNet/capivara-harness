import { Command } from "commander";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerConfigCommand } from "../../src/commands/config.js";
import { createProgram } from "../../src/cli-program.js";
import { buildMcpConnection, globalConfigPath, readGlobalConfig, saveMcpConnection } from "../../src/config/global.js";

let directory: string;
let environment: NodeJS.ProcessEnv;
let previousExitCode: typeof process.exitCode;

class Terminal extends PassThrough {
  readonly isTTY = true;
  isRaw = false;
  readonly modes: boolean[] = [];
  setRawMode(value: boolean): this { this.isRaw = value; this.modes.push(value); return this; }
}

function prepared(input: Readable) {
  let text = "";
  const output = new Writable({ write(chunk, _encoding, done) { text += String(chunk); done(); } });
  const program = new Command("capivara");
  registerConfigCommand(program, { input, output, environment });
  return { program, output: () => text };
}

async function invoke(lines: string, args = ["config"]) {
  const flow = prepared(Readable.from([lines]));
  await flow.program.parseAsync(args, { from: "user" });
  return flow.output();
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "capivara-config-command-"));
  environment = { CAPIVARA_CONFIG_DIR: join(directory, "settings") };
  previousExitCode = process.exitCode;
  process.exitCode = undefined;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("configuração não deve usar rede"); });
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = previousExitCode;
  await rm(directory, { recursive: true, force: true });
});

describe("capivara config", () => {
  it("registra menu e atalho sem exigir provider ou token por argumento", () => {
    const config = createProgram().commands.find((command) => command.name() === "config");
    expect(config).toBeDefined();
    expect(config?.options).toEqual([]);
    expect(config?.commands.find((command) => command.name() === "add")?.commands.map((command) => command.name())).toContain("mcp");
  });

  it("enfileira entrada de pipe e salva a conexão padrão sem exibir o token", async () => {
    const secret = "private_menu_token_987";
    const output = await invoke(`1\nhttps://docs.example/mcp\n443\n${secret}\n`);
    const config = readGlobalConfig(globalConfigPath(environment));
    expect(config.mcp.defaultUrl).toBe("https://docs.example/mcp");
    expect(config.mcp.servers).toEqual([{ url: "https://docs.example/mcp", port: 443, token: secret }]);
    expect(output).toContain("Adicionar MCP");
    expect(output).toContain("usada automaticamente");
    expect(output).not.toContain(secret);
    expect(output).not.toContain(secret.slice(0, 12));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("o atalho pergunta somente endereço, porta e token, sem menu", async () => {
    const output = await invoke("localhost\n7777\nprivate_direct_token\n", ["config", "add", "mcp"]);
    expect(readGlobalConfig(globalConfigPath(environment)).mcp.defaultUrl).toBe("http://localhost:7777/mcp");
    expect(output).not.toContain("Adicionar MCP");
    expect(output).not.toContain("private_direct_token");
    expect(output).toContain("MCP salvo como padrão");
  });

  it.each([
    ["https://docs.example/custom/mcp", 443],
    ["docs.example", 443],
    ["localhost", 80],
    ["::1", 80],
    ["http://127.0.0.1:7777/mcp", 7777],
  ])("sugere a porta do endereço %s e preserva o caminho", async (address, port) => {
    const output = await invoke(`${address}\n\nprivate_default_port\n`, ["config", "add", "mcp"]);
    const connection = readGlobalConfig(globalConfigPath(environment)).mcp.servers[0];
    expect(output).toContain(`Porta [${port}]`);
    expect(connection?.port).toBe(port);
    if (address.includes("/custom/")) expect(connection?.url).toContain("/custom/mcp");
  });

  it("lista múltiplas conexões e padrão com status, sem partes dos tokens", async () => {
    await invoke("docs-a.example\n443\nsecret_A_123456789\n", ["config", "add", "mcp"]);
    await invoke("docs-b.example\n443\nsecret_B_123456789\n", ["config", "add", "mcp"]);
    const output = await invoke("2\n");
    expect(output).toContain("https://docs-a.example/mcp");
    expect(output).toContain("https://docs-b.example/mcp (padrão)");
    expect(output).toContain("token: configurado");
    expect(output).not.toContain("secret_A");
    expect(output).not.toContain("secret_B");
  });

  it("define o padrão e remove por número sem expor credenciais", async () => {
    await invoke("docs-a.example\n443\nsecret_A_123456789\n", ["config", "add", "mcp"]);
    await invoke("docs-b.example\n443\nsecret_B_123456789\n", ["config", "add", "mcp"]);
    const selected = await invoke("3\n1\n");
    expect(readGlobalConfig(globalConfigPath(environment)).mcp.defaultUrl).toBe("https://docs-a.example/mcp");
    const removed = await invoke("4\n1\n");
    const config = readGlobalConfig(globalConfigPath(environment));
    expect(config.mcp.servers.map((server) => server.url)).toEqual(["https://docs-b.example/mcp"]);
    expect(config.mcp.defaultUrl).toBe("https://docs-b.example/mcp");
    expect(selected + removed).not.toContain("secret_A");
    expect(selected + removed).not.toContain("secret_B");
  });

  it("EOF antes do token cancela sem substituir uma conexão existente", async () => {
    const path = globalConfigPath(environment);
    saveMcpConnection(buildMcpConnection("docs-a.example", 443, "preserve_this_token"), path);
    const before = await readFile(path, "utf8");
    const output = await invoke("docs-b.example\n443\n", ["config", "add", "mcp"]);
    expect(await readFile(path, "utf8")).toBe(before);
    expect(output).toContain("Configuração cancelada");
    expect(output).not.toContain("preserve_this_token");
  });

  it.each(["0x1BB", "4.43e2", "0", "65536"])("recusa porta %s sem persistir ou exibir o token", async (port) => {
    const output = await invoke(`docs.example\n${port}\nprivate_bad_port_token\n`, ["config", "add", "mcp"]);
    await expect(access(globalConfigPath(environment))).rejects.toThrow();
    expect(output).toContain("porta MCP");
    expect(output).not.toContain("private_bad_port_token");
    expect(process.exitCode).toBe(2);
  });

  it("salva MCP HTTP remoto na porta 7777 como padrão sem mostrar o token", async () => {
    const output = await invoke("http://docs.example/mcp\n7777\nprivate_http_token\n", ["config", "add", "mcp"]);
    expect(readGlobalConfig(globalConfigPath(environment))).toMatchObject({
      mcp: { defaultUrl: "http://docs.example:7777/mcp", servers: [
        { url: "http://docs.example:7777/mcp", port: 7777, token: "private_http_token" },
      ] },
    });
    expect(output).toContain("MCP salvo como padrão: http://docs.example:7777/mcp");
    expect(output).not.toContain("private_http_token");
    expect(output).not.toContain("private_http");
  });

  it("Sair e seleção cancelada não alteram a configuração", async () => {
    await invoke("0\n");
    await expect(access(globalConfigPath(environment))).rejects.toThrow();
    const path = globalConfigPath(environment);
    saveMcpConnection(buildMcpConnection("docs.example", 443, "private_existing_token"), path);
    const before = await readFile(path, "utf8");
    await invoke("4\n0\n");
    expect(await readFile(path, "utf8")).toBe(before);
  });
});

describe("token oculto no terminal", () => {
  it("oculta também o token de uma colagem e restaura o modo do terminal", async () => {
    const input = new Terminal();
    const flow = prepared(input);
    const pending = flow.program.parseAsync(["config", "add", "mcp"], { from: "user" });
    await vi.waitFor(() => expect(flow.output()).toContain("Endereço do MCP"));
    input.write("http://docs.example/mcp\n7777\nsecret_pasted_TTY_123456789\n");
    await pending;
    expect(flow.output()).not.toContain("secret_pasted");
    expect(flow.output()).not.toContain("secret_pasted_TTY_123456789");
    expect(readGlobalConfig(globalConfigPath(environment)).mcp.servers[0]).toEqual({
      url: "http://docs.example:7777/mcp", port: 7777, token: "secret_pasted_TTY_123456789",
    });
    expect(input.modes).toContain(true);
    expect(input.modes.at(-1)).toBe(false);
    input.destroy();
  });

  it("Ctrl+C na entrada oculta cancela sem salvar e remove o listener de sinal", async () => {
    const count = process.listenerCount("SIGINT");
    const input = new Terminal();
    const flow = prepared(input);
    const pending = flow.program.parseAsync(["config", "add", "mcp"], { from: "user" });
    await vi.waitFor(() => expect(flow.output()).toContain("Endereço do MCP"));
    input.write("docs.example\n");
    await vi.waitFor(() => expect(flow.output()).toContain("Porta [443]"));
    input.write("\n");
    await vi.waitFor(() => expect(flow.output()).toContain("Token (oculto)"));
    input.write("secret_interrupted_TTY");
    input.write("\u0003");
    await pending;
    expect(flow.output()).toContain("Configuração cancelada");
    expect(flow.output()).not.toContain("secret_interrupted");
    await expect(access(globalConfigPath(environment))).rejects.toThrow();
    expect(process.exitCode).toBe(130);
    expect(process.listenerCount("SIGINT")).toBe(count);
    expect(input.isRaw).toBe(false);
    input.destroy();
  });
});
