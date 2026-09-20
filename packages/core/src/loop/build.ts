/**
 * O driver do `capivara build`.
 *
 * Preflight, lock, e uma fase por vez até o fim. Fases já verdes neste run não
 * são reexecutadas: a retomada não paga duas vezes pelo mesmo trabalho.
 *
 * A identidade do run deriva dos bytes do plano. Um plano alterado é outro run,
 * e a evidência do anterior não é aplicada em silêncio a um plano diferente.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sha12 } from "../contract/stamps.js";
import {
  acquireLock,
  liveLockOwner,
  appendEvent,
  artifactPaths,
  createRunState,
  ensureArtifactTree,
  nextSubject,
  readEvents,
  replayEvents,
  runIdFor,
  runPaths,
  writeRunState,
} from "../state/index.js";
import { isClean, isRepository } from "./git.js";
import { materializeSessions } from "./split.js";
import { preflight, type PreflightWarning } from "./preflight.js";
import { readPrerequisiteChoice, renderPrerequisiteChoice, resolvePrerequisites } from "./prerequisites.js";
import { resolveTestCommand } from "./testcmd.js";
import { runPhase, type EngineCaller, type PhaseOutcome } from "./runner.js";
import { runAcceptance, type AcceptanceResult, type CommandRunner } from "./acceptance.js";
import { acceptancePrompt, installPrompt } from "../prompts/index.js";
import type { TestRunner } from "./gates.js";

export interface BuildOptions {
  projectRoot: string;
  language: string;
  engine: string;
  call: EngineCaller;
  testRunner?: TestRunner;
  explicitTestCommand?: string;
  maxCycles?: number;
  keepGoing?: boolean;
  announce?: (message: string) => void;
  sleep?: (seconds: number) => Promise<void>;
  now?: () => Date;
  environment?: NodeJS.ProcessEnv;
  /** Permite ao executor instalar pré-requisitos de sistema. */
  systemInstall?: boolean;
  /**
   * Como perguntar ao desenvolvedor o que fazer com pré-requisito ausente.
   * Sem isso, faltar pré-requisito continua sendo erro de preflight: um build
   * não interativo não tem a quem perguntar e não deve adivinhar.
   */
  askPrerequisite?: (rendered: string) => Promise<string>;
  /** Uma sessão do executor com escopo de instalar e nada mais. */
  installPrerequisites?: (prompt: string) => Promise<void>;
  /** Desliga a aceitação operacional final. */
  skipAcceptance?: boolean;
  acceptanceRunner?: CommandRunner;
  acceptanceService?: CommandRunner;
}

export interface PhaseReport {
  id: string;
  title: string;
  outcome: PhaseOutcome;
}

export interface BuildOutcome {
  runId: string;
  /** 0 concluído · 1 erro de contrato ou configuração · 2 pausado e retomável. */
  exitCode: 0 | 1 | 2;
  phases: PhaseReport[];
  warnings: PreflightWarning[];
  errors: string[];
  acceptance: AcceptanceResult | null;
}

export async function runBuild(options: BuildOptions): Promise<BuildOutcome> {
  const announce = options.announce ?? (() => undefined);
  const now = options.now ?? (() => new Date());

  await ensureArtifactTree(options.projectRoot);

  const planPath = join(artifactPaths(options.projectRoot).init, "project-phases.md");
  const plan = await readFile(planPath, "utf8").catch(() => null);
  if (plan === null) {
    return {
      runId: "-",
      exitCode: 1,
      phases: [],
      warnings: [],
      errors: ["não há .capivara/init/project-phases.md; rode `capivara init` antes de `capivara build`"],
      acceptance: null,
    };
  }

  const runId = runIdFor("build", sha12(plan));

  /*
   * "Há alguém rodando?" vem ANTES de "a árvore está limpa?".
   *
   * Um segundo build encontra a árvore suja porque o primeiro está escrevendo
   * nela. Perguntado nesta ordem, o preflight culpava a vítima e sugeria
   * descartar o trabalho em curso — sugestão que, seguida, apaga o que um
   * executor está produzindo naquele instante.
   */
  const emExecucao = await liveLockOwner({ projectRoot: options.projectRoot, runId });
  if (emExecucao) {
    const razao =
      `já há um build deste plano em execução no pid ${emExecucao.pid} (desde ${emExecucao.startedAt}), ` +
      "e é ele que está escrevendo na árvore. Espere aquele processo terminar, ou encerre-o antes de rodar de novo.";
    announce(`erro: ${razao}`);
    return { runId, exitCode: 1, phases: [], warnings: [], errors: [razao], acceptance: null };
  }

  const repository = await isRepository(options.projectRoot);

  const checked = await preflight({
    projectRoot: options.projectRoot,
    runId,
    ...(options.explicitTestCommand !== undefined ? { explicitTestCommand: options.explicitTestCommand } : {}),
    git: { repository, clean: repository ? await isClean(options.projectRoot) : true },
    ...(options.systemInstall !== undefined ? { systemInstall: options.systemInstall } : {}),
    ...(options.environment !== undefined ? { environment: options.environment } : {}),
  });

  /*
   * Pré-requisito ausente é resolvido ANTES de qualquer chamada de modelo.
   * Três saídas — instalar agora, já instalei, abortar — e só se prossegue com a
   * dependência satisfeita de fato, confirmada por nova verificação e não pela
   * promessa de ninguém.
   */
  if (!checked.ok && options.askPrerequisite !== undefined && checked.missingPrerequisites.length > 0) {
    const resolucao = await resolvePrerequisites(checked.missingPrerequisites, {
      choose: async (faltando) => {
        for (;;) {
          const perguntar = options.askPrerequisite;
          if (!perguntar) return "abortar";
          const escolha = readPrerequisiteChoice(await perguntar(renderPrerequisiteChoice(faltando)));
          if (escolha) return escolha;
          announce("  responda com 1, 2 ou 3.");
        }
      },
      install: async (faltando) => {
        await options.installPrerequisites?.(
          installPrompt({
            language: options.language,
            missing: faltando.map((status) => ({ technology: status.technology, binary: status.binary })),
          }),
        );
      },
      announce,
    });

    if (!resolucao.resolved) {
      announce(`erro: ${resolucao.reason}`);
      for (const status of resolucao.missing) announce(`  ${status.technology} não foi encontrado (${status.binary})`);
      return { runId, exitCode: 1, phases: [], warnings: [], errors: [resolucao.reason], acceptance: null };
    }

    announce(`pré-requisitos satisfeitos: ${resolucao.installed.join(", ") || "nada faltava"}`);
    // Sem a pergunta na segunda passada: o que faltava foi resolvido, e um build
    // que voltasse a perguntar entraria em laço.
    const { askPrerequisite: _resolvido, ...semPergunta } = options;
    return runBuild(semPergunta);
  }

  if (!checked.ok) {
    for (const error of checked.errors) announce(`erro: ${error}`);
    for (const error of checked.contractErrors) announce(`  linha ${error.line}: ${error.code} ${error.message} → ${error.hint}`);
    return { runId, exitCode: 1, phases: [], warnings: [], errors: checked.errors, acceptance: null };
  }

  if (options.systemInstall === true) {
    // Default perigoso não pode rodar calado.
    announce("ATENÇÃO: o executor roda com acesso de sistema e pode instalar pacotes com sudo nesta máquina.");
    announce("         Use --no-system-install para mantê-lo dentro do workspace.");
  }
  for (const warning of checked.warnings) announce(`aviso: ${warning.message}`);

  const lock = await acquireLock({ projectRoot: options.projectRoot, runId, command: "build", now });
  const paths = runPaths(options.projectRoot, runId);

  try {
    await writeRunState(options.projectRoot, createRunState({ runId, command: "build", language: options.language, now }), now);
    await materializeSessions(checked.sessions);

    const progress = replayEvents(await readEvents(paths.events));
    const planned = checked.sessions.map((session) => session.id);
    const resumeFrom = nextSubject(progress, planned);
    if (resumeFrom !== null && resumeFrom !== planned[0]) announce(`retomando a partir de ${resumeFrom}`);

    const done = new Set(progress.completed);
    const phases: PhaseReport[] = [];

    for (const session of checked.sessions) {
      if (done.has(session.id)) {
        announce(`[${session.id}] já concluída neste run`);
        phases.push({ id: session.id, title: session.title, outcome: { status: "already-implemented", cycles: 0 } });
        continue;
      }

      const outcome = await runPhase({
        projectRoot: options.projectRoot,
        runId,
        language: options.language,
        engine: options.engine,
        session,
        testCommand: checked.testCommand,
        resolveTest: () =>
          resolveTestCommand(options.projectRoot, {
            ...(options.explicitTestCommand !== undefined ? { explicit: options.explicitTestCommand } : {}),
            ...(options.environment !== undefined ? { environment: options.environment } : {}),
          }),
        call: options.call,
        ...(options.testRunner !== undefined ? { testRunner: options.testRunner } : {}),
        systemInstall: options.systemInstall === true,
        ...(options.maxCycles !== undefined ? { maxCycles: options.maxCycles } : {}),
        commitsEnabled: checked.commitsEnabled,
        announce,
        ...(options.sleep !== undefined ? { sleep: options.sleep } : {}),
        now,
      });

      phases.push({ id: session.id, title: session.title, outcome });

      if (outcome.status === "failed" || outcome.status === "rate-limit-exhausted") {
        const detail = outcome.status === "failed" ? `${outcome.gate}: ${outcome.cause}` : "limite de uso esgotado";
        const [primeira, ...resto] = detail.split("\n");
        announce(`[${session.id}] PAROU — ${primeira ?? ""}`);
        // A causa inteira sai aqui, e só aqui: quem chama recebe o mesmo texto
        // em `errors` para uso programático, não para reimprimir.
        for (const linha of resto) announce(`           ${linha}`);
        if (!options.keepGoing) {
          await appendEvent(paths.events, {
            timestamp: now().toISOString(),
            stage: "implement",
            subject: "-",
            attempt: 1,
            status: "paused",
            detail,
          });
          return { runId, exitCode: 2, phases, warnings: checked.warnings, errors: [detail], acceptance: null };
        }
      }
    }

    // Todas as fases verdes provam que as regras estão implementadas e testadas.
    // Não provam que o produto sobe: o piloto 1b entregou 30 testes verdes sem
    // que ninguém tivesse aplicado uma migração ou aberto uma conexão.
    let acceptance: AcceptanceResult | null = null;
    if (options.skipAcceptance !== true) {
      announce("aceitação operacional: copiando o projeto para uma pasta limpa");
      acceptance = await runAcceptance({
        projectRoot: options.projectRoot,
        ...(options.acceptanceRunner !== undefined ? { runner: options.acceptanceRunner } : {}),
        ...(options.acceptanceService !== undefined ? { service: options.acceptanceService } : {}),
      });

      for (let tentativa = 1; !acceptance.accepted && tentativa <= (options.maxCycles ?? 3); tentativa += 1) {
        const causa = acceptance.failure.cause;
        announce(`aceitação reprovou em "${acceptance.failure.id}"; ciclo de correção ${tentativa}`);
        await appendEvent(paths.events, {
          timestamp: now().toISOString(),
          stage: "validate",
          subject: "aceitação",
          attempt: tentativa,
          status: "retry",
          detail: causa.split("\n")[0] ?? "",
        });

        const ultima = checked.sessions.at(-1);
        if (!ultima) break;
        await options.call({
          role: "builder",
          phase: ultima,
          attempt: tentativa,
          prompt: acceptancePrompt({
            language: options.language,
            testCommand: checked.testCommand?.command ?? null,
            containerized: checked.testCommand?.containerized ?? false,
            phaseMarkdown: "",
            cause: causa,
            attempt: tentativa,
          }),
        });

        acceptance = await runAcceptance({
          projectRoot: options.projectRoot,
          ...(options.acceptanceRunner !== undefined ? { runner: options.acceptanceRunner } : {}),
          ...(options.acceptanceService !== undefined ? { service: options.acceptanceService } : {}),
        });
      }

      if (!acceptance.accepted) {
        announce(`aceitação operacional REPROVOU: ${acceptance.failure.cause.split("\n")[0] ?? ""}`);
        await appendEvent(paths.events, {
          timestamp: now().toISOString(),
          stage: "validate",
          subject: "aceitação",
          attempt: 1,
          status: "paused",
          detail: acceptance.failure.cause,
        });
        return { runId, exitCode: 2, phases, warnings: checked.warnings, errors: [acceptance.failure.cause], acceptance };
      }

      announce(acceptance.skipped !== "" ? `aceitação operacional: ${acceptance.skipped}` : "aceitação operacional: o produto sobe a partir de uma cópia limpa");
    }

    await appendEvent(paths.events, {
      timestamp: now().toISOString(),
      stage: "complete",
      subject: "-",
      attempt: 1,
      status: "complete",
      detail: `${phases.length} fase(s)`,
    });
    announce("aplicação concluída: todas as fases verdes");
    return { runId, exitCode: 0, phases, warnings: checked.warnings, errors: [], acceptance };
  } finally {
    await lock.release();
  }
}
