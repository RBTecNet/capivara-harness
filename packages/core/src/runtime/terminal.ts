import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { commandIdentity, commandInvocation, emptyCommandResult, incompatibleOperation, quoteArgument, terminateProcess } from './command.js';
import { scrub } from './files.js';
import { isolatedInvocation } from './isolation.js';
import type { CommandResult, TerminalRequest } from './types.js';

interface TerminalHandle {
  write(text: string): void;
  close(): void;
  onData(handler: (text: string) => void): void;
  onExit(handler: (code: number | null, signal: string | null) => void): void;
}
interface PtyModule {
  spawn(binary: string, args: string[], options: { cwd: string; env: Record<string, string>; name: string; cols: number; rows: number }): {
    write(text: string): void;
    kill(signal?: string): void;
    onData(handler: (text: string) => void): unknown;
    onExit(handler: (event: { exitCode: number; signal?: number }) => void): unknown;
  };
}

async function openTerminal(request: TerminalRequest): Promise<TerminalHandle> {
  const command = await isolatedInvocation(request, commandInvocation(request.command));
  const env = Object.fromEntries(Object.entries({ ...process.env, ...command.environment, TERM: request.environment?.TERM ?? 'xterm-256color' }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  const cols = Math.max(20, request.columns ?? 100), rows = Math.max(5, request.rows ?? 30);
  try {
    const moduleName = 'node-pty';
    const pty = await import(moduleName) as unknown as PtyModule;
    const child = pty.spawn(command.binary, command.args, { cwd: request.cwd, env, name: env.TERM ?? 'xterm-256color', cols, rows });
    return {
      write: text => child.write(text), close: () => { try { child.kill(); } catch { /* closed */ } },
      onData: handler => { child.onData(handler); },
      onExit: handler => { child.onExit(event => handler(event.exitCode, event.signal ? String(event.signal) : null)); },
    };
  } catch (error) {
    // Missing native binding is recoverable with a real OS pseudoterminal, never pipes labelled as TUI.
    if (process.platform !== 'linux') throw new Error(`Pseudoterminal nativo indisponível: ${error instanceof Error ? error.message : String(error)}. Instale node-pty ou disponibilize um executor PTY deste sistema.`);
  }
  await access('/usr/bin/script');
  const shellLine = `stty cols ${cols} rows ${rows}; exec ${[command.binary, ...command.args].map(quoteArgument).join(' ')}`;
  const child = spawn('/usr/bin/script', ['-q', '-e', '-f', '-c', shellLine, '/dev/null'], {
    cwd: request.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true, shell: false,
  });
  child.stdin.on('error', () => undefined);
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  let error: Error | undefined;
  let ended = false;
  let exit: { code: number | null; signal: string | null } | undefined;
  const listeners: ((code: number | null, signal: string | null) => void)[] = [];
  child.on('error', cause => { error = cause; });
  child.on('close', (code, signal) => { ended = true; exit = { code, signal }; for (const listener of listeners) listener(code, signal); });
  return {
    write: text => { if (!ended) child.stdin.write(text); },
    close: () => { child.stdin.end(); if (!ended) terminateProcess(child.pid, 'SIGKILL'); },
    onData: handler => { child.stdout.on('data', (data: string) => handler(data)); child.stderr.on('data', (data: string) => handler(data)); },
    onExit: handler => { listeners.push(handler); if (ended && exit) queueMicrotask(() => handler(exit!.code, exit!.signal)); if (error) queueMicrotask(() => handler(null, error!.message)); },
  };
}

/** Runs an actual PTY and checks each expected screen/output transition before accepting its result. */
export async function runTerminal(request: TerminalRequest): Promise<CommandResult> {
  const start = Date.now();
  const result = emptyCommandResult(request);
  if (request.signal?.aborted) return { ...result, cancelled: true };
  const conflict = incompatibleOperation(request.command, request.constraints, request.capabilities);
  if (conflict) return { ...result, issue: conflict, stderr: conflict.message };
  let terminal: TerminalHandle;
  try {
    result.fingerprint = await commandIdentity(request);
    if (request.signal?.aborted) return { ...result, cancelled: true };
    terminal = await openTerminal(request);
    result.terminal = true;
  } catch (error) { return { ...result, durationMs: Date.now() - start, issue: { kind: 'tool', recoverable: true, message: String(error) }, stderr: String(error) }; }
  const limit = request.maxOutputBytes ?? 2 * 1024 * 1024;
  let finished = false;
  let complete: () => void = () => undefined;
  const exited = new Promise<void>(resolve => { complete = resolve; });
  terminal.onData(text => {
    result.stdout = (result.stdout + text).slice(-limit);
    try { request.onOutput?.(scrub(text), 'stdout'); } catch { /* observer isolation */ }
  });
  terminal.onExit((code, signal) => { result.exitCode = code; result.signal = signal; finished = true; complete(); });
  const cancel = (): void => { result.cancelled = true; terminal.close(); complete(); };
  request.signal?.addEventListener('abort', cancel, { once: true });
  if (request.signal?.aborted) cancel();
  const wall = setTimeout(() => { result.timedOut = true; terminal.close(); complete(); }, request.timeoutMs ?? 30_000);
  wall.unref();
  try {
    if (request.input) terminal.write(request.input);
    let cursor = 0;
    for (const step of request.steps ?? []) {
      if (result.cancelled || result.timedOut) break;
      if (step.input !== undefined) {
        if (finished) {
          result.issue = { kind: 'tool', recoverable: true, message: 'O aplicativo encerrou antes de receber a interação solicitada. A execução não verificou este fluxo.' };
          break;
        }
        terminal.write(step.input);
      }
      if (step.waitFor !== undefined) {
        const from = cursor;
        const deadline = Date.now() + (step.timeoutMs ?? 5000);
        while (!result.stdout.slice(from).includes(step.waitFor) && !finished && !result.cancelled && !result.timedOut && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        const found = result.stdout.indexOf(step.waitFor, from);
        if (found < 0) {
          if (!result.cancelled) result.issue = { kind: 'tool', recoverable: true, message: `A interação no terminal não produziu o resultado esperado: ${step.waitFor}` };
          terminal.close();
          break;
        }
        cursor = found + step.waitFor.length;
      }
    }
    if (request.closeInput && !finished && !result.cancelled) terminal.write(request.closeInput);
    if (!result.issue && !result.cancelled) await exited;
  } finally {
    clearTimeout(wall);
    request.signal?.removeEventListener('abort', cancel);
    terminal.close();
    result.stdout = scrub(result.stdout);
    result.durationMs = Date.now() - start;
  }
  return result;
}
