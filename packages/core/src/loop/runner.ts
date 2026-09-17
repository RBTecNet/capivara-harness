/**
 * O ciclo de fase.
 *
 * Sessão nova a cada tentativa, prompt auto-contido, quatro gates, e um commit
 * quando tudo fica verde com a árvore suja. Verde com a árvore limpa significa
 * que a fase já estava implementada em HEAD: concluída, sem commit.
 *
 * Esgotados os ciclos, o loop PARA e reporta, retomável. Seguir em frente com
 * uma fase vermelha faz a próxima construir sobre chão que não existe.
 */

import { appendEvent } from "../state/events.js";
import { runPaths } from "../state/paths.js";
import { writeAtomic } from "../state/atomic.js";
import { fixPrompt, implementPrompt, verifyPrompt } from "../prompts/index.js";
import { commitPhase, treeSignature } from "./git.js";
import { declaredComplete, gate0, gate1, gate2, gate3, type GateName, type TestRunner } from "./gates.js";
import { detectRateLimit, planWait } from "./ratelimit.js";
import type { PhaseSession } from "./split.js";
import type { TestCommand } from "./testcmd.js";

export interface EngineResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: string | null;
}

export interface EngineCall {
  role: "builder" | "verifier";
  phase: PhaseSession;
  attempt: number;
  prompt: string;
}

export type EngineCaller = (call: EngineCall) => Promise<EngineResult>;

export interface PhaseRunOptions {
  projectRoot: string;
  runId: string;
  language: string;
  engine: string;
  session: PhaseSession;
  testCommand: TestCommand | null;
  /**
   * Redetecta o comando de teste DEPOIS da sessão do executor.
   *
   * Num greenfield a suíte não existe quando a fase começa e existe quando ela
   * termina: a própria fase 1 cria o package.json. Resolver uma vez, no
   * preflight, com o diretório vazio, condena o gate 2 a ficar pulado para
   * sempre — foi o que aconteceu no piloto 1, que entregou 27 testes passando
   * sem que o loop tivesse rodado um único deles.
   */
  resolveTest?: () => Promise<TestCommand | null>;
  call: EngineCaller;
  testRunner?: TestRunner;
  maxCycles?: number;
  maxLimitWaits?: number;
  commitsEnabled: boolean;
  announce?: (message: string) => void;
  sleep?: (seconds: number) => Promise<void>;
  now?: () => Date;
}

export type PhaseOutcome =
  | { status: "complete"; committed: boolean; message: string; cycles: number }
  | { status: "already-implemented"; cycles: number }
  | { status: "failed"; gate: GateName; cause: string; cycles: number }
  | { status: "rate-limit-exhausted"; waits: number };

export const DEFAULT_MAX_CYCLES = 3;
export const DEFAULT_MAX_LIMIT_WAITS = 20;

export async function runPhase(options: PhaseRunOptions): Promise<PhaseOutcome> {
  const maxCycles = options.maxCycles ?? DEFAULT_MAX_CYCLES;
  const maxLimitWaits = options.maxLimitWaits ?? DEFAULT_MAX_LIMIT_WAITS;
  const announce = options.announce ?? (() => undefined);
  const sleep = options.sleep ?? ((seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000)));
  const now = options.now ?? (() => new Date());
  const paths = runPaths(options.projectRoot, options.runId);
  const session = options.session;

  let waits = 0;
  let lastGate: GateName | null = null;
  let lastCause = "";
  let previousWroteNothing = false;

  const event = async (status: "started" | "complete" | "retry" | "blocked" | "skipped", detail: string, attempt: number): Promise<void> => {
    await appendEvent(paths.events, {
      timestamp: now().toISOString(),
      stage: "implement",
      subject: session.id,
      attempt,
      status,
      detail,
    });
  };

  for (let cycle = 1; cycle <= maxCycles; ) {
    await event("started", cycle === 1 ? "implementação" : `ciclo de correção ${cycle}`, cycle);
    announce(cycle === 1 ? `[${session.id}] ${session.title}` : `[${session.id}] ciclo de correção ${cycle}/${maxCycles}`);

    const context = {
      language: options.language,
      testCommand: options.testCommand?.command ?? null,
      containerized: options.testCommand?.containerized ?? false,
      phaseMarkdown: session.markdown,
    };

    const prompt =
      cycle === 1
        ? implementPrompt(context)
        : fixPrompt({ ...context, gate: lastGate ?? "gate 0 — engine", cause: lastCause, previousWroteNothing });

    await writeAtomic(`${paths.prompts}/${session.id}.cycle-${cycle}.txt`, prompt);

    const signatureBefore = await treeSignature(options.projectRoot);
    const result = await options.call({ role: "builder", phase: session, attempt: cycle, prompt });
    await writeAtomic(`${paths.logs}/${session.id}.cycle-${cycle}.log`, `${result.stdout}\n${result.stderr}`);

    // Limite de uso não é defeito da implementação: espera e repete a MESMA
    // fase, sem consumir ciclo de correção.
    const limit = detectRateLimit(`${result.stdout}\n${result.stderr}`, options.engine);
    if (limit) {
      waits += 1;
      if (waits > maxLimitWaits) return { status: "rate-limit-exhausted", waits };
      const plan = planWait(limit);
      announce(`[${session.id}] ${plan.reason}; aguardando ${plan.seconds}s sem consumir ciclo`);
      await event("retry", `limite de uso: ${plan.reason}`, cycle);
      await sleep(plan.seconds);
      continue;
    }

    // A fase pode ter acabado de criar a suíte. Perguntar de novo custa um
    // acesso a disco; não perguntar custa a fase inteira sem validação.
    const testeAgora = options.resolveTest ? await options.resolveTest() : options.testCommand;
    if (testeAgora && testeAgora.command !== options.testCommand?.command) {
      announce(`[${session.id}] comando de teste detectado: ${testeAgora.command} (${testeAgora.source})`);
    }

    const wrote = gate1(signatureBefore, await treeSignature(options.projectRoot));
    previousWroteNothing = !wrote;
    if (!wrote) announce(`[${session.id}] a sessão não escreveu nada; validando o código existente`);

    const noChangeNote = wrote ? "" : "A sessão anterior terminou sem alterar nenhum arquivo. ";

    const g0 = gate0(result, options.engine);
    if (!g0.green) {
      lastGate = g0.gate;
      lastCause = g0.cause;
    } else {
      const g2 = await gate2(options.projectRoot, testeAgora?.command ?? null, options.testRunner);
      if (!g2.green) {
        lastGate = g2.gate;
        // Ferramenta ausente não ganha o prefixo de "não escreveu nada": a sessão
        // corretamente não mexeu no código, porque o defeito é de ambiente.
        lastCause = g2.toolMissing === true ? g2.cause : `${noChangeNote}${g2.cause}`;
        if (g2.toolMissing === true) announce(`[${session.id}] o runner de testes não está instalado; o executor tem acesso de sistema para instalá-lo`);
      } else {
        if (g2.skipped) announce(`[${session.id}] gate 2 pulado: nenhum comando de teste resolvido`);
        const verification = await options.call({
          role: "verifier",
          phase: session,
          attempt: cycle,
          prompt: verifyPrompt({ language: options.language, phaseMarkdown: session.markdown, taskCount: session.taskCount }),
        });
        await writeAtomic(`${paths.logs}/${session.id}.verify-${cycle}.log`, verification.stdout);

        const g3 = gate3(verification.stdout, session.taskCount);
        if (!g3.green) {
          lastGate = g3.gate;
          lastCause = `${noChangeNote}${g3.cause}`;
        } else {
          const commit = options.commitsEnabled
            ? await commitPhase(options.projectRoot, session.number, session.title)
            : { committed: false, message: "commits desabilitados: nenhum repositório Git" };

          if (!commit.committed && commit.message.includes("já estava implementada")) {
            await event("complete", "já implementada em HEAD", cycle);
            announce(`[${session.id}] JÁ IMPLEMENTADA — gates verdes, nada a commitar`);
            return { status: "already-implemented", cycles: cycle };
          }

          await event("complete", commit.message, cycle);
          announce(`[${session.id}] COMPLETA${commit.committed ? ` — ${commit.message}` : ""}`);
          return { status: "complete", committed: commit.committed, message: commit.message, cycles: cycle };
        }
      }
    }

    if (declaredComplete(result.stdout) && lastGate) {
      // A palavra do executor nunca supera um gate vermelho.
      announce(`[${session.id}] o executor declarou conclusão, mas ${lastGate} reprovou`);
    }
    await event("retry", `${lastGate}: ${lastCause.split("\n")[0] ?? ""}`, cycle);
    cycle += 1;
  }

  await event("blocked", `${lastGate ?? "desconhecido"}: ${lastCause.split("\n")[0] ?? ""}`, maxCycles);
  return { status: "failed", gate: lastGate ?? "gate 0 — engine", cause: lastCause, cycles: maxCycles };
}
