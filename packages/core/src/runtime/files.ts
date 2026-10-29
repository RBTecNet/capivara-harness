import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, readlink, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { ExecutionConstraints } from './types.js';

const IGNORED = new Set(['.git', '.project-inputs', 'node_modules', 'dist', 'target', '.venv', 'venv', '__pycache__', '.next', '.cache']);
export const digest = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex');
const inside = (root: string, path: string): boolean => { const rel = relative(root, path); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)); };

/** Context data is readable independently of product files. It cannot grant
 * access to configuration/state, nor authorize product-tool writes. */
export async function readContextReceipt(root:string,path:string):Promise<string|undefined>{
  const match=path.match(/^\.capivara-verification\/(?:task-data|source-index|recovery)-([a-f0-9]{64})\.json$/);
  if(!match)return undefined;
  const base=await realpath(resolve(root)),folder=resolve(base,'.capivara-verification'),file=resolve(base,path);
  const parent=await lstat(folder),entry=await lstat(file);
  if(!parent.isDirectory()||parent.isSymbolicLink()||!entry.isFile()||entry.isSymbolicLink())throw new Error('The context receipt is not an independent coordinator data file.');
  const bytes=await readFile(file);
  if(digest(bytes)!==match[1])throw new Error('The context receipt no longer matches its recorded identity.');
  return bytes.toString('utf8');
}

/** Resolves the real parent, so a symlink cannot turn a valid-looking project path into an outside write. */
export async function projectPath(root: string, path: string, write = false, constraints?: ExecutionConstraints): Promise<string> {
  if (path.includes('\0')) throw new Error('O caminho contém um byte nulo.');
  const base = await realpath(resolve(root));
  const candidate = resolve(base, path);
  if (!inside(base, candidate)) throw new Error('O caminho deve permanecer dentro do projeto.');
  const rel = relative(base, candidate);
  const first = rel.split(sep)[0] ?? '';
  if (first === '.git' || first.startsWith('.capivara')) throw new Error('Estado de controle do harness não é um arquivo do produto.');
  if (write && (rel === '' || (constraints?.writablePaths && !constraints.writablePaths.some(p => inside(resolve(base, p), candidate))))) {
    throw new Error('A escrita não está dentro dos arquivos autorizados para esta tarefa.');
  }
  let ancestor = candidate;
  for (;;) {
    try {
      const actual = await realpath(ancestor);
      if (!inside(base, actual)) throw new Error('O caminho atravessa um link para fora do projeto.');
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  return candidate;
}

export async function writeProductFile(root: string, path: string, contents: string, constraints?: ExecutionConstraints): Promise<void> {
  const absolute = await projectPath(root, path, true, constraints);
  await mkdir(dirname(absolute), { recursive: true });
  // Resolve once more after mkdir to detect an existing symlink in a newly created path.
  await projectPath(root, path, true, constraints);
  const temporary = `${absolute}.capivara-edit-${randomUUID()}`;
  try {
    const previous = await lstat(absolute).catch(() => null);
    await writeFile(temporary, contents, { flag: 'wx', ...(previous ? { mode: previous.mode & 0o777 } : {}) });
    await rename(temporary, absolute);
  } finally { await rm(temporary, { force: true }).catch(() => undefined); }
}

export async function snapshotWorkspace(root: string, paths?: readonly string[]): Promise<Map<string, string>> {
  const base = resolve(root);
  const entries = new Map<string, string>();
  const visit = async (absolute: string, providerInventory=false): Promise<void> => {
    const rel = relative(base, absolute);
    const info = await lstat(absolute).catch(() => null);
    if (!info) { if (paths) entries.set(rel, 'missing'); return; }
    if (info.isSymbolicLink()) {
      const target=await readlink(absolute);
      if(!providerInventory){entries.set(rel,`link:${target}`);return;}
      const actual=await realpath(absolute).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;});
      if(!actual){entries.set(rel,`link:${target}:missing-target`);return;}
      const targetInfo=await lstat(actual);
      entries.set(rel,targetInfo.isFile()?`link:${target}:file:${targetInfo.mode&0o777}:${digest(await readFile(absolute))}`:`link:${target}:directory`);return;
    }
    if (info.isDirectory()) {
      const names = await readdir(absolute);
      names.sort();
      for (const name of names) {
        if (IGNORED.has(name) || name.startsWith('.capivara') || name.includes('.capivara-edit-')) continue;
        await visit(resolve(absolute, name),providerInventory);
      }
    } else if (info.isFile()) {
      entries.set(rel, digest(await readFile(absolute)));
    }
  };
  if (paths) {
    for (const path of paths) {
      if(path.includes('\0'))throw new Error('O caminho contém um byte nulo.');
      const candidate=resolve(base,path),rel=relative(base,candidate),first=rel.split(sep)[0]??'';
      if(!inside(base,candidate))throw new Error('O caminho deve permanecer dentro do projeto.');
      if(first==='.capivara-tools'){await visit(candidate,true);continue;}
      if(first==='.git'||first.startsWith('.capivara'))throw new Error('Estado de controle do harness não é um arquivo do produto.');
      const actual=await realpath(candidate).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;});
      if(actual&&!inside(base,actual)){
        // A prepared dependency can be shared by private workspaces. This is
        // an exact read fingerprint, not product access or a write permission.
        // Never recursively expand an external directory through this alias.
        if(!(await lstat(actual)).isFile())throw new Error('External read aliases must identify exact files; directory traversal is not a file fingerprint.');
        entries.set(rel,`alias:${actual}:${digest(await readFile(candidate))}`);
      }else await visit(await projectPath(base,path));
    }
  } else await visit(base);
  return entries;
}

export async function workspaceFingerprint(root: string, paths?: readonly string[]): Promise<string> {
  return digest(JSON.stringify([...await snapshotWorkspace(root, paths)].sort(([a], [b]) => a.localeCompare(b))));
}

export function changedPaths(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] {
  return [...new Set([...before.keys(), ...after.keys()])].filter(path => before.get(path) !== after.get(path)).sort();
}

export function scrub(text: string, extraSecrets: readonly string[] = []): string {
  const secrets = [...extraSecrets.filter(Boolean), ...Object.entries(process.env).filter(([key]) => /(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY)/i.test(key)).map(([, value]) => value ?? '').filter(value => value.length >= 8)]
    .sort((a, b) => b.length - a.length);
  let output = text;
  for (const secret of secrets) output = output.split(secret).join('[segredo oculto]');
  return output;
}
