/** Configuração compartilhada pelos projetos, com credenciais fora do repositório. */
import { randomUUID } from "node:crypto";
import {
  chmodSync, closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import { isIP } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface SavedMcpConnection {
  url: string;
  port: number;
  token: string;
}

export interface GlobalConfig {
  version: 1;
  mcp: {
    defaultUrl?: string;
    servers: SavedMcpConnection[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const INVALID_CONFIG = "a configuração global é inválida; corrija o arquivo config.json antes de continuar";
const INVALID_URL = "o endereço MCP deve usar HTTP ou HTTPS, sem usuário, senha, consulta ou fragmento";

function vazio(): GlobalConfig {
  return { version: 1, mcp: { servers: [] } };
}

function objeto(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function codigo(erro: unknown): string | undefined {
  return objeto(erro) && typeof erro.code === "string" ? erro.code : undefined;
}

function loopback(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return host === "localhost" || host === "[::1]" || (isIP(host) === 4 && host.startsWith("127."));
}

function validarUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error(INVALID_URL); }
  if (
    !["http:", "https:"].includes(url.protocol) || url.username || url.password ||
    value.includes("?") || value.includes("#") || /[\u0000-\u0020\u007f]/.test(value)
  ) throw new Error(INVALID_URL);
  return url;
}

function validarPorta(value: string | number): number {
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) {
    throw new Error("a porta MCP deve ser um número inteiro entre 1 e 65535");
  }
  const port = typeof value === "string" ? Number(value.trim()) : value;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("a porta MCP deve ser um número inteiro entre 1 e 65535");
  }
  return port;
}

/** Endereço e porta são campos separados; a porta informada prevalece. */
export function buildMcpConnection(address: string, port: string | number, token: string): SavedMcpConnection {
  const numericPort = validarPorta(port);
  const secret = token.trim();
  if (!/^[!-~]+$/.test(secret)) {
    throw new Error("o token MCP precisa estar preenchido e conter apenas caracteres imprimíveis, sem espaços");
  }
  const input = address.trim();
  if (!input || input.startsWith("/") || input.startsWith("\\")) throw new Error(INVALID_URL);
  const scheme = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(input);
  let url: URL;
  if (scheme) {
    url = validarUrl(input);
  } else {
    // Um hostname pode trazer porta. Um esquema incompleto, como http:/,
    // não pode virar por acidente o hostname de outra conexão.
    if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(input) && !/^[^/\\]+:\d+(?:\/|$)/.test(input)) {
      throw new Error(INVALID_URL);
    }
    const host = isIP(input) === 6 ? `[${input}]` : input;
    url = validarUrl(`https://${host}`);
    if (loopback(url)) url.protocol = "http:";
  }
  url.port = String(numericPort);
  if (url.pathname === "/") url.pathname = "/mcp";
  return { url: url.href, port: numericPort, token: secret };
}

export function globalConfigPath(environment: NodeJS.ProcessEnv = process.env): string {
  const directory = environment.CAPIVARA_CONFIG_DIR?.trim();
  return join(directory || join(homedir(), ".capybara"), "config.json");
}

function validarConfig(value: unknown): GlobalConfig {
  if (!objeto(value) || value.version !== 1 || !objeto(value.mcp) || !Array.isArray(value.mcp.servers)) {
    throw new Error(INVALID_CONFIG);
  }
  const servers: SavedMcpConnection[] = [];
  const urls = new Set<string>();
  for (const item of value.mcp.servers) {
    if (!objeto(item) || typeof item.url !== "string" || typeof item.port !== "number" || typeof item.token !== "string") {
      throw new Error(INVALID_CONFIG);
    }
    let connection: SavedMcpConnection;
    try {
      const parsed = validarUrl(item.url);
      const actualPort = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
      if (actualPort !== item.port) throw new Error(INVALID_CONFIG);
      connection = buildMcpConnection(parsed.href, item.port, item.token);
    } catch { throw new Error(INVALID_CONFIG); }
    if (urls.has(connection.url)) throw new Error(INVALID_CONFIG);
    urls.add(connection.url);
    servers.push({ ...item, ...connection });
  }
  let defaultUrl: string | undefined;
  if (value.mcp.defaultUrl !== undefined) {
    if (typeof value.mcp.defaultUrl !== "string") throw new Error(INVALID_CONFIG);
    try { defaultUrl = validarUrl(value.mcp.defaultUrl).href; }
    catch { throw new Error(INVALID_CONFIG); }
    if (!urls.has(defaultUrl)) throw new Error(INVALID_CONFIG);
  }
  return {
    ...value,
    version: 1,
    mcp: { ...value.mcp, servers, ...(defaultUrl ? { defaultUrl } : {}) },
  };
}

/** Recusa links no diretório final e no arquivo de credenciais. */
function validarDiretorio(path: string): void {
  try {
    const info = lstatSync(dirname(path));
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(INVALID_CONFIG);
  } catch (erro) {
    if (codigo(erro) !== "ENOENT") throw erro;
  }
}

export function readGlobalConfig(path = globalConfigPath()): GlobalConfig {
  let fd: number | undefined;
  let contents: string;
  try {
    validarDiretorio(path);
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!fstatSync(fd).isFile()) throw new Error(INVALID_CONFIG);
    contents = readFileSync(fd, "utf8");
  } catch (erro) {
    if (codigo(erro) === "ENOENT") return vazio();
    throw new Error("não consegui ler a configuração global; verifique config.json, seus links e permissões");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(contents); }
  catch { throw new Error(INVALID_CONFIG); }
  return validarConfig(parsed);
}

function sincronizarDiretorio(directory: string): void {
  try {
    const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(fd); }
    finally { closeSync(fd); }
  } catch { /* alguns sistemas de arquivos não permitem sincronizar diretórios */ }
}

/** O arquivo temporário nasce privado e só substitui o anterior após fsync. */
function gravarConfig(config: GlobalConfig, path: string): void {
  let fd: number | undefined;
  let temporary: string | undefined;
  try {
    validarDiretorio(path);
    const directory = dirname(path);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    validarDiretorio(path);
    chmodSync(directory, 0o700);
    temporary = join(directory, `.config-${randomUUID()}.tmp`);
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    fchmodSync(fd, 0o600);
    writeFileSync(fd, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, path);
    temporary = undefined;
    sincronizarDiretorio(directory);
  } catch {
    throw new Error("não consegui salvar a configuração global; verifique config.json e suas permissões");
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (temporary !== undefined) {
      try { unlinkSync(temporary); } catch { /* pode ter falhado antes da criação */ }
    }
  }
}

export function findMcpConnection(config: GlobalConfig, url: string): SavedMcpConnection | undefined {
  const canonical = validarUrl(url).href;
  return config.mcp.servers.find((server) => server.url === canonical);
}

export function getDefaultMcpConnection(config: GlobalConfig): SavedMcpConnection | undefined {
  return config.mcp.defaultUrl ? findMcpConnection(config, config.mcp.defaultUrl) : config.mcp.servers[0];
}

export function saveMcpConnection(connection: SavedMcpConnection, path = globalConfigPath()): GlobalConfig {
  const canonical = buildMcpConnection(connection.url, connection.port, connection.token);
  const config = readGlobalConfig(path);
  const existing = config.mcp.servers.findIndex((server) => server.url === canonical.url);
  if (existing < 0) config.mcp.servers.push(canonical);
  else config.mcp.servers[existing] = { ...config.mcp.servers[existing], ...canonical };
  config.mcp.defaultUrl = canonical.url;
  gravarConfig(config, path);
  return config;
}

export function setDefaultMcpConnection(url: string, path = globalConfigPath()): GlobalConfig {
  const config = readGlobalConfig(path);
  const server = findMcpConnection(config, url);
  if (!server) throw new Error("a conexão MCP não está salva na configuração global");
  config.mcp.defaultUrl = server.url;
  gravarConfig(config, path);
  return config;
}

export function removeMcpConnection(url: string, path = globalConfigPath()): boolean {
  const config = readGlobalConfig(path);
  const server = findMcpConnection(config, url);
  if (!server) return false;
  config.mcp.servers = config.mcp.servers.filter((item) => item.url !== server.url);
  if (config.mcp.defaultUrl === server.url) {
    const next = config.mcp.servers[0];
    if (next) config.mcp.defaultUrl = next.url;
    else delete config.mcp.defaultUrl;
  }
  gravarConfig(config, path);
  return true;
}
