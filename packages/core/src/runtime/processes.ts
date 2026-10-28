import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { commandInvocation, incompatibleOperation, terminateProcess } from './command.js';
import { scrub } from './files.js';
import { isolatedInvocation } from './isolation.js';
import type { CommandRequest } from './types.js';

interface ManagedProcess { process: ChildProcessWithoutNullStreams; stdout: string; stderr: string; exitCode: number | null; exited: boolean; started: number; secrets: string[] }
const processes = new Map<string, ManagedProcess>();

export async function startProcess(request: CommandRequest): Promise<{ id?: string; error?: string }> {
  if (request.signal?.aborted) return { error: 'A execução foi cancelada antes de iniciar.' };
  const conflict = incompatibleOperation(request.command, request.constraints, request.capabilities);
  if (conflict) return { error: conflict.message };
  const invocation = await isolatedInvocation(request, commandInvocation(request.command));
  if (request.signal?.aborted) return { error: 'A execução foi cancelada antes de iniciar.' };
  const child = spawn(invocation.binary, invocation.args, { cwd: request.cwd, env: { ...process.env, ...invocation.environment }, stdio: ['pipe', 'pipe', 'pipe'], shell: false, detached: process.platform !== 'win32', windowsHide: true });
  const id = randomUUID();
  const secrets = Object.entries(request.environment ?? {}).filter(([key]) => /TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY/i.test(key)).map(([, value]) => value);
  const entry: ManagedProcess = { process: child, stdout: '', stderr: '', exitCode: null, exited: false, started: Date.now(), secrets };
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (data: string) => { entry.stdout = (entry.stdout + data).slice(-128_000); });
  child.stderr.on('data', (data: string) => { entry.stderr = (entry.stderr + data).slice(-128_000); });
  child.stdin.on('error', () => undefined);
  child.on('error', error => { entry.stderr += error.message; entry.exited = true; });
  const cancel = (): void => { terminateProcess(child.pid, 'SIGKILL'); };
  request.signal?.addEventListener('abort', cancel, { once: true });
  if (request.signal?.aborted) cancel();
  child.on('close', code => { entry.exitCode = code; entry.exited = true; request.signal?.removeEventListener('abort', cancel); });
  processes.set(id, entry);
  return { id };
}

export function readProcess(id: string, input?: string): object {
  const entry = processes.get(id);
  if (!entry) return { error: 'Processo desconhecido nesta sessão.' };
  if (input !== undefined && !entry.exited) entry.process.stdin.write(input);
  return { id, running: !entry.exited, exitCode: entry.exitCode, stdout: scrub(entry.stdout, entry.secrets), stderr: scrub(entry.stderr, entry.secrets), durationMs: Date.now() - entry.started };
}

export function stopProcess(id: string): object {
  const entry = processes.get(id);
  if (!entry) return { error: 'Processo desconhecido nesta sessão.' };
  if (!entry.exited) terminateProcess(entry.process.pid, 'SIGKILL');
  processes.delete(id);
  return { id, stopped: true };
}

export function closeProcesses(ids?: readonly string[]): void {
  for (const id of ids ?? [...processes.keys()]) stopProcess(id);
}
