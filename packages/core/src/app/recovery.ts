import { setTimeout as delay } from 'node:timers/promises';

export class Cancelled extends Error { constructor() { super('Execução interrompida pelo usuário; trabalho preservado.'); this.name = 'Cancelled'; } }

export async function waitForRecovery(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Cancelled();
  try { await delay(milliseconds, undefined, signal ? { signal } : {}); }
  catch { throw new Cancelled(); }
}

/** A retry changes execution strategy at its owner; this loop never invents a fatal attempt count. */
export async function recoverOperation<T>(operation: () => Promise<T>, options: {
  signal?: AbortSignal;
  announce: (message: string) => void;
  recover?: (error: unknown, attempt: number) => Promise<void>;
  classifyCritical?: (error: unknown) => string | undefined;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
}): Promise<T> {
  let attempt = 0;
  for (;;) {
    if (options.signal?.aborted) throw new Cancelled();
    try { return await operation(); }
    catch (error) {
      if (options.signal?.aborted || error instanceof Cancelled) throw new Cancelled();
      const critical = options.classifyCritical?.(error);
      if (critical) throw new Error(critical, { cause: error });
      attempt++;
      options.announce(`Recuperando: ${error instanceof Error ? error.message : String(error)}`);
      await options.recover?.(error, attempt);
      await (options.wait ?? waitForRecovery)(Math.min(60_000, 2_000 * 2 ** Math.min(attempt - 1, 5)), options.signal);
    }
  }
}
