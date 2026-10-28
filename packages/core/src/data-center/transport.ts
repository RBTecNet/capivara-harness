import { VERSION } from '../version.js';
import { validateDataCenterEndpoint } from './endpoint.js';
import type { DataCenterAvailability, DataCenterClientOptions, DataCenterEndpoint } from './types.js';

export const DATA_CENTER_PROTOCOL_VERSION = '2025-06-18';
export const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export class DataCenterFault extends Error {
  constructor(readonly availability: DataCenterAvailability) {
    super(availability.message ?? 'A base documental não está disponível.');
  }
}

function fault(message: string, status: DataCenterAvailability['status'] = 'protocol-error', retryable = false, code?: number): DataCenterFault {
  return new DataCenterFault({ status, retryable, attempts: 1, message, ...(code !== undefined ? { code } : {}) });
}

interface Envelope { jsonrpc: '2.0'; id: number; result?: unknown; error?: { code: number }; }

function envelope(value: unknown, id: number): Envelope | undefined {
  if (!record(value) || value.jsonrpc !== '2.0' || value.id !== id) return undefined;
  if (!('result' in value) && !record(value.error)) return undefined;
  return value as unknown as Envelope;
}

/** Stops once the matching response arrives, including when an SSE connection remains open. */
async function readEnvelope(response: Response, id: number, maxBytes: number): Promise<Envelope> {
  const sse = (response.headers.get('content-type') ?? '').toLowerCase().includes('text/event-stream');
  const reader = response.body?.getReader();
  if (!reader) throw fault('A base respondeu sem conteúdo JSON-RPC.');
  const decoder = new TextDecoder();
  let pending = '', bytes = 0;
  const event: string[] = [];
  const parseEvent = (): Envelope | undefined => {
    const data = event.splice(0).join('\n');
    if (!data || data === '[DONE]') return undefined;
    try { return envelope(JSON.parse(data), id); } catch { return undefined; }
  };
  const consume = (final = false): Envelope | undefined => {
    for (;;) {
      const newline = pending.indexOf('\n');
      if (newline < 0) break;
      const line = pending.slice(0, newline).replace(/\r$/, '');
      pending = pending.slice(newline + 1);
      if (!line) { const result = parseEvent(); if (result) return result; }
      else if (line.startsWith('data:')) event.push(line.slice(5).replace(/^ /, ''));
    }
    if (final) {
      if (pending.startsWith('data:')) event.push(pending.slice(5).replace(/^ /, '').replace(/\r$/, ''));
      return parseEvent();
    }
    return undefined;
  };
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw fault('A resposta da base ultrapassou o limite de leitura.');
      pending += decoder.decode(chunk.value, { stream: true });
      if (sse) { const result = consume(); if (result) return result; }
    }
    pending += decoder.decode();
    if (sse) { const result = consume(true); if (result) return result; }
    else {
      try { const result = envelope(JSON.parse(pending), id); if (result) return result; }
      catch { /* Remote content never appears in diagnostics. */ }
    }
    throw fault('A base não devolveu uma resposta JSON-RPC correspondente à chamada.');
  } finally { void reader.cancel().catch(() => {}); }
}

/** Transport exposes only read methods; there is deliberately no arbitrary tools/call API. */
export class DataCenterTransport {
  readonly endpoint: DataCenterEndpoint;
  private readonly options: DataCenterClientOptions;
  private session: string | undefined;
  private protocol: string | undefined;
  private initialized: Promise<void> | undefined;
  private nextId = 0;
  attempts = 0;

  constructor(endpoint: DataCenterEndpoint, options: DataCenterClientOptions) {
    this.endpoint = validateDataCenterEndpoint(endpoint);
    this.options = {
      ...options,
      timeoutMs: Number.isFinite(options.timeoutMs) ? Math.max(1, options.timeoutMs!) : 12_000,
      retries: Number.isFinite(options.retries) ? Math.max(0, Math.min(3, Math.trunc(options.retries!))) : 1,
      retryDelayMs: Number.isFinite(options.retryDelayMs) ? Math.max(0, options.retryDelayMs!) : 150,
      maxResponseBytes: Number.isFinite(options.maxResponseBytes) ? Math.max(1, options.maxResponseBytes!) : 8_000_000,
    };
  }

  private async send(method: string, params?: Record<string, unknown>, notification = false): Promise<unknown> {
    const id = ++this.nextId;
    const control = new AbortController();
    const signal = this.options.signal ? AbortSignal.any([control.signal, this.options.signal]) : control.signal;
    const timer = setTimeout(() => control.abort(), this.options.timeoutMs ?? 12_000);
    try {
      const headers = {
        ...this.endpoint.headers,
        'content-type': 'application/json', accept: 'application/json, text/event-stream',
        ...(this.session ? { 'mcp-session-id': this.session } : {}),
        ...(this.protocol ? { 'mcp-protocol-version': this.protocol } : {}),
      };
      const response = await (this.options.fetchImpl ?? fetch)(this.endpoint.url, {
        method: 'POST', headers, signal, redirect: 'error',
        body: JSON.stringify({ jsonrpc: '2.0', ...(!notification ? { id } : {}), method, ...(params ? { params } : {}) }),
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        if (response.status === 401 || response.status === 403) throw fault('A base recusou a credencial ou a permissão configurada.', 'unauthorized', false, response.status);
        if (response.status >= 300 && response.status < 400) throw fault('A base tentou redirecionar a chamada; o destino deve ser configurado explicitamente.', 'invalid-config', false, response.status);
        throw fault(`A base respondeu HTTP ${response.status}.`, 'unavailable', response.status === 429 || response.status >= 500, response.status);
      }
      if (notification) { void response.body?.cancel().catch(() => {}); return undefined; }
      const result = await readEnvelope(response, id, this.options.maxResponseBytes ?? 8_000_000);
      if (result.error) throw fault('A base não aceitou a operação de leitura.', 'protocol-error', false, result.error.code);
      if (method === 'initialize') {
        const session = response.headers.get('mcp-session-id');
        if (session && (!/^[!-~]+$/.test(session) || session.length > 4096)) throw fault('A base devolveu um identificador de sessão inválido.');
        this.session = session ?? undefined;
      }
      return result.result;
    } catch (error) {
      if (error instanceof DataCenterFault) throw error;
      if (this.options.signal?.aborted) throw fault('A consulta à base foi interrompida.', 'unavailable', false);
      // Neither a remote body nor fetch's exception can expose tokens/headers in the UI.
      throw fault(control.signal.aborted ? 'A base excedeu o tempo de resposta; é possível tentar novamente.' : 'Não foi possível conectar à base documental.', 'unavailable', true);
    } finally { clearTimeout(timer); }
  }

  private async initialize(): Promise<void> {
    if (!this.initialized) {
      this.initialized = (async () => {
        const result = await this.send('initialize', {
          protocolVersion: DATA_CENTER_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'capivara', version: VERSION },
        });
        if (!record(result) || typeof result.protocolVersion !== 'string' || !['2025-06-18', '2025-03-26', '2024-11-05'].includes(result.protocolVersion)) throw fault('A base não negociou uma versão MCP suportada.');
        this.protocol = result.protocolVersion;
        await this.send('notifications/initialized', undefined, true);
      })();
    }
    try { await this.initialized; }
    catch (error) { this.initialized = undefined; this.session = undefined; this.protocol = undefined; throw error; }
  }

  async call(method: 'resources/list' | 'resources/read' | 'prompts/list' | 'prompts/get' | 'tools/call', params?: Record<string, unknown>): Promise<unknown> {
    if (method === 'tools/call' && !['listar_material', 'obter_contexto', 'ler_documento', 'listar_historico'].includes(String(params?.name))) throw fault('A operação solicitada não é uma leitura autorizada.');
    const retries = Math.max(0, Math.min(3, this.options.retries ?? 1));
    let recoveredSession = false;
    for (let attempt = 0; ; attempt += 1) {
      this.attempts = Math.max(this.attempts, attempt + 1);
      try { await this.initialize(); return await this.send(method, params); }
      catch (error) {
        const failure = error instanceof DataCenterFault ? error : fault('A leitura da base falhou.', 'unavailable', true);
        failure.availability.attempts = attempt + 1;
        if (failure.availability.code === 404 && this.session && !recoveredSession) {
          this.initialized = undefined; this.session = undefined; this.protocol = undefined; recoveredSession = true;
          continue;
        }
        if (!failure.availability.retryable || attempt >= retries) throw failure;
        await (this.options.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))))((this.options.retryDelayMs ?? 150) * (attempt + 1));
      }
    }
  }
}
