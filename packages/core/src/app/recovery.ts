import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';

export class Cancelled extends Error { constructor() { super('Execução interrompida pelo usuário; trabalho preservado.'); this.name = 'Cancelled'; } }
export class RecoverySuspended extends Error {
  readonly fingerprint: string;
  readonly kind = 'no-progress';
  constructor(message: string, readonly attempts: number, readonly lastFailure: unknown) {
    super(message, { cause: lastFailure }); this.name = 'RecoverySuspended';
    this.fingerprint = createHash('sha256').update(String(lastFailure)).digest('hex');
  }
}

export async function waitForRecovery(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Cancelled();
  try { await delay(milliseconds, undefined, signal ? { signal } : {}); }
  catch { throw new Cancelled(); }
}

/** Repetition needs an observable change. Waiting and nested retry loops cannot manufacture progress. */
export async function recoverOperation<T>(operation: () => Promise<T>, options: {
  signal?: AbortSignal;
  announce: (message: string) => void;
  recover?: (error: unknown, attempt: number) => Promise<void | boolean>;
  progressKey?: () => string | Promise<string>;
  classifyCritical?: (error: unknown) => string | undefined;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
}): Promise<T> {
  let attempt = 0;
  const seen = new Set<string>();
  for (;;) {
    if (options.signal?.aborted) throw new Cancelled();
    const before = await options.progressKey?.();
    try { return await operation(); }
    catch (error) {
      if (options.signal?.aborted || error instanceof Cancelled) throw new Cancelled();
      const critical = options.classifyCritical?.(error);
      if (critical) throw new Error(critical, { cause: error });
      attempt++;
      options.announce(`Recuperando: ${error instanceof Error ? error.message : String(error)}`);
      const changed = await options.recover?.(error, attempt);
      const after = await options.progressKey?.();
      const signature = `${String(error)}:${after ?? ''}`;
      if (seen.has(signature) || !(changed === true || before !== after)) {
        throw new RecoverySuspended(`Recuperação suspensa: nenhuma mudança executável resolveu ${error instanceof Error ? error.message : String(error)}. O trabalho confirmado foi preservado.`, attempt, error);
      }
      seen.add(signature);
      if (options.wait) await options.wait(0, options.signal);
    }
  }
}
