import { spawn } from 'node:child_process';
import { resolve, basename } from 'node:path';
import { digest, scrub, workspaceFingerprint } from './files.js';
import { executionRestriction, isolatedInvocation } from './isolation.js';
import type { CommandRequest, CommandResult, ExecutionConstraints, RuntimeIssue } from './types.js';

export function commandText(command: string | readonly string[]): string {
  return typeof command === 'string' ? command : command.map(quoteArgument).join(' ');
}
export function quoteArgument(value: string): string { return `'${value.replace(/'/g, `'\\''`)}'`; }

export function commandInvocation(command: string | readonly string[]): { binary: string; args: string[] } {
  if (typeof command !== 'string') {
    if (!command[0]) throw new Error('O comando não pode estar vazio.');
    return { binary: command[0], args: [...command.slice(1)] };
  }
  if (!command.trim()) throw new Error('O comando não pode estar vazio.');
  return process.platform === 'win32'
    ? { binary: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', command] }
    : { binary: '/bin/sh', args: ['-c', command] };
}

/** Only definite excluded capabilities are rejected. A rejection is recoverable by choosing the right instrument. */
export function incompatibleOperation(command: string | readonly string[], constraints?: ExecutionConstraints, capabilities: readonly string[] = []): RuntimeIssue | undefined {
  const forbidden = new Set(constraints?.forbiddenCapabilities ?? []);
  const declared = capabilities.find(capability => forbidden.has(capability));
  const raw = typeof command === 'string' ? command.match(/"(?:\\.|[^"\\])*"|'[^']*'|&&|\|\||[;|]|[^\s;|]+/g) ?? [] : [...command];
  const commands: string[][] = [[]];
  for (const token of raw) {
    if (typeof command === 'string' && /^(?:&&|\|\||;|\|)$/.test(token)) commands.push([]);
    else commands.at(-1)!.push(token.replace(/^(['"])(.*)\1$/s, '$2').toLowerCase());
  }
  const executable = commands.map(tokens => {
    while (tokens[0] && /^[a-z_][a-z_\d]*=/.test(tokens[0])) tokens.shift();
    if (tokens[0] && /^(?:npx|pnpx|bunx)(?:\.cmd)?$/.test(basename(tokens[0]))) {
      tokens.shift(); while (tokens[0]?.startsWith('-')) tokens.shift();
    }
    return { name: basename(tokens[0] ?? '').replace(/\.(?:cmd|exe)$/, ''), args: tokens.slice(1) };
  });
  const browser = ['browser', 'web-browser'].some(c => forbidden.has(c)) && executable.some(value => ['playwright', 'puppeteer', 'selenium'].includes(value.name));
  const server = ['http-server', 'web-server', 'server'].some(c => forbidden.has(c)) && executable.some(value =>
    ['http-server', 'serve', 'uvicorn', 'gunicorn'].includes(value.name) || /^python[\d.]*$/.test(value.name) && value.args[0] === '-m' && value.args[1] === 'http.server' || ['vite', 'next', 'webpack'].includes(value.name) && ['dev', 'start', 'serve'].includes(value.args[0] ?? ''));
  const system = constraints?.allowSystemInstall === false && executable.some(value => value.name === 'sudo' || ['apt', 'apt-get', 'dnf', 'yum', 'pacman', 'brew', 'winget', 'choco'].includes(value.name) && ['install', 'add', 'upgrade'].includes(value.args[0] ?? ''));
  if (!declared && !browser && !server && !system) return undefined;
  return { kind: 'constraint', recoverable: true, message: system
    ? 'Esta ação tenta alterar o sistema sem autorização. Use uma instalação local/isolada ou outra receita disponível.'
    : `O instrumento exige uma capacidade excluída pelo produto${declared ? ` (${declared})` : ''}. Corrija a receita de verificação; não modifique o produto para satisfazê-la.` };
}

export function terminateProcess(pid: number | undefined, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      killer.on('error', () => undefined);
    } else process.kill(-pid, signal);
  } catch { try { process.kill(pid, signal); } catch { /* process already gone */ } }
}

export async function commandIdentity(request: CommandRequest): Promise<string> {
  const tree = await workspaceFingerprint(request.cwd, request.inputs);
  return digest(JSON.stringify({ command: request.command, cwd: resolve(request.cwd), node: process.version, platform: process.platform, environment: request.environment ?? {}, tree }));
}

export function emptyCommandResult(request: CommandRequest, fingerprint = ''): CommandResult {
  return { command: commandText(request.command), cwd: resolve(request.cwd), exitCode: null, stdout: '', stderr: '', durationMs: 0, timedOut: false, cancelled: false, signal: null, fingerprint };
}

/** Shell-free spawn; string commands explicitly select the host shell. All failures return evidence to recovery. */
export async function executeCommand(request: CommandRequest): Promise<CommandResult> {
  const start = Date.now();
  const secrets = Object.entries(request.environment ?? {}).filter(([key]) => /TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY/i.test(key)).map(([, value]) => value);
  const result = emptyCommandResult(request);
  if (request.signal?.aborted) return { ...result, cancelled: true };
  const issue = incompatibleOperation(request.command, request.constraints, request.capabilities);
  if (issue) return { ...result, issue, stderr: issue.message };
  try { result.fingerprint = await commandIdentity(request); }
  catch (error) { return { ...result, durationMs: Date.now() - start, issue: { kind: 'tool', recoverable: true, message: String(error) }, stderr: String(error) }; }
  if (request.signal?.aborted) return { ...result, cancelled: true, durationMs: Date.now() - start };
  let invocation: { binary: string; args: string[]; environment: Record<string, string>; isolated: boolean };
  try { invocation = await isolatedInvocation(request, commandInvocation(request.command)); }
  catch (error) { return { ...result, stderr: String(error), issue: { kind: 'tool', recoverable: true, message: String(error) } }; }
  return new Promise<CommandResult>(resolveResult => {
    let bytes = 0;
    let closed = false;
    let truncated = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const maximum = request.maxOutputBytes ?? 2 * 1024 * 1024;
    const child = spawn(invocation.binary, invocation.args, {
      cwd: request.cwd, env: { ...process.env, ...invocation.environment }, shell: false,
      windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
    });
    const append = (buffer: Buffer | string, stream: 'stdout' | 'stderr'): void => {
      const text = String(buffer);
      bytes += Buffer.byteLength(text);
      result[stream] += text;
      if (Buffer.byteLength(result[stream]) > maximum) { result[stream] = result[stream].slice(-Math.max(1, Math.floor(maximum / 2))); truncated = true; }
      try { request.onOutput?.(scrub(text, secrets), stream); } catch { /* observing cannot terminate the command */ }
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (buffer: string) => append(buffer, 'stdout'));
    child.stderr.on('data', (buffer: string) => append(buffer, 'stderr'));
    child.stdin.on('error', () => undefined);
    const finish = (): void => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      request.signal?.removeEventListener('abort', cancel);
      result.durationMs = Date.now() - start;
      result.stdout = scrub(result.stdout, secrets);
      result.stderr = scrub(result.stderr, secrets);
      const restriction = executionRestriction(request, result, invocation.isolated);
      if (!result.issue && restriction) result.issue = restriction;
      if (truncated) {
        result.stderr += `\nSaída extensa: guardada a cauda; ${bytes} bytes recebidos.`;
        result.issue ??= { kind: 'output-limit', recoverable: true, message: 'A saída da ferramenta excedeu o buffer; use uma consulta focada para o trecho necessário.' };
      }
      resolveResult(result);
    };
    const stop = (): void => {
      terminateProcess(child.pid);
      killTimer = setTimeout(() => terminateProcess(child.pid, 'SIGKILL'), 1000);
      killTimer.unref();
    };
    const cancel = (): void => { result.cancelled = true; stop(); };
    const timer = setTimeout(() => { result.timedOut = true; stop(); }, request.timeoutMs ?? 120_000);
    timer.unref();
    request.signal?.addEventListener('abort', cancel, { once: true });
    if (request.signal?.aborted) cancel();
    child.on('error', error => { result.stderr += error.message; result.issue = { kind: 'tool', recoverable: true, message: error.message }; finish(); });
    child.on('close', (code, signal) => { result.exitCode = code; result.signal = signal; finish(); });
    child.stdin.end(request.input ?? '');
  });
}
