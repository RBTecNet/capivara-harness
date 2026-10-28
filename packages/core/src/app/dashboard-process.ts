import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setPriority } from 'node:os';
import { stdin, stdout } from 'node:process';
import type { Question } from '../domain/types.js';

export interface DashboardProcessOptions {
  workspace: string;
  entrypoint: string;
  cancel: () => void;
  onClose?: () => void;
  onError?: (error: unknown) => void;
}

export interface DashboardProcess {
  readonly active: boolean;
  ask(question: Question): Promise<string | null>;
  close(): Promise<void>;
}

/** Presentation has its own event loop; IPC carries decisions, never project history. */
export function startDashboardProcess(options: DashboardProcessOptions): DashboardProcess {
  let child: ChildProcess | undefined;
  let ready = false, closed = false, exited = false, cancellationSent = false;
  let closing: Promise<void> | undefined;
  const originalRaw = Boolean(stdin.isRaw);
  const pending = new Map<string, { question: Question; resolve: (answer: string | null) => void }>();
  const exitWaiters = new Set<() => void>();
  const report = (error: unknown): void => { try { options.onError?.(error); } catch { /* Presentation cannot throw into the constructor. */ } };
  const restoreTerminal = (): void => {
    if (!stdin.isTTY || !stdout.isTTY) return;
    try { stdin.setRawMode(originalRaw); } catch { /* A terminal may have disappeared. */ }
    try { stdout.write('\u001b[?1000l\u001b[?1006l\u001b[?2004l\u001b[?25h\u001b[0m\u001b[?1049l'); } catch { /* Construction does not depend on terminal cleanup. */ }
  };
  const finish = (): void => {
    if (closed) return;
    closed = true;
    for (const request of pending.values()) request.resolve(null);
    pending.clear();
    try { options.onClose?.(); } catch { /* Observer only. */ }
  };
  const send = (message: object): void => {
    if (!child?.connected) { finish(); return; }
    try {
      child.send(message, error => {
        if (error && !closing && !closed) { report(error); finish(); }
      });
    } catch (error) { if (!closing && !closed) report(error); finish(); }
  };
  const waitForExit = (milliseconds: number): Promise<void> => new Promise(resolve => {
    let timer: ReturnType<typeof setTimeout>;
    const done = (): void => { clearTimeout(timer); exitWaiters.delete(done); resolve(); };
    timer = setTimeout(done, milliseconds); exitWaiters.add(done);
    if (exited) done();
  });
  try {
    child = spawn(process.execPath, [options.entrypoint, 'dashboard', '--project', options.workspace], {
      cwd: options.workspace,
      env: { ...process.env, CAPIVARA_DASHBOARD_CHILD: '1' },
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    });
    if (child.pid) { try { setPriority(child.pid, 10); } catch { /* Lower UI priority is best effort across platforms. */ } }
    child.on('message', message => {
      if (!message || typeof message !== 'object' || !('type' in message)) return;
      const event = message as { type: unknown; id?: unknown; value?: unknown; message?: unknown; error?: unknown };
      if (event.type === 'ready' && !closed && !ready) {
        ready = true;
        for (const [id, request] of pending) send({ type: 'ask', id, question: request.question });
      } else if (event.type === 'answer' && typeof event.id === 'string') {
        const request = pending.get(event.id);
        if (request && (event.value === null || typeof event.value === 'string')) {
          pending.delete(event.id); request.resolve(event.value);
        }
      } else if (event.type === 'cancel' && !closed && !cancellationSent) {
        cancellationSent = true;
        try { options.cancel(); } catch (error) { report(error); }
      } else if (event.type === 'closed') finish();
      else if (event.type === 'error') {
        report(new Error(typeof event.message === 'string' ? event.message : typeof event.error === 'string' ? event.error : 'A interface ficou indisponível.'));
        finish();
      }
    });
    child.once('error', error => { report(error); restoreTerminal(); finish(); });
    child.once('disconnect', () => {
      if (!closed && !closing) { report(new Error('A interface perdeu o canal de decisões.')); restoreTerminal(); finish(); }
    });
    child.once('exit', (code, signal) => {
      exited = true;
      if (!closed && !closing && (code !== 0 || signal)) report(new Error(`O painel encerrou (${signal ?? code ?? 'sem código'}).`));
      if (!closed) restoreTerminal();
      finish();
      for (const waiter of exitWaiters) waiter();
      exitWaiters.clear();
    });
  } catch (error) { exited = true; report(error); finish(); }

  return {
    get active(): boolean { return !closed; },
    ask(question): Promise<string | null> {
      if (closed || closing) return Promise.resolve(null);
      return new Promise(resolve => {
        const id = randomUUID(); pending.set(id, { question, resolve });
        if (ready) send({ type: 'ask', id, question });
      });
    },
    close(): Promise<void> {
      if (closing) return closing;
      closing = (async () => {
        if (!exited && child) {
          send({ type: 'close' });
          finish();
          await waitForExit(500);
          if (!exited) {
            try { child.kill('SIGTERM'); } catch { /* Already gone. */ }
            await waitForExit(100);
            if (!exited) {
              // This handle belongs exclusively to presentation, never the engine or its agents.
              try { child.kill('SIGKILL'); } catch { /* Already gone. */ }
              await waitForExit(100);
            }
            restoreTerminal();
            try { if (child.connected) child.disconnect(); } catch { /* Closed channel. */ }
            child.unref();
          }
        }
        finish();
      })();
      return closing;
    },
  };
}
