import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { CommandRequest } from './types.js';

let sandboxProbe: Promise<boolean> | undefined;
async function available(): Promise<boolean> {
  sandboxProbe ??= new Promise(resolveProbe => {
    if (process.platform !== 'linux') { resolveProbe(false); return; }
    const probe = spawn('/usr/bin/bwrap', ['--ro-bind', '/', '/', '--proc', '/proc', '--dev', '/dev', '--unshare-pid', '--die-with-parent', '/bin/true'], { stdio: 'ignore' });
    probe.once('error', () => resolveProbe(false)); probe.once('close', code => resolveProbe(code === 0));
  });
  return sandboxProbe;
}

export async function isolatedInvocation(request: CommandRequest, invocation: { binary: string; args: string[] }): Promise<{ binary: string; args: string[]; environment: Record<string, string>; isolated: boolean }> {
  const environment = { ...request.environment };
  if (!request.isolateWorkspace || request.constraints?.allowSystemInstall === true || !(await available())) return { ...invocation, environment, isolated: false };
  const cwd = resolve(request.cwd);
  const control = join(cwd, '.capivara-next');
  const cache = join(control, 'runtime-cache');
  await mkdir(cache, { recursive: true });
  return {
    binary: '/usr/bin/bwrap',
    args: ['--ro-bind', '/', '/', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--bind', cwd, cwd, '--unshare-pid', '--die-with-parent', '--tmpfs', control, '--bind', cache, cache, '--chdir', cwd, '--', invocation.binary, ...invocation.args],
    environment: { XDG_CACHE_HOME: cache, npm_config_cache: join(cache, 'npm'), PIP_CACHE_DIR: join(cache, 'pip'), CARGO_HOME: join(cache, 'cargo'), GOCACHE: join(cache, 'go-build'), GOPATH: join(cache, 'go'), GRADLE_USER_HOME: join(cache, 'gradle'), NUGET_PACKAGES: join(cache, 'nuget'), DOTNET_CLI_HOME: join(cache, 'dotnet'), ...environment },
    isolated: true,
  };
}

export async function workspaceIsolationAvailable(): Promise<boolean> { return available(); }
