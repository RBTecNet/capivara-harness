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
import { resolveTestCommand } from "./testcmd.js";
import { runPhase, type EngineCaller, type PhaseOutcome } from "./runner.js";
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
    };
  }

  const runId = runIdFor("build", sha12(plan));
  const repository = await isRepository(options.projectRoot);

  const checked = await preflight({
    projectRoot: options.projectRoot,
    runId,
    ...(options.explicitTestCommand !== undefined ? { explicitTestCommand: options.explicitTestCommand } : {}),
    git: { repository, clean: repository ? await isClean(options.projectRoot) : true },
    ...(options.systemInstall !== undefined ? { systemInstall: options.systemInstall } : {}),
    ...(options.environment !== undefined ? { environment: options.environment } : {}),
  });

  if (!checked.ok) {
    for (const error of checked.errors) announce(`erro: ${error}`);
    for (const error of checked.contractErrors) announce(`  linha ${error.line}: ${error.code} ${error.message} → ${error.hint}`);
    return { runId, exitCode: 1, phases: [], warnings: [], errors: checked.errors };
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
        ...(options.maxCycles !== undefined ? { maxCycles: options.maxCycles } : {}),
        commitsEnabled: checked.commitsEnabled,
        announce,
        ...(options.sleep !== undefined ? { sleep: options.sleep } : {}),
        now,
      });

      phases.push({ id: session.id, title: session.title, outcome });

      if (outcome.status === "failed" || outcome.status === "rate-limit-exhausted") {
        const detail = outcome.status === "failed" ? `${outcome.gate}: ${outcome.cause}` : "limite de uso esgotado";
        announce(`[${session.id}] PAROU — ${detail.split("\n")[0] ?? ""}`);
        if (!options.keepGoing) {
          await appendEvent(paths.events, {
            timestamp: now().toISOString(),
            stage: "implement",
            subject: "-",
            attempt: 1,
            status: "paused",
            detail,
          });
          return { runId, exitCode: 2, phases, warnings: checked.warnings, errors: [detail] };
        }
      }
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
    return { runId, exitCode: 0, phases, warnings: checked.warnings, errors: [] };
  } finally {
    await lock.release();
  }
}
