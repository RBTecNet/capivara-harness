import { chmod, copyFile, cp, lstat, mkdir, readdir, readFile, readlink, realpath, rename, rm, stat, symlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { EnvironmentNode, WorkUnit } from '../domain/types.js';
import type { BuildIncident, IntegrationTransaction, WorkspaceCheckpoint } from './types.js';
import { digest, inside } from './files.js';
import { captureFiles, createTaskWorkspace, fileDigest, IntegrationConflict, publishIntegration } from './isolation.js';

const installationRoots = ['node_modules', '.venv', 'venv', '.tools', 'tools', '.local', '.deps', '.vendor', 'vendor', '.sdk', '.capivara-tools'];
const manifests = new Set(['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'pyproject.toml', 'poetry.lock', 'uv.lock', 'Pipfile', 'Pipfile.lock', 'requirements.txt', 'Cargo.toml', 'Cargo.lock', 'go.mod', 'go.sum', 'Gemfile', 'Gemfile.lock', 'composer.json', 'composer.lock', 'packages.lock.json', 'nuget.config']);
const forbiddenParts = new Set(['.git', '.capivara-next', '.capivara-runtime', '.capivara-verification', '.project-inputs']);
const cleanPath = (value: string): string | null => {
  const path = value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (!path || path === '.' || isAbsolute(path) || path.split('/').some(part => part === '..' || forbiddenParts.has(part))) return null;
  return path;
};
const installRoot = (path: string): string | undefined => installationRoots.find(root => path === root || path.startsWith(`${root}/`));

/** Descriptive provider paths never grant permission to publish application source. */
export function allowedRecoveryPath(_node: EnvironmentNode, path: string, _provided?: EnvironmentNode['provides']): boolean {
  const normalized = cleanPath(path);
  return normalized !== null && (Boolean(installRoot(normalized)) || manifests.has(basename(normalized)) || /^requirements(?:[.-][^/]+)?\.txt$/.test(basename(normalized)));
}

export function environmentRecoveryOutputs(node: EnvironmentNode): string[] {
  return [...new Set([...installationRoots, ...manifests, ...(node.provides?.paths ?? []), ...(node.provides?.inputs ?? [])].filter(path => allowedRecoveryPath(node, path)))];
}

/** A repair operation is a capability consumer, never a second editor of the product unit. */
export function environmentRecoveryTask(original: WorkUnit, node: EnvironmentNode): WorkUnit {
  return { id: `$environment:${node.id}`, title: `Prepare ${node.name}`, goal: `Make the declared capability ${node.identity?.capability ?? node.name} executable for its consumer.`, instructions: 'Inspect and repair only the selected provider and its local installation. Application changes remain an unintegrated proposal. Return concrete provides bindings, not descriptions of paths or environment values.', requirementIds: [], dependsOn: [], environmentIds: [node.id], contractIds: [], files: environmentRecoveryOutputs(node), inputs: environmentRecoveryOutputs(node), resources: [`environment:${node.id}`], criteria: ['The declared readiness recipe succeeds using the same concrete invocation available to consumers.'], checks: [], risk: 'normal', blockedBy: [] };
}

export function environmentRecoveryContext(node: EnvironmentNode, incidents: readonly Pick<BuildIncident, 'message' | 'evidence'>[]): string {
  return `CAPABILITY TO RECOVER\n${JSON.stringify(node)}\nOBSERVED FAILURES\n${incidents.map(item => `${item.message}\n${item.evidence}`).join('\n')}\nPUBLICATION SCOPE\n${JSON.stringify(environmentRecoveryOutputs(node))}\nOnly dependency manifests, lockfiles and local provider installations can be published. Product source changes are preserved separately and cannot satisfy readiness.`;
}

interface RecoveryCheckpoint extends WorkspaceCheckpoint { recoveryDirectories?: Record<string, string | null>; }

async function directoryFingerprint(workspace: string, name: string): Promise<string | null> {
  const root = inside(workspace, name), entries: unknown[] = [];
  const visit = async (path: string): Promise<void> => {
    const info = await lstat(path);
    const key = relative(root, path).replaceAll('\\', '/');
    if (info.isSymbolicLink()) {
      const target = resolve(dirname(path), await readlink(path)), rel = relative(workspace, target);
      if (rel === '..' || rel.startsWith(`..${sep}`)) {
        const targetInfo = await stat(path);
        if (!targetInfo.isFile()) throw new Error(`Provider installation link escapes its private workspace: ${name}/${key}`);
        entries.push([key, targetInfo.mode & 0o777, digest(await readFile(path))]);
      } else entries.push([key, 'link', relative(dirname(path), target).replaceAll('\\', '/')]);
    }
    else if (info.isDirectory()) { entries.push([key, 'dir', info.mode & 0o777]); for (const entry of (await readdir(path)).sort()) await visit(join(path, entry)); }
    else if (info.isFile()) entries.push([key, info.mode & 0o777, digest(await readFile(path))]);
    else throw new Error(`Provider installation contains a non-file entry: ${name}/${key}`);
  };
  try { await visit(root); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  return digest(JSON.stringify(entries));
}

export async function beginEnvironmentRecovery(workspace: string, node: EnvironmentNode): Promise<WorkspaceCheckpoint> {
  const checkpoint: RecoveryCheckpoint = await createTaskWorkspace(workspace, `$environment:${node.id}`, digest(JSON.stringify(node)), environmentRecoveryOutputs(node));
  checkpoint.recoveryDirectories = {};
  for (const root of installationRoots) checkpoint.recoveryDirectories[root] = await directoryFingerprint(workspace, root);
  return checkpoint;
}

export interface EnvironmentRecoveryPublication {
  transaction: IntegrationTransaction;
  published: string[];
  quarantined: string[];
  directory: string;
  dependencyDirectories: string[];
}

/** The caller holds the shared preparation/integration queue. The complete proposal survives publication. */
export async function commitEnvironmentRecovery(workspace: string, node: EnvironmentNode, checkpoint: WorkspaceCheckpoint, provided?: EnvironmentNode['provides'], onTransaction?: (transaction: IntegrationTransaction) => Promise<void>): Promise<EnvironmentRecoveryPublication> {
  const after = await captureFiles(checkpoint.directory, environmentRecoveryOutputs({ ...node, provides: { ...node.provides, ...provided } }));
  const files: IntegrationTransaction['files'] = [], published: string[] = [], quarantined: string[] = [];
  for (const path of new Set([...Object.keys(checkpoint.base), ...Object.keys(after)])) {
    const before = checkpoint.base[path] ?? null, next = after[path] ?? null;
    if (before === next) continue;
    if (!allowedRecoveryPath(node, path, provided)) { quarantined.push(path); continue; }
    published.push(path);
    if (installRoot(path)) continue; // Preserve installation links and complete directories together.
    const current = await fileDigest(workspace, path);
    if (current !== before && current !== next) throw new IntegrationConflict(path, before, current, next);
    files.push({ path, before, after: next, ...(next !== null ? { mode: (await lstat(inside(checkpoint.directory, path))).mode & 0o777 } : {}) });
  }
  const directories: { root: string; before: string | null; after: string | null }[] = [];
  for (const root of installationRoots) {
    const before = (checkpoint as RecoveryCheckpoint).recoveryDirectories?.[root] ?? null;
    const next = await directoryFingerprint(checkpoint.directory, root);
    if (before === next) continue;
    const current = await directoryFingerprint(workspace, root);
    if (current !== before && current !== next) throw new IntegrationConflict(root, before, current, next);
    directories.push({ root, before, after: next });
  }
  // Stage and validate every installation before touching a manifest or canonical directory.
  const staged: NonNullable<IntegrationTransaction['installations']> = [];
  for (const item of directories) {
    const path = join(workspace, `.capivara-publish-${randomUUID()}`);
    if (item.after !== null) {
      await cp(inside(checkpoint.directory, item.root), path, { recursive: true, mode: constants.COPYFILE_FICLONE, dereference: false, verbatimSymlinks: true, filter: async (source, destination) => {
        const info = await lstat(source);
        if (!info.isSymbolicLink()) return true;
        const target = resolve(dirname(source), await readlink(source));
        const rel = relative(checkpoint.directory, target);
        if (rel === '..' || rel.startsWith(`..${sep}`)) {
          const targetInfo = await stat(source);
          if (!targetInfo.isFile()) throw new Error(`Provider installation link escapes its private workspace: ${relative(checkpoint.directory, source)}`);
          await mkdir(dirname(destination), { recursive: true }); await copyFile(source, destination, constants.COPYFILE_FICLONE); await chmod(destination, targetInfo.mode & 0o777); return false;
        }
        if (isAbsolute(await readlink(source))) { await mkdir(dirname(destination), { recursive: true }); await symlink(relative(dirname(source), target), destination, (await stat(source)).isDirectory() ? 'dir' : 'file'); return false; }
        await realpath(source); return true;
      } });
      if (await directoryFingerprint(workspace, basename(path)) !== item.after) throw new Error(`Provider installation changed while staging: ${item.root}`);
    }
    staged.push({ path: item.root, staged: path, backup: join(workspace, `.capivara-publish-${randomUUID()}`), before: item.before, after: item.after });
  }
  const transaction: IntegrationTransaction = { id: randomUUID(), taskId: `$environment:${node.id}`, workspace: checkpoint.directory, files, phase: 'prepared', installations: staged };
  await onTransaction?.(transaction);
  await resumeEnvironmentRecovery(workspace, transaction);
  return { transaction, published, quarantined, directory: checkpoint.directory, dependencyDirectories: directories.map(item => item.root) };
}

/** Resume a crash between the two directory renames without rerunning an agent or installation. */
export async function resumeEnvironmentRecovery(workspace: string, transaction: IntegrationTransaction): Promise<void> {
  for (const item of transaction.installations ?? []) {
    if (!installationRoots.includes(item.path)) throw new Error(`Invalid provider publication path: ${item.path}`);
    for (const path of [item.staged, item.backup]) if (dirname(resolve(path)) !== resolve(workspace) || !basename(path).startsWith('.capivara-publish-')) throw new Error('Provider publication staging escapes its workspace.');
    const current = await directoryFingerprint(workspace, item.path), backup = await directoryFingerprint(workspace, basename(item.backup));
    if (current === item.after) continue;
    if (current !== item.before && !(current === null && backup === item.before)) throw new IntegrationConflict(item.path, item.before, current, item.after);
    if (item.after !== null && await directoryFingerprint(workspace, basename(item.staged)) !== item.after) throw new Error(`Staged provider installation changed: ${item.path}`);
    if (backup !== null && backup !== item.before) throw new Error(`Provider installation backup changed: ${item.path}`);
  }
  transaction.phase = 'applying';
  await publishIntegration(workspace, transaction);
  for (const item of transaction.installations ?? []) {
    const current = await directoryFingerprint(workspace, item.path);
    if (current === item.after) continue;
    const destination = inside(workspace, item.path);
    if (current !== null) {
      const backup = await directoryFingerprint(workspace, basename(item.backup));
      if (backup !== null) await rm(destination, { recursive: true, force: true });
      else await rename(destination, item.backup);
    }
    if (item.after !== null) await rename(item.staged, destination);
  }
  transaction.phase = 'applied';
  for (const item of transaction.installations ?? []) for (const path of [item.staged, item.backup]) await rm(path, { recursive: true, force: true });
}
