import { cp, mkdir, readFile, writeFile, rename, unlink, lstat, realpath, chmod, stat, readdir, readlink, symlink, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname, relative, resolve, sep, matchesGlob } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest, inside, sourceFiles } from './files.js';
import type { IntegrationTransaction, WorkspaceCheckpoint } from './types.js';

/** FIFO: integrations and snapshots cannot starve behind newly launched workers. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

export async function fileDigest(workspace: string, path: string): Promise<string | null> {
  const absolute = inside(workspace, path);
  return Promise.all([readFile(absolute), stat(absolute)]).then(([bytes, info]) => digest(JSON.stringify({ content: digest(bytes), mode: info.mode & 0o777 }))).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
}
export async function captureFiles(workspace: string, outputs: readonly string[] = []): Promise<Record<string, string>> {
  const paths = new Set([...await sourceFiles(workspace), ...await sourceFiles(workspace, outputs)]);
  const result: Record<string, string> = {};
  for (const path of paths) {
    const actual = relative(resolve(workspace), await realpath(inside(workspace, path))).replaceAll('\\', '/');
    const canonical = actual === '..' || actual.startsWith('../') ? path : actual;
    const hash = await fileDigest(workspace, canonical); if (hash !== null) result[canonical] = hash;
  }
  return result;
}

export async function createTaskWorkspace(workspace: string, taskId: string, taskHash: string, outputs: readonly string[]): Promise<WorkspaceCheckpoint> {
  const directory = join(workspace, '.capivara-next', 'workspaces', `${digest(taskId).slice(0, 12)}-${randomUUID()}`, 'product');
  await mkdir(directory, { recursive: true });
  for (const entry of await readdir(workspace)) {
    if (entry === '.git' || entry === '.capivara-next' || entry === '.capivara-runtime' || entry === '.capivara-verification' || entry.startsWith('.capivara-publish-')) continue;
    await cp(join(workspace, entry), join(directory, entry), {
    recursive: true, mode: constants.COPYFILE_FICLONE, dereference: false, verbatimSymlinks: true,
    filter: async (path, destination) => {
      const rel = relative(workspace, path);
      if (rel.split(sep).some(part => part === '.git' || part === '.capivara-next' || part === '.capivara-runtime' || part === '.capivara-verification' || part.startsWith('.capivara-publish-'))) return false;
      if ((await lstat(path)).isSymbolicLink()) {
        const target = relative(workspace, resolve(dirname(path), await readlink(path)));
        const outside = target === '..' || target.startsWith(`..${sep}`);
        await mkdir(dirname(destination), { recursive: true });
        if (outside) {
          const info = await stat(path).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;});
          if(!info){if(rel.split(sep)[0]!=='.capivara-tools')throw new Error(`External product link has no readable isolated target: ${rel}`);await symlink(await readlink(path),destination,'file');return false;}
          if (!info.isFile()) throw new Error(`Isolation cannot safely clone an external directory symlink: ${rel}`);
          await copyFile(path, destination, constants.COPYFILE_FICLONE); await chmod(destination, info.mode & 0o777);
        } else {
          // Preserve module identity, including monorepo aliases; absolute internal links become private relative links.
          const targetInCopy = join(directory, target);
          const info = await stat(path).catch(() => null);
          await symlink(relative(dirname(destination), targetInCopy), destination, info?.isDirectory() ? 'dir' : 'file');
        }
        return false;
      }
      return true;
    },
    });
  }
  return { directory, base: await captureFiles(directory, outputs), phase: 'editing', taskHash };
}

/** Incorporate newly published prerequisites without discarding private work.
 * A file edited on both sides requires reconciliation, never overwrite. */
export async function refreshWorkspaceInputs(workspace:string,checkpoint:WorkspaceCheckpoint,paths:readonly string[]):Promise<string[]>{
  const changed:string[]=[];
  const selected=new Set([...await sourceFiles(workspace,paths),...Object.keys(checkpoint.base).filter(path=>paths.some(scope=>scope==='.'||path===scope||path.startsWith(scope.replace(/\/$/,'')+'/')||matchesGlob(path,scope)))]);
  for(const path of selected){
    const baseline=checkpoint.base[path]??null,current=await fileDigest(workspace,path),local=await fileDigest(checkpoint.directory,path);
    if(current===baseline)continue;
    if(local!==baseline&&local!==current)throw new IntegrationConflict(path,baseline,current,local);
    if(local!==current){
      await safePublicationPath(checkpoint.directory,path);
      const target=inside(checkpoint.directory,path),info=await lstat(target).catch(()=>null);
      if(info&&!info.isFile())throw new Error(`A required input cannot replace a non-file private entry: ${path}`);
      if(current===null)await unlink(target);
      else{
        const source=await safePublicationPath(workspace,path),sourceInfo=await lstat(source);
        if(!sourceInfo.isFile())throw new Error(`A required published input must be an independent file: ${path}`);
        await mkdir(dirname(target),{recursive:true});await copyFile(source,target);await chmod(target,sourceInfo.mode&0o777);
        if(await fileDigest(checkpoint.directory,path)!==current||await fileDigest(workspace,path)!==current)throw new IntegrationConflict(path,baseline,await fileDigest(workspace,path),await fileDigest(checkpoint.directory,path));
      }
      changed.push(path);
    }
    if(current!==null)checkpoint.base[path]=current;else delete checkpoint.base[path];
  }
  return changed;
}

/** Prepare a durable write set; no canonical file is modified here. */
export async function prepareIntegration(workspace: string, taskId: string, checkpoint: WorkspaceCheckpoint, outputs: readonly string[]): Promise<IntegrationTransaction> {
  const after = await captureFiles(checkpoint.directory, outputs);
  const files: IntegrationTransaction['files'] = [];
  for (const path of new Set([...Object.keys(checkpoint.base), ...Object.keys(after)])) {
    const before = checkpoint.base[path] ?? null, next = after[path] ?? null;
    if (before === next) continue;
    const current = await fileDigest(workspace, path);
    if (current !== before && current !== next) throw new IntegrationConflict(path, before, current, next);
    files.push({ path, before, after: next, ...(next !== null ? { mode: (await lstat(inside(checkpoint.directory, path))).mode & 0o777 } : {}) });
  }
  return { id: randomUUID(), taskId, workspace: checkpoint.directory, files, phase: 'prepared' };
}
export class IntegrationConflict extends Error {
  constructor(readonly path: string, readonly before: string | null, readonly current: string | null, readonly proposed: string | null) {
    super(`Integration conflict in ${path}; canonical and isolated work are both preserved.`);
  }
}

async function safePublicationPath(workspace: string, path: string): Promise<string> {
  const destination = inside(workspace, path);
  const parents = relative(resolve(workspace), dirname(destination)).split(sep).filter(Boolean);
  let current = resolve(workspace);
  for (const part of parents) {
    current = join(current, part);
    const info = await lstat(current).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; });
    if (info?.isSymbolicLink()) throw new Error(`Publication refuses a directory symlink: ${relative(workspace, current)}`);
    if (info && !info.isDirectory()) throw new Error(`Publication parent is not a directory: ${relative(workspace, current)}`);
  }
  return destination;
}

/** Idempotent after a crash: an already published after-image is never applied twice. */
export async function publishIntegration(workspace: string, transaction: IntegrationTransaction): Promise<void> {
  // Validate the complete transaction before writing its first path.
  for (const file of transaction.files) {
    await safePublicationPath(workspace, file.path);
    const current = await fileDigest(workspace, file.path);
    if (current !== file.before && current !== file.after) throw new IntegrationConflict(file.path, file.before, current, file.after);
    if (file.after !== null && await fileDigest(transaction.workspace, file.path) !== file.after) throw new Error(`The staged file changed after integration preparation: ${file.path}`);
  }
  for (const file of transaction.files) {
    const current = await fileDigest(workspace, file.path);
    if (current === file.after) continue;
    if (current !== file.before) throw new IntegrationConflict(file.path, file.before, current, file.after);
    const destination = await safePublicationPath(workspace, file.path);
    await mkdir(dirname(destination), { recursive: true });
    await safePublicationPath(workspace, file.path);
    if (file.after === null) await unlink(destination).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
    else {
      const bytes = await readFile(inside(transaction.workspace, file.path));
      const mode = (await stat(inside(transaction.workspace, file.path))).mode & 0o777;
      if (digest(JSON.stringify({ content: digest(bytes), mode })) !== file.after) throw new Error(`The staged file changed after integration preparation: ${file.path}`);
      const temporary = join(dirname(destination), `.capivara-publish-${transaction.id}`);
      await writeFile(temporary, bytes, { flush: true });
      if (file.mode !== undefined) await chmod(temporary, file.mode);
      await rename(temporary, destination);
    }
  }
}

const prefix = (path: string): string => path.replaceAll('\\', '/').replace(/^\.\//, '').split(/[*?{[]/, 1)[0]!.replace(/\/$/, '');
export function pathScopesConflict(left: string, right: string): boolean {
  const a = prefix(left), b = prefix(right);
  return !a || !b || a === '.' || b === '.' || a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}
