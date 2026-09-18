/**
 * Supervisão de processo.
 *
 * Três limites distintos, porque as falhas são distintas: `first-output` pega o
 * provider que nunca começou, `idle` pega o que travou no meio, e `wall` pega o
 * que trabalha para sempre. Um único timeout confundiria os três e mataria
 * trabalho legítimo e demorado.
 *
 * O filho nasce em seu próprio grupo de processos para que a morte alcance a
 * árvore inteira. Ctrl+C que deixa um provider órfão consumindo recursos foi um
 * sintoma real do harness anterior.
 */

import { spawn } from "node:child_process";
import type { Invocation } from "./adapters.js";
import { redact } from "./redact.js";

export type TimeoutKind = "first-output" | "idle" | "wall";

export interface SupervisorLimits {
  /** Segundos até o primeiro byte. `0` desliga. */
  firstOutputSeconds: number;
  /** Segundos sem qualquer saída. `0` desliga. */
  idleSeconds: number;
  /** Segundos totais. `0` desliga. */
  wallSeconds: number;
  /** Teto de bytes de saída; acima disso o processo é encerrado. */
  maxOutputBytes: number;
  /** Tempo entre SIGTERM e SIGKILL. */
  graceMilliseconds?: number;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: TimeoutKind | null;
  truncated: boolean;
  firstOutputMilliseconds: number | null;
  durationMilliseconds: number;
}

export interface RunOptions {
  invocation: Invocation;
  prompt: string;
  limits: SupervisorLimits;
  signal?: AbortSignal;
}

/** Mata o grupo de processos; cai no pid isolado quando o grupo não existe. */
export function killTree(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* já morreu */
    }
  }
}

export async function runProvider(options: RunOptions): Promise<RunResult> {
  const { invocation, prompt, limits } = options;
  const startedAt = Date.now();
  const grace = limits.graceMilliseconds ?? 2000;

  const child = spawn(invocation.command, invocation.args, {
    env: invocation.env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });

  let stdout = "";
  let stderr = "";
  let bytes = 0;
  let truncated = false;
  let firstOutputMilliseconds: number | null = null;
  let timedOut: TimeoutKind | null = null;
  let settled = false;

  const timers = new Set<NodeJS.Timeout>();
  const clearTimers = (): void => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };

  const terminate = (kind: TimeoutKind | null): void => {
    if (settled) return;
    timedOut = kind ?? timedOut;
    if (child.pid === undefined) return;
    killTree(child.pid, "SIGTERM");
    const hard = setTimeout(() => {
      if (child.pid !== undefined) killTree(child.pid, "SIGKILL");
    }, grace);
    hard.unref();
    timers.add(hard);
  };

  let idleTimer: NodeJS.Timeout | null = null;
  const armIdle = (): void => {
    if (limits.idleSeconds <= 0) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => terminate("idle"), limits.idleSeconds * 1000);
    timers.add(idleTimer);
  };

  if (limits.firstOutputSeconds > 0) {
    const timer = setTimeout(() => {
      if (firstOutputMilliseconds === null) terminate("first-output");
    }, limits.firstOutputSeconds * 1000);
    timers.add(timer);
  }
  if (limits.wallSeconds > 0) {
    const timer = setTimeout(() => terminate("wall"), limits.wallSeconds * 1000);
    timers.add(timer);
  }

  /*
   * O relógio de ocioso só começa depois da primeira saída — "parou de produzir"
   * pressupõe ter começado. Armado desde o início, ele corre contra o de primeira
   * saída e o menor dos dois é que vale: no piloto 3 o limite de 900s virou 600s
   * na prática, e a chamada morreu com o provider ainda pensando.
   */

  const absorb = (chunk: Buffer, into: "out" | "err"): void => {
    if (firstOutputMilliseconds === null) firstOutputMilliseconds = Date.now() - startedAt;
    armIdle();
    bytes += chunk.length;
    if (bytes > limits.maxOutputBytes) {
      truncated = true;
      terminate(null);
      return;
    }
    const text = chunk.toString("utf8");
    if (into === "out") stdout += text;
    else stderr += text;
  };

  child.stdout.on("data", (chunk: Buffer) => absorb(chunk, "out"));
  child.stderr.on("data", (chunk: Buffer) => absorb(chunk, "err"));

  const onAbort = (): void => terminate(null);
  options.signal?.addEventListener("abort", onAbort, { once: true });

  child.stdin.on("error", () => undefined);
  child.stdin.end(prompt);

  const exitCode = await new Promise<number>((resolve) => {
    child.on("error", () => resolve(127));
    child.on("close", (code, signalName) => resolve(code ?? (signalName ? 124 : 1)));
  });

  settled = true;
  clearTimers();
  options.signal?.removeEventListener("abort", onAbort);

  return {
    exitCode: timedOut ? 124 : exitCode,
    stdout: redact(stdout, invocation.env),
    stderr: redact(stderr, invocation.env),
    timedOut,
    truncated,
    firstOutputMilliseconds,
    durationMilliseconds: Date.now() - startedAt,
  };
}
