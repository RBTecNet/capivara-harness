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
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import type { Invocation } from "./adapters.js";
import { redact } from "./redact.js";
import { runDirectApi } from "./direct-api.js";
import type { TokenUsage } from "./transcript.js";

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
  /** Texto visível incompleto, sanitizado, exclusivamente para evidência separada. */
  partialOutput?: string;
  /** API direta já devolve texto final e uso, sem envelope de CLI. */
  usage?: TokenUsage;
  resultRead?: boolean;
  engineError?: boolean;
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
  /**
   * Cada pedaço de saída, na hora em que chega.
   *
   * Sem isto, tudo o que a CLI conta enquanto trabalha só existe depois que ela
   * termina — e uma chamada de dez minutos fica indistinguível de um travamento.
   * Quem recebe decide o que fazer; o supervisor continua acumulando igual.
   */
  onOutput?: (chunk: string, stream: "out" | "err") => void;
}

const activeProviders = new Set<(signal: NodeJS.Signals) => void>();

/** O binário chama isto antes de sair por SIGINT/SIGTERM; importar não instala handlers. */
export function interruptActiveProviders(): void {
  for (const stop of activeProviders) { try { stop("SIGKILL"); } catch { /* outras invocações também precisam encerrar */ } }
}

/** OpenCode standalone cria grupos separados; somente a marca desta invocação autoriza recolhê-los. */
function signalPrivateOpenCode(scope: string, signal: NodeJS.Signals): void {
  if (process.platform !== "linux") return;
  let entries: string[];
  try { entries = readdirSync("/proc"); } catch { return; }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
    try {
      const root = `/proc/${entry}`;
      if (statSync(root).uid !== process.getuid?.()) continue;
      const before = readFileSync(`${root}/stat`, "utf8");
      const start = before.slice(before.lastIndexOf(")") + 2).split(" ")[19];
      if (!readFileSync(`${root}/environ`, "utf8").split("\0").includes(`CAPIVARA_INVOCATION_ID=${scope}`)) continue;
      const current = readFileSync(`${root}/stat`, "utf8");
      if (current.slice(current.lastIndexOf(")") + 2).split(" ")[19] !== start) continue;
      process.kill(Number(entry), signal);
    } catch { /* processo terminou, mudou de identidade ou não é acessível */ }
  }
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
  if (options.invocation.directApi) return runDirectApi(options);
  const { invocation, prompt, limits } = options;
  const startedAt = Date.now();
  const grace = limits.graceMilliseconds ?? 2000;
  const privateScope = invocation.transcript === "opencode-jsonl" || invocation.env.CAPIVARA_PROVIDER === "opencode" ? randomUUID() : null;

  const child = spawn(invocation.command, invocation.args, {
    env: privateScope ? { ...invocation.env, CAPIVARA_INVOCATION_ID: privateScope } : invocation.env,
    cwd: invocation.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });
  const signalOwned = (signal: NodeJS.Signals): void => {
    if (child.pid !== undefined) killTree(child.pid, signal);
    if (privateScope) signalPrivateOpenCode(privateScope, signal);
  };
  activeProviders.add(signalOwned);

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
    signalOwned("SIGTERM");
    const hard = setTimeout(() => {
      signalOwned("SIGKILL");
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
    // Nunca deixa um observador derrubar a chamada que ele só queria assistir.
    try {
      options.onOutput?.(chunk.toString("utf8"), into);
    } catch {
      /* observador quebrado não é problema do processo observado */
    }
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
  // close do wrapper pode vir antes dos filhos em grupos distintos.
  if (timedOut || truncated || options.signal?.aborted) signalOwned("SIGKILL");
  activeProviders.delete(signalOwned);
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
