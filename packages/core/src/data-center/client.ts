import { validateDataCenterEndpoint } from './endpoint.js';
import { DataCenterFault, DataCenterTransport, record } from './transport.js';
import type {
  DataCenterAvailability, DataCenterClient, DataCenterClientOptions, DataCenterContext, DataCenterDocument,
  DataCenterEndpoint, DataCenterFile, DataCenterHistoryEntry, DataCenterMaterial, DataCenterProject, DataCenterPrompt, DataCenterResult,
} from './types.js';

interface Resource { uri: string; name: string; description?: string; mimeType?: string; }
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const records = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter(record) : [];
const requestUri = (project: string): string => `capivara://${project}/pedido`;
const projectOf = (uri: string): string => /^capivara:\/\/([^/]+)\//.exec(uri)?.[1] ?? '';
const historyUri = (uri: string): boolean => /^capivara:\/\/[^/]+\/historico(?:\/|$)/.test(uri);
const kindOf = (uri: string): string => /\/docs\/([^/]+)\//.exec(uri)?.[1] ?? (uri.endsWith('/pedido') ? 'pedido' : 'documento');
function invalid(message: string): DataCenterFault {
  return new DataCenterFault({ status: 'protocol-error', retryable: false, attempts: 1, message });
}
function validateProject(project: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(project) || project === 'geral') throw invalid('Selecione um projeto válido da base documental.');
}
function validateUri(uri: string): void {
  if (!/^capivara:\/\/[a-zA-Z0-9][a-zA-Z0-9_-]*\/(?:pedido|docs\/[^\s?#]+|historico(?:\/[^\s?#]+)?)$/.test(uri) || /(?:^|\/)\.\.(?:\/|$)/.test(uri)) throw invalid('A referência documental recebida não é uma URI capivara válida.');
}
function availability(error: unknown): DataCenterAvailability {
  return error instanceof DataCenterFault ? { ...error.availability } : { status: 'protocol-error', retryable: false, attempts: 1, message: 'A base devolveu material em formato inválido.' };
}

function toolPayload(result: unknown): unknown {
  if (!record(result)) throw invalid('A ferramenta de leitura devolveu uma resposta inválida.');
  if (result.isError === true) throw invalid('A ferramenta da base não conseguiu concluir a leitura.');
  if (record(result.structuredContent)) return result.structuredContent;
  const content = records(result.content).map((part) => text(part.text)).filter(Boolean).join('\n\n');
  try { return JSON.parse(content) as unknown; } catch { return content; }
}

function documentFrom(item: Record<string, unknown>, project: string): DataCenterDocument | undefined {
  const uri = text(item.uri);
  if (projectOf(uri) !== project || !uri.startsWith(`capivara://${project}/docs/`) || historyUri(uri)) return undefined;
  if (item.aprovado === false || item.approved === false || ['rascunho', 'draft', 'rejected', 'rejeitado'].includes(text(item.status))) return undefined;
  validateUri(uri);
  return { uri, name: text(item.titulo) || text(item.name) || uri, kind: kindOf(uri), text: text(item.conteudo) || text(item.text) };
}

function historyFrom(value: unknown, project: string): DataCenterHistoryEntry[] {
  const entries = record(value) ? records(value.entradas ?? value.entries) : records(value);
  return entries.filter((entry) => !entry.uri || projectOf(text(entry.uri)) === project).map((entry) => ({
    authority: 'history', role: text(entry.papel) || text(entry.role) || 'unknown',
    text: text(entry.conteudo) || text(entry.content) || text(entry.text) || text(entry.previa),
    ...(text(entry.uri) ? { uri: text(entry.uri) } : {}),
    ...(entry.id !== undefined ? { id: String(entry.id) } : {}),
    ...(text(entry.origem) || text(entry.origin) ? { origin: text(entry.origem) || text(entry.origin) } : {}),
  }));
}

export function createDataCenterClient(endpoint: DataCenterEndpoint, options: DataCenterClientOptions = {}): DataCenterClient {
  let transport: DataCenterTransport | undefined;
  let configurationFailure: DataCenterAvailability | undefined;
  try { transport = new DataCenterTransport(validateDataCenterEndpoint(endpoint), options); }
  catch { configurationFailure = { status: 'invalid-config', retryable: false, attempts: 0, message: 'A configuração do endpoint da base é inválida.' }; }

  async function run<T>(operation: (connection: DataCenterTransport) => Promise<T>): Promise<DataCenterResult<T>> {
    if (!transport || configurationFailure) return { ok: false, availability: configurationFailure ?? { status: 'unconfigured', retryable: false, attempts: 0 } };
    transport.attempts = 0;
    try { return { ok: true, value: await operation(transport), availability: { status: 'ready', retryable: false, attempts: transport.attempts } }; }
    catch (error) { return { ok: false, availability: availability(error) }; }
  }

  async function resources(connection: DataCenterTransport): Promise<Resource[]> {
    const found: Resource[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      let result: unknown;
      try { result = await connection.call('resources/list', cursor ? { cursor } : {}); }
      catch (error) { if (error instanceof DataCenterFault && error.availability.code === -32601) return []; throw error; }
      if (!record(result) || !Array.isArray(result.resources)) throw invalid('A base devolveu uma lista de recursos inválida.');
      for (const item of records(result.resources)) {
        if (!text(item.uri).startsWith('capivara://')) continue;
        validateUri(text(item.uri));
        found.push({ uri: text(item.uri), name: text(item.name) || text(item.uri), ...(text(item.description) ? { description: text(item.description) } : {}), ...(text(item.mimeType) ? { mimeType: text(item.mimeType) } : {}) });
      }
      cursor = text(result.nextCursor) || undefined;
      if (!cursor) return [...new Map(found.map((item) => [item.uri, item])).values()];
      if (cursors.has(cursor)) throw invalid('A paginação da base repetiu o mesmo cursor.');
      cursors.add(cursor);
    }
    throw invalid('A listagem da base ultrapassou o limite de páginas.');
  }

  async function prompts(connection: DataCenterTransport): Promise<DataCenterPrompt[]> {
    const found: DataCenterPrompt[] = [], cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      let result: unknown;
      try { result = await connection.call('prompts/list', cursor ? { cursor } : {}); }
      catch (error) { if (error instanceof DataCenterFault && error.availability.code === -32601) return []; throw error; }
      if (!record(result) || !Array.isArray(result.prompts)) throw invalid('A base devolveu uma lista de prompts inválida.');
      for (const item of records(result.prompts)) if (text(item.name)) found.push({ name: text(item.name), ...(text(item.title) ? { title: text(item.title) } : {}), ...(text(item.description) ? { description: text(item.description) } : {}) });
      cursor = text(result.nextCursor) || undefined;
      if (!cursor) return [...new Map(found.map((item) => [item.name, item])).values()];
      if (cursors.has(cursor)) throw invalid('A paginação de prompts repetiu o mesmo cursor.');
      cursors.add(cursor);
    }
    throw invalid('A listagem de prompts ultrapassou o limite de páginas.');
  }

  async function promptText(connection: DataCenterTransport, name: string): Promise<string> {
    if (!name.trim()) throw invalid('Selecione um prompt válido da base.');
    const prompt = await connection.call('prompts/get', { name });
    if (!record(prompt) || !Array.isArray(prompt.messages)) throw invalid('A base devolveu um prompt inválido.');
    return records(prompt.messages).flatMap((message) => (Array.isArray(message.content) ? records(message.content) : record(message.content) ? [message.content] : [])).map((part) => text(part.text)).filter(Boolean).join('\n\n');
  }

  async function read(connection: DataCenterTransport, uri: string, name?: string): Promise<DataCenterDocument> {
    validateUri(uri);
    let result: unknown;
    try { result = await connection.call('resources/read', { uri }); }
    catch (error) {
      if (!(error instanceof DataCenterFault) || error.availability.code !== -32601) throw error;
      const payload = toolPayload(await connection.call('tools/call', { name: 'ler_documento', arguments: { uri } }));
      if (typeof payload === 'string') return { uri, name: name ?? uri, kind: kindOf(uri), text: payload };
      if (record(payload)) return { uri, name: name ?? uri, kind: kindOf(uri), text: text(payload.conteudo) || text(payload.text) };
      throw invalid('A base devolveu um documento inválido.');
    }
    if (!record(result) || !Array.isArray(result.contents)) throw invalid('A base devolveu um documento inválido.');
    const parts = records(result.contents);
    if (parts.some((part) => typeof part.uri === 'string' && part.uri !== uri)) throw invalid('A base devolveu conteúdo de outra referência documental.');
    const binary = parts.filter((part) => typeof part.blob === 'string');
    return {
      uri, name: name ?? uri, kind: kindOf(uri), text: parts.map((part) => text(part.text)).filter(Boolean).join('\n\n'),
      ...(binary.length ? { files: binary.map((part) => ({ uri, path: uri.split('/').at(-1) ?? 'attachment', base64: text(part.blob), ...(text(part.mimeType) ? { mimeType: text(part.mimeType) } : {}) })) } : {}),
    };
  }

  async function context(connection: DataCenterTransport, project: string): Promise<DataCenterContext> {
    validateProject(project);
    const payload = toolPayload(await connection.call('tools/call', { name: 'obter_contexto', arguments: { projeto: project } }));
    if (!record(payload) || !record(payload.pedido)) throw invalid('O contexto da base não contém um pedido estruturado.');
    if (record(payload.projeto) && payload.projeto.slug !== undefined && payload.projeto.slug !== project) throw invalid('O contexto recebido pertence a outro projeto.');
    const uri = text(payload.pedido.uri) || requestUri(project);
    if (uri !== requestUri(project)) throw invalid('O pedido recebido pertence a outro projeto.');
    let request = text(payload.pedido.conteudo);
    if (payload.pedido.truncado === true) request = (await read(connection, uri)).text;
    const fullDocuments = async (items: unknown): Promise<DataCenterDocument[]> => {
      const result: DataCenterDocument[] = [];
      for (const item of records(items)) {
        let document = documentFrom(item, project);
        if (!document) continue;
        if (item.truncado === true) document = { ...document, text: (await read(connection, document.uri, document.name)).text };
        result.push(document);
      }
      return result;
    };
    return { project, request, requestUri: uri, documents: await fullDocuments(payload.documentos), memories: await fullDocuments(payload.memorias), history: historyFrom(payload.historico, project) };
  }

  async function material(connection: DataCenterTransport, project: string): Promise<DataCenterMaterial> {
    validateProject(project);
    const all = await resources(connection);
    const selected = all.filter((item) => projectOf(item.uri) === project && !historyUri(item.uri));
    if (!selected.length) {
      // Servers with tools but no resources still provide an explicit, structured selection.
      const result = await context(connection, project);
      return { project, request: result.request, requestUri: result.requestUri, documents: [...result.documents, ...result.memories], history: result.history, warnings: [] };
    }
    const uri = requestUri(project);
    let request = '';
    if (selected.some((item) => item.uri === uri)) request = (await read(connection, uri, 'Pedido')).text;
    else {
      try {
        const prompt = await connection.call('prompts/get', { name: project });
        if (record(prompt)) request = records(prompt.messages).filter((message) => message.role === 'user').flatMap((message) => (Array.isArray(message.content) ? records(message.content) : record(message.content) ? [message.content] : [])).map((part) => text(part.text)).filter(Boolean).join('\n\n');
      } catch (error) { if (!(error instanceof DataCenterFault) || error.availability.code !== -32601) throw error; }
    }
    const documents: DataCenterDocument[] = [], warnings: DataCenterAvailability[] = [];
    const candidates = selected.filter((item) => item.uri.startsWith(`capivara://${project}/docs/`));
    const bases = candidates.filter((item) => !candidates.some((parent) => parent.uri !== item.uri && item.uri.startsWith(`${parent.uri}/`)));
    for (const item of bases) {
      try {
        const document = await read(connection, item.uri, item.name);
        const area = /\barea=([a-z]+)/i.exec(item.description ?? '')?.[1]?.toLowerCase();
        if (area) document.area = area;
        const files: DataCenterFile[] = [];
        for (const child of candidates.filter((other) => other.uri.startsWith(`${item.uri}/`))) {
          try {
            const path = child.uri.slice(item.uri.length + 1);
            if (path.includes('\\') || path.split('/').some((segment) => !segment || segment === '.' || segment === '..')) throw invalid('Um arquivo da base contém um caminho relativo inválido.');
            const file = await read(connection, child.uri, child.name);
            files.push({ uri: child.uri, path, ...(file.files?.[0]?.base64 !== undefined ? { base64: file.files[0].base64 } : { text: file.text }), ...(child.mimeType ? { mimeType: child.mimeType } : {}) });
          } catch (error) { warnings.push(availability(error)); }
        }
        if (files.length) document.files = files;
        documents.push(document);
      } catch (error) { warnings.push(availability(error)); }
    }
    return { project, request, requestUri: uri, documents, history: [], warnings };
  }

  return {
    endpointUrl: transport?.endpoint.url ?? '',
    listPrompts: () => run((connection) => prompts(connection)),
    readPrompt: (name) => run((connection) => promptText(connection, name)),
    discoverProjects: () => run(async (connection) => {
      const all = await resources(connection), projects = new Map<string, DataCenterProject>();
      for (const item of all) {
        const slug = projectOf(item.uri);
        if (!slug || slug === 'geral') continue;
        const project = projects.get(slug) ?? { slug, name: slug, hasRequest: false, documents: 0 };
        if (item.uri === requestUri(slug)) { project.hasRequest = true; project.name = item.name.replace(/^pedido\s*[—–-]\s*/i, '') || slug; }
        else if (item.uri.includes('/docs/') && !all.some((parent) => parent.uri !== item.uri && item.uri.startsWith(`${parent.uri}/`))) project.documents += 1;
        projects.set(slug, project);
      }
      return [...projects.values()].sort((a, b) => a.slug.localeCompare(b.slug));
    }),
    listMaterial: (project) => run((connection) => material(connection, project)),
    getContext: (project) => run((connection) => context(connection, project)),
    readDocument: (uri) => run((connection) => read(connection, uri)),
    loadProject: (project) => run(async (connection) => {
      const result = await material(connection, project);
      try { result.history = (await context(connection, project)).history; }
      catch (error) { result.warnings.push(availability(error)); }
      return result;
    }),
  };
}
