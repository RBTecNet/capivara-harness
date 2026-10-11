/** Configuração global do harness, sem chamadas a providers ou ao servidor MCP. */
import { createInterface } from "node:readline";
import { isIP } from "node:net";
import { Writable, type Readable } from "node:stream";
import type { Command } from "commander";
import { buildMcpConnection, getDefaultMcpConnection, globalConfigPath, readGlobalConfig, removeMcpConnection, saveMcpConnection, setDefaultMcpConnection, type GlobalConfig } from "../config/global.js";
import { createLineIO, InputEndedError } from "./line-io.js";

export interface ConfigCommandOptions {
  input?: Readable;
  output?: Writable;
  environment?: NodeJS.ProcessEnv;
}

/** Todo eco do readline passa aqui; tokens e entrada antecipada ficam ocultos. */
class PromptOutput extends Writable {
  echo = false;
  readonly isTTY = true;
  readonly columns: number;

  constructor(private readonly target: Writable) {
    super();
    this.columns = (target as Writable & { columns?: number }).columns ?? 80;
  }

  override _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    // Decide antes de enfileirar no destino, sem reavaliar echo num callback
    // futuro que poderia pertencer a outra pergunta.
    if (this.echo) this.target.write(chunk, encoding);
    callback();
  }
}

function suggestedPort(address: string): number {
  try {
    const host = isIP(address) === 6 ? `[${address}]` : address;
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(address) ? address : `https://${host}`);
    if (url.port) return Number(url.port);
    const local = url.hostname === "localhost" || url.hostname === "[::1]" || (isIP(url.hostname) === 4 && url.hostname.startsWith("127."));
    return url.protocol === "http:" || (!address.includes("://") && local) ? 80 : 443;
  } catch { return 443; }
}

async function configure(options: ConfigCommandOptions, direct = false): Promise<void> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const environment = options.environment ?? process.env;
  const write = (text: string): void => { output.write(text); };
  const filtered = new PromptOutput(output);
  const reader = createInterface({ input, output: filtered, terminal: (input as Readable & { isTTY?: boolean }).isTTY === true, historySize: 0 });
  // A linha encerra seu eco antes de o readline processar o restante de uma
  // colagem. Assim um token antecipado nunca aparece enquanto aguardamos o await.
  reader.on("line", () => { filtered.echo = false; });
  const io = createLineIO(reader, write);
  let interrupted = false;
  const cancel = (): void => { interrupted = true; reader.close(); };
  reader.on("SIGINT", cancel);
  process.once("SIGINT", cancel);

  const ask = async (prompt: string, hidden = false): Promise<string> => {
    if (interrupted) throw new InputEndedError();
    reader.setPrompt(prompt);
    filtered.echo = !hidden;
    try {
      const value = await io.ask(prompt);
      if (interrupted) throw new InputEndedError();
      return value;
    }
    finally { filtered.echo = false; if (hidden) write("\n"); }
  };

  const showConnections = (config: GlobalConfig): void => {
    const selected = getDefaultMcpConnection(config);
    config.mcp.servers.forEach((connection, index) => {
      write(`  ${index + 1}) ${connection.url}${connection.url === selected?.url ? " (padrão)" : ""}\n     Porta: ${connection.port}; token: configurado\n`);
    });
  };

  try {
    const path = globalConfigPath(environment);
    let choice = "1";
    if (!direct) {
      write("Configuração do Capivara\n\n  1) Adicionar MCP\n  2) Listar MCPs\n  3) Definir MCP padrão\n  4) Remover MCP\n  0) Sair\n\n");
      choice = (await ask("Opção [1]: ")).trim() || "1";
    }
    if (choice === "0") return;
    if (["2", "3", "4"].includes(choice)) {
      const config = await readGlobalConfig(path);
      if (config.mcp.servers.length === 0) { write("Nenhum MCP configurado. Use capivara config para adicionar.\n"); return; }
      showConnections(config);
      if (choice === "2") return;
      const selected = (await ask("MCP (número; 0 cancela): ")).trim();
      if (selected === "0") return;
      const connection = /^\d+$/.test(selected) ? config.mcp.servers[Number(selected) - 1] : undefined;
      if (!connection) { write("MCP inválido; escolha o número de uma conexão listada.\n"); process.exitCode = 2; return; }
      if (choice === "3") {
        await setDefaultMcpConnection(connection.url, path);
        write(`MCP padrão: ${connection.url}\n`);
      } else {
        await removeMcpConnection(connection.url, path);
        write(`MCP removido: ${connection.url}\n`);
      }
      return;
    }
    if (choice !== "1") { write("Opção inválida. Escolha 1, 2, 3, 4 ou 0 em capivara config.\n"); process.exitCode = 2; return; }

    const address = (await ask("Endereço do MCP (host ou URL): ")).trim();
    const suggested = suggestedPort(address);
    const portText = (await ask(`Porta [${suggested}]: `)).trim();
    const token = await ask("Token (oculto): ", true);
    const connection = buildMcpConnection(address, portText === "" ? suggested : portText, token);
    if (interrupted) throw new InputEndedError();
    await saveMcpConnection(connection, path);
    write(`MCP salvo como padrão: ${connection.url}\nToken: configurado\nA conexão será usada automaticamente nos projetos e nas próximas execuções.\n`);
  } catch (error) {
    if (error instanceof InputEndedError) {
      write("Configuração cancelada; nenhuma conexão foi salva.\n");
      if (interrupted) process.exitCode = 130;
    } else {
      // Erros de disco/JSON podem incluir credenciais. Não reproduzir seu texto.
      const message = error instanceof Error && /^(o endereço MCP |a porta MCP |o token MCP )/.test(error.message)
        ? error.message : "não foi possível salvar ou ler a configuração; confira config.json e as permissões da pasta";
      write(`Não foi possível configurar o MCP: ${message}.\n`);
      process.exitCode = 2;
    }
  } finally {
    filtered.echo = false;
    process.off("SIGINT", cancel);
    reader.off("SIGINT", cancel);
    reader.close();
  }
}

export function registerConfigCommand(program: Command, options: ConfigCommandOptions = {}): void {
  const config = program.command("config").description("Configura conexões MCP globais, usadas em todos os projetos").action(async () => { await configure(options); });
  config.command("add").description("Adiciona uma conexão global")
    .command("mcp").description("Pergunta endereço, porta e token do MCP")
    .action(async () => { await configure(options, true); });
}
