import { chmod, cp, lstat, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';

export interface VerificationWorkspace {
  workspace: string;
  sourceWorkspace: string;
  environment: Record<string, string>;
}

/** Temporary files and tool caches belong to the execution area, not the inspected source tree. */
export async function verificationEnvironment(workspace: string, environment: Record<string, string> = {}): Promise<Record<string, string>> {
  const runtime = join(resolve(workspace), '.capivara-runtime');
  const temporary = join(runtime, 'tmp');
  const cache = join(runtime, 'cache');
  await Promise.all([mkdir(temporary, { recursive: true }), mkdir(cache, { recursive: true })]);
  return { TMPDIR: temporary, TMP: temporary, TEMP: temporary, XDG_CACHE_HOME: cache, npm_config_cache: join(cache, 'npm'), PIP_CACHE_DIR: join(cache, 'pip'), GOCACHE: join(cache, 'go-build'), GRADLE_USER_HOME: join(cache, 'gradle'), DOTNET_CLI_HOME: join(cache, 'dotnet'), ...environment };
}

async function makeWritable(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error('A cópia de verificação contém um link não resolvido; não executar prova com possibilidade de escrita na origem.');
  await chmod(path, (info.mode & 0o777) | (info.isDirectory() ? 0o700 : 0o200));
  if (info.isDirectory()) for (const name of await readdir(path)) await makeWritable(join(path, name));
}

/** Copy-on-execution for direct verification callers; scheduler-owned private areas can use only verificationEnvironment. */
export async function withVerificationWorkspace<T>(source: string, work: (area: VerificationWorkspace) => Promise<T>, options: { signal?: AbortSignal; environment?: Record<string, string>; excludes?: readonly string[] } = {}): Promise<T> {
  options.signal?.throwIfAborted();
  const sourceWorkspace = resolve(source);
  const directory = await mkdtemp(join(tmpdir(), 'capivara-verification-'));
  const workspace = join(directory, 'workspace');
  const excludes = new Set(['.git', ...options.excludes ?? []]);
  try {
    await cp(sourceWorkspace, workspace, { recursive: true, dereference: true, preserveTimestamps: true, filter: path => {
      const rel = relative(sourceWorkspace, path);
      return !rel.split(sep).some(part => excludes.has(part) || part.startsWith('.capivara'));
    } });
    await makeWritable(workspace);
    options.signal?.throwIfAborted();
    const environment = await verificationEnvironment(workspace, options.environment);
    return await work({ workspace, sourceWorkspace, environment });
  } finally { await rm(directory, { recursive: true, force: true }); }
}
