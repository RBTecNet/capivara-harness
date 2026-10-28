import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DataCenterEndpoint, DataCenterResult } from './types.js';

const invalidUrl = 'O endpoint da base deve usar HTTP ou HTTPS, sem credenciais, consulta ou fragmento na URL.';
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const filled = (value: string | undefined): string | undefined => value?.trim() || undefined;

export function validateDataCenterEndpoint(endpoint: DataCenterEndpoint): DataCenterEndpoint {
  let url: URL;
  try { url = new URL(endpoint.url); } catch { throw new Error(invalidUrl); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /[?#\u0000-\u0020\u007f\\]/.test(endpoint.url)) throw new Error(invalidUrl);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(endpoint.headers ?? {})) {
    if (typeof value !== 'string' || !/^[!#$%&'*+.^_`|~\w-]+$/.test(name) || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Um cabeçalho da base contém caracteres inválidos.');
    if (/^(host|content-length|content-type|accept|mcp-session-id|mcp-protocol-version)$/i.test(name)) throw new Error('Um cabeçalho reservado do protocolo foi informado na configuração da base.');
    headers[name.toLowerCase()] = value;
  }
  // HTTPS always uses the runtime's verified TLS connection. No insecure dispatcher is installed.
  return { url: url.href, ...(Object.keys(headers).length ? { headers } : {}) };
}

export function legacyDataCenterConfigPath(environment: NodeJS.ProcessEnv = process.env): string {
  return join(filled(environment.CAPIVARA_CONFIG_DIR) ?? join(homedir(), '.capybara'), 'config.json');
}

/** Read-only compatibility import; the retired config module and motor are never loaded. */
function legacyConnections(path: string): { url: string; token?: string; headers?: Record<string, string> }[] {
  let descriptor: number | undefined;
  let parsed: unknown;
  try {
    const directory = lstatSync(dirname(path));
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('invalid');
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!fstatSync(descriptor).isFile()) throw new Error('invalid');
    parsed = JSON.parse(readFileSync(descriptor, 'utf8'));
  } catch (error) {
    if (object(error) && error.code === 'ENOENT') return [];
    throw new Error('Não foi possível ler a configuração antiga da base; confira config.json e suas permissões.');
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
  if (!object(parsed) || parsed.version !== 1 || !object(parsed.mcp) || !Array.isArray(parsed.mcp.servers)) throw new Error('A configuração antiga da base é inválida.');
  const servers = parsed.mcp.servers.map((item: unknown) => {
    if (!object(item) || typeof item.url !== 'string' || typeof item.token !== 'string') throw new Error('A conexão antiga da base é inválida.');
    const endpoint = validateDataCenterEndpoint({ url: item.url });
    const url = new URL(endpoint.url);
    if (item.port !== Number(url.port || (url.protocol === 'https:' ? 443 : 80))) throw new Error('A porta da conexão antiga da base é inválida.');
    if (!/^[!-~]+$/.test(item.token)) throw new Error('O token da conexão antiga da base contém caracteres inválidos.');
    return { url: endpoint.url, token: item.token };
  });
  if (parsed.mcp.defaultUrl !== undefined) {
    if (typeof parsed.mcp.defaultUrl !== 'string') throw new Error('A conexão padrão antiga da base é inválida.');
    const url = validateDataCenterEndpoint({ url: parsed.mcp.defaultUrl }).url;
    const index = servers.findIndex((server) => server.url === url);
    if (index < 0) throw new Error('A conexão padrão antiga da base não foi encontrada.');
    const selected = servers.splice(index, 1)[0];
    if (selected) servers.unshift(selected);
  }
  return servers;
}

export interface DataCenterEndpointOptions { legacyConfigPath?: string; }

/** Explicit settings > paired environment > legacy default; saved tokens follow the exact URL. */
export function resolveDataCenterEndpoint(
  explicit?: DataCenterEndpoint | string,
  environment: NodeJS.ProcessEnv = process.env,
  options: DataCenterEndpointOptions = {},
): DataCenterResult<DataCenterEndpoint | null> {
  try {
    const explicitEndpoint = typeof explicit === 'string' ? { url: explicit.trim() } : explicit;
    const environmentUrl = filled(environment.CAPIVARA_MCP_URL) ?? filled(environment.DOC_CENTER_URL);
    // An explicit credential is self-contained; unrelated legacy settings cannot invalidate it.
    if (explicitEndpoint?.headers && Object.keys(explicitEndpoint.headers).length) {
      return { ok: true, value: validateDataCenterEndpoint(explicitEndpoint), availability: { status: 'ready', retryable: false, attempts: 0 } };
    }
    const servers = legacyConnections(options.legacyConfigPath ?? legacyDataCenterConfigPath(environment));
    const url = filled(explicitEndpoint?.url) ?? environmentUrl ?? servers[0]?.url;
    if (!url) return { ok: true, value: null, availability: { status: 'unconfigured', retryable: false, attempts: 0 } };
    const endpoint = validateDataCenterEndpoint({ url });
    const capivaraToken = filled(environment.CAPIVARA_MCP_TOKEN);
    const docCenterToken = filled(environment.DOC_CENTER_TOKEN);
    const token = capivaraToken ?? docCenterToken;
    const pairedUrl = filled(capivaraToken ? environment.CAPIVARA_MCP_URL : docCenterToken ? environment.DOC_CENTER_URL : undefined);
    if (token && pairedUrl && validateDataCenterEndpoint({ url: pairedUrl }).url !== endpoint.url) throw new Error('O token de ambiente pertence a outro endpoint da base.');
    const saved = servers.find((server) => server.url === endpoint.url);
    const selectedToken = token ?? saved?.token;
    if (selectedToken) {
      if (!/^[!-~]+$/.test(selectedToken)) throw new Error('O token da base contém caracteres inválidos.');
      endpoint.headers = { authorization: `Bearer ${selectedToken}` };
    }
    return { ok: true, value: endpoint, availability: { status: 'ready', retryable: false, attempts: 0 } };
  } catch (error) {
    return { ok: false, availability: { status: 'invalid-config', retryable: false, attempts: 0, message: error instanceof Error ? error.message : 'A configuração da base é inválida.' } };
  }
}
