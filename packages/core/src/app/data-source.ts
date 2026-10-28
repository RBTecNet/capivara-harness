import { readFile, mkdir, writeFile, rename, rm, lstat, realpath, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createDataCenterClient, resolveDataCenterEndpoint, validateDataCenterEndpoint } from '../data-center/index.js';
import type { DataCenterEndpoint, DataCenterMaterial, DataCenterResult } from '../data-center/index.js';
import type { SelectedDocument } from '../domain/types.js';
import { projectPath, writeProductFile } from '../runtime/files.js';
import { ProjectStore } from './store.js';
import { readSettings } from './settings.js';
import { RecoverySuspended } from './recovery.js';
import { emitEvent, type ProgressMeasurement } from '../telemetry/progress.js';

export interface DataCenterSelection { url: string; project?: string; prompt?: string; }
export interface SelectedInputAsset {
  uri: string;
  name: string;
  path: string;
  sha256: string;
  /** Immutable bytes stay outside SQLite and recovery snapshots. */
  blob: string;
  binary: boolean;
  mimeType?: string;
}
export interface SelectedProjectInput {
  selection: DataCenterSelection;
  request: string;
  requestUri?: string;
  documents: SelectedDocument[];
  assets?: SelectedInputAsset[];
  fetchedAt: string;
}
const hash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');

function canonicalSelection(selection: DataCenterSelection): DataCenterSelection {
  const url = validateDataCenterEndpoint({ url: selection.url.trim() }).url;
  const project = selection.project?.trim(), prompt = selection.prompt?.trim();
  if (!!project === !!prompt) throw new Error('Escolha um projeto ou um prompt da base documental.');
  return { url, ...(project ? { project } : { prompt: prompt! }) };
}

export async function dataCenterEndpoint(url?: string): Promise<DataCenterEndpoint> {
  const settings = await readSettings();
  const saved = settings.dataCenter;
  const requested = url ? validateDataCenterEndpoint({ url: url.trim() }) : undefined;
  let canonicalSaved: DataCenterEndpoint | undefined;
  try { canonicalSaved = saved ? validateDataCenterEndpoint(saved) : undefined; }
  catch (error) { if (!requested) throw error; }
  const resolved = resolveDataCenterEndpoint(requested && requested.url !== canonicalSaved?.url ? requested : canonicalSaved ?? requested);
  if (!resolved.ok) throw new Error(resolved.availability.message ?? 'A configuração do data-center precisa ser corrigida.');
  if (!resolved.value) throw new Error('Configure o endereço da base documental antes de selecionar um projeto ou prompt.');
  return resolved.value;
}
export function dataCenterValue<T>(result: DataCenterResult<T>): T {
  if (!result.ok) throw new Error(result.availability.message ?? `Data-center: ${result.availability.status}`);
  return result.value;
}

function safeAssetPath(path: string): string {
  if (isAbsolute(path) || /[\\\u0000-\u001f\u007f]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Um anexo selecionado contém um caminho relativo inválido.');
  return path;
}

async function blobDirectory(workspace: string): Promise<string> {
  const store = new ProjectStore(workspace);
  let control: string;
  try { control = await realpath(store.directory); } finally { store.close(); }
  const path = join(control, 'input-blobs');
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('A pasta de cópias dos insumos precisa ser uma pasta real do projeto.');
  return path;
}

async function readBlob(directory: string, name: string): Promise<Buffer> {
  if (!/^[a-f0-9]{64}$/.test(name)) throw new Error('A referência da cópia preservada de um insumo é inválida.');
  const file = await open(join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await file.stat()).isFile()) throw new Error('A cópia preservada de um insumo não é um arquivo.');
    const bytes = await file.readFile();
    if (hash(bytes) !== name) throw new Error('A cópia preservada de um insumo precisa ser recuperada.');
    return bytes;
  } finally { await file.close(); }
}

async function preserveBlob(directory: string, bytes: Buffer): Promise<string> {
  const name = hash(bytes);
  try { await readBlob(directory, name); return name; } catch { /* A fresh remote read can repair a missing or damaged immutable copy. */ }
  const temporary = join(directory, `.${randomUUID()}`);
  try {
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600, flush: true });
    await rename(temporary, join(directory, name));
    try {
      const folder = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { await folder.sync(); } finally { await folder.close(); }
    } catch (error) {
      if (!['EISDIR', 'EPERM', 'EINVAL', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }
  }
  finally { await rm(temporary, { force: true }).catch(() => {}); }
  return name;
}

async function writeInput(workspace: string, path: string, contents: string | Uint8Array): Promise<void> {
  if (!path.startsWith('.project-inputs/')) throw new Error('O caminho de um insumo preservado é inválido.');
  const target = await projectPath(workspace, path, true);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await projectPath(workspace, path, true);
  const temporary = `${target}.${randomUUID()}`;
  try { await writeFile(temporary, contents, { flag: 'wx', mode: 0o600, flush: true }); await rename(temporary, target); }
  finally { await rm(temporary, { force: true }).catch(() => {}); }
}

/** Restore files before publishing the manifest, including binary references after an outage. */
async function publishInput(workspace: string, input: SelectedProjectInput, onProgress?: (progress: ProgressMeasurement) => void): Promise<void> {
  const assets = input.assets ?? (input.documents.length ? undefined : []);
  if (!assets) throw new Error('O cache antigo precisa atualizar seu manifesto de arquivos antes de continuar.');
  const directory = await blobDirectory(workspace);
  const contents: { asset: SelectedInputAsset; bytes: Buffer }[] = [];
  for (const asset of assets) {
    if (asset.blob !== asset.sha256) throw new Error('A cópia preservada de um insumo não corresponde ao manifesto.');
    safeAssetPath(asset.path);
    contents.push({ asset, bytes: await readBlob(directory, asset.blob) });
  }
  emitEvent(onProgress, { id: 'inputs.files', label: 'Arquivos de entrada preparados', completed: 0, total: contents.length, status: contents.length ? 'running' : 'complete', stage: 'init', unit: 'arquivos' });
  for (const [index, { asset, bytes }] of contents.entries()) {
    await writeInput(workspace, asset.path, bytes);
    emitEvent(onProgress, { id: 'inputs.files', label: 'Arquivos de entrada preparados', completed: index + 1, total: contents.length, status: index + 1 === contents.length ? 'complete' : 'running', stage: 'init', unit: 'arquivos' });
  }
  await writeInput(workspace, '.project-inputs/index.json', JSON.stringify(assets.map(({ blob: _blob, ...asset }) => asset), null, 2));
  const ignored = await readFile(join(workspace, '.gitignore'), 'utf8').catch(() => '');
  const lines = new Set(ignored.split(/\r?\n/).map(line => line.trim()));
  const missing = ['.project-inputs/', '.capivara-next/'].filter(line => !lines.has(line));
  if (missing.length) await writeProductFile(workspace, '.gitignore', `${ignored}${ignored && !ignored.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);
}

/** Selected packages retain their relative references; immutable bytes make the manifest recoverable. */
async function prepareMaterial(workspace: string, selection: DataCenterSelection, material: DataCenterMaterial, onProgress?: (progress: ProgressMeasurement) => void): Promise<SelectedProjectInput> {
  if (material.project !== selection.project || material.requestUri !== `capivara://${selection.project}/pedido`) throw new Error('O material recebido pertence a outra seleção da base documental.');
  if (material.warnings.length) throw new Error('A base não conseguiu ler todos os documentos e arquivos selecionados; o material anterior será preservado.');
  const directory = await blobDirectory(workspace);
  const documents: SelectedDocument[] = [], assets: SelectedInputAsset[] = [];
  const paths = new Set<string>();
  const add = async (uri: string, name: string, path: string, bytes: Buffer, binary: boolean, reference: boolean, topics: string[], mimeType?: string): Promise<void> => {
    if (!uri.startsWith(`capivara://${selection.project}/docs/`)) throw new Error('Um documento recebido não pertence ao projeto selecionado.');
    safeAssetPath(path);
    if (paths.has(path)) throw new Error('Dois documentos selecionados usam o mesmo caminho de arquivo.');
    paths.add(path);
    const blob = await preserveBlob(directory, bytes);
    assets.push({ uri, name, path, sha256: blob, blob, binary, ...(mimeType ? { mimeType } : {}) });
    documents.push({ reference: uri, title: name, text: binary ? '' : bytes.toString('utf8'), localPath: path, kind: reference || binary ? 'reference' : 'document', contentHash: blob, ...(topics.length ? { topics } : {}) });
  };
  for (const document of material.documents) {
    const folder = `.project-inputs/${hash(document.uri).slice(0, 20)}/${hash(JSON.stringify(document)).slice(0, 20)}`;
    const topics = document.area ? [document.area] : [];
    const reference = ['skill', 'reference', 'referencia', 'referência', 'example', 'examples', 'exemplo', 'exemplos'].includes(document.kind.toLowerCase());
    await add(document.uri, document.name, `${folder}/${document.kind === 'skill' ? 'SKILL.md' : 'document.md'}`, Buffer.from(document.text), false, reference, topics);
    for (const file of document.files ?? []) {
      const path = `${folder}/${safeAssetPath(file.path)}`;
      if (file.text !== undefined) await add(file.uri, file.path, path, Buffer.from(file.text), false, true, topics, file.mimeType);
      else if (file.base64 !== undefined) {
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64)) throw new Error('Um anexo selecionado contém dados binários inválidos.');
        await add(file.uri, file.path, path, Buffer.from(file.base64, 'base64'), true, true, topics, file.mimeType);
      } else throw new Error('Um anexo selecionado não contém seus dados.');
    }
  }
  const input: SelectedProjectInput = { selection, request: material.request, requestUri: material.requestUri, documents, assets, fetchedAt: new Date().toISOString() };
  await publishInput(workspace, input, onProgress);
  return input;
}

/** A selected base is a recoverable input source, not a verdict about generated product quality. */
export async function loadProjectInput(options: {
  workspace: string; selection: DataCenterSelection; cached?: SelectedProjectInput;
  signal: AbortSignal; announce: (message: string) => void;
  onProgress?: (progress: ProgressMeasurement) => void;
}): Promise<SelectedProjectInput> {
  const selection = canonicalSelection(options.selection);
  let cached: SelectedProjectInput | undefined;
  if (options.cached) {
    try {
      const previous = canonicalSelection(options.cached.selection);
      if (previous.url === selection.url && previous.project === selection.project && previous.prompt === selection.prompt && options.cached.request.trim()) cached = { ...options.cached, selection };
    } catch { /* A cache from another or malformed selection cannot supply this request. */ }
  }
  const announce = (message: string): void => { try { options.announce(message); } catch { /* Observation cannot discard preserved input. */ } };
  {
    if (options.signal.aborted) throw options.signal.reason;
    emitEvent(options.onProgress, { id: 'inputs.source', label: 'Leitura da base documental', status: 'running', stage: 'init' });
    try {
      const endpoint = await dataCenterEndpoint(selection.url);
      const client = createDataCenterClient(endpoint, { signal: options.signal });
      let input: SelectedProjectInput;
      if (selection.project) {
        // Context history is auxiliary. Every selected document must be read before replacing a complete cache.
        const material = dataCenterValue(await client.listMaterial(selection.project));
        if (!material.request.trim()) throw new Error('O projeto selecionado ainda não possui pedido.');
        input = await prepareMaterial(options.workspace, selection, material, options.onProgress);
      } else {
        const request = dataCenterValue(await client.readPrompt(selection.prompt!));
        if (!request.trim()) throw new Error('O prompt selecionado está vazio.');
        input = { selection, request, documents: [], assets: [], fetchedAt: new Date().toISOString() };
        await publishInput(options.workspace, input, options.onProgress);
      }
      const store = new ProjectStore(options.workspace);
      try { store.update({ dataCenter: input }); } finally { store.close(); }
      announce(`Base documental carregada: ${selection.project ?? selection.prompt}; ${input.documents.filter(document => document.kind !== 'reference').length} documento(s) e ${input.documents.filter(document => document.kind === 'reference').length} referência(s) selecionada(s).`);
      emitEvent(options.onProgress, { id: 'inputs.source', label: 'Base documental carregada', completed: 1, total: 1, status: 'complete', stage: 'init', unit: 'origens' });
      return input;
    } catch (error) {
      if (options.signal.aborted) throw error;
      emitEvent(options.onProgress, { id: 'inputs.source', label: 'Recuperando acesso à base documental', status: 'waiting', stage: 'init' });
      if (cached) {
        try {
          await publishInput(options.workspace, cached, options.onProgress);
          announce('Base temporariamente indisponível; continuando com os materiais completos da mesma seleção já preservados neste projeto.');
          emitEvent(options.onProgress, { id: 'inputs.source', label: 'Materiais preservados disponíveis', completed: 1, total: 1, status: 'complete', stage: 'init', unit: 'origens' });
          return cached;
        } catch { announce('A cópia dos insumos também precisa ser recuperada; aguardando a base sem substituir o material preservado.'); }
      }
      const message = `Base documental indisponível e sem cópia completa utilizável: ${error instanceof Error ? error.message : String(error)}. Corrija a conexão ou disponibilize os insumos; nada foi substituído.`;
      announce(message);
      throw new RecoverySuspended(message, 1, error);
    }
  }
}
