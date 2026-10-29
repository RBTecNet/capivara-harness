import { cp, lstat, mkdir, realpath, rename, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { IntegrationTransaction } from './types.js';
import { inside } from './files.js';
import { providerDirectoryFingerprint, publishedToolInstallationRoots } from './recovery-scope.js';

export interface ProviderSynchronization {
  synchronized: { path: string; generation: string | null; backup?: string }[];
  retained: { path: string; reason: string }[];
}
export class ProviderSynchronizationError extends Error {
  readonly kind = 'environment';
  constructor(readonly path: string, message: string) { super(message); }
}

/** Bring a retained workspace to an actually applied tool generation. The caller
 * holds the same publication queue as environment preparation. Application files,
 * manifests and package-manager inventories never enter this synchronization. */
export async function synchronizePublishedInstallations(canonical: string, workspace: string, transactions: readonly IntegrationTransaction[], protectedPaths: readonly string[] = []): Promise<ProviderSynchronization> {
  const result: ProviderSynchronization = { synchronized: [], retained: [] };
  if (resolve(canonical) === resolve(workspace)) return result;
  type Installation = NonNullable<IntegrationTransaction['installations']>[number];
  const latest = new Map<string, Installation>(), generations = new Map<string, Set<string | null>>();
  for (const transaction of transactions) if (transaction.phase === 'applied') for (const installation of transaction.installations ?? []) {
    if (!publishedToolInstallationRoots.includes(installation.path)) { result.retained.push({ path: installation.path, reason: 'Project-scoped dependency inventory stays with its manifest fork.' }); continue; }
    latest.set(installation.path, installation);
    const known = generations.get(installation.path) ?? new Set<string | null>(); known.add(installation.before); known.add(installation.after); generations.set(installation.path, known);
  }
  for (const [path, installation] of latest) {
    const current = await providerDirectoryFingerprint(workspace, path);
    if (current === installation.after) continue;
    if (protectedPaths.some(file => file.replaceAll('\\','/') === path || file.replaceAll('\\','/').startsWith(`${path}/`))) { result.retained.push({ path, reason: 'This workspace has recorded product edits inside the installation scope.' }); continue; }
    const managed = path.startsWith('.capivara-');
    if (!managed && current !== null && !generations.get(path)?.has(current)) { result.retained.push({ path, reason: 'Private tool changes do not match any published generation; they remain preserved.' }); continue; }
    if (await providerDirectoryFingerprint(canonical, path) !== installation.after) { result.retained.push({ path, reason: 'Canonical installation no longer matches its applied receipt; revalidate the provider before synchronization.' }); continue; }
    const control = join(workspace, '.capivara-next');
    const directory = join(control, 'provider-sync'), base = await realpath(resolve(workspace));
    for (const parent of [control, directory]) {
      let info = await lstat(parent).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; });
      if (!info) { await mkdir(parent); info = await lstat(parent); }
      const actual = await realpath(parent), rel = relative(base, actual);
      if (!info.isDirectory() || info.isSymbolicLink() || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new ProviderSynchronizationError(path, 'Provider synchronization parent is not a real private directory.');
    }
    const token = randomUUID(), staging = join(directory, `${token}.staged`), backup = join(directory, `${token}.previous`);
    if (installation.after !== null) {
      await cp(inside(canonical, path), staging, { recursive: true, mode: constants.COPYFILE_FICLONE, dereference: false, verbatimSymlinks: true });
      if (await providerDirectoryFingerprint(workspace, relative(workspace, staging)) !== installation.after || await providerDirectoryFingerprint(canonical, path) !== installation.after) {
        await rm(staging, { recursive: true, force: true });
        throw new ProviderSynchronizationError(path, 'The published provider changed during synchronization; the private generation was preserved.');
      }
    }
    const destination = inside(workspace, path), previous = await lstat(destination).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; });
    if (previous) await rename(destination, backup);
    try { if (installation.after !== null) await rename(staging, destination); }
    catch (error) { if (previous) await rename(backup, destination); throw error; }
    result.synchronized.push({ path, generation: installation.after, ...(previous ? { backup } : {}) });
  }
  return result;
}
