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
import { workflowsForPhase, type Skeleton, type SkeletonWorkflow } from "../contract/index.js";
import {
  escolherSkills,
  escreverIndice,
  estadoComoMemoria,
  lerSkillsDoDisco,
  materializarSkill,
  renderSkillBlock,
  type McpDocument,
  type MemoriaParaRegistrar,
} from "../mcp/index.js";
import { startCommandFor } from "./acceptance.js";
import type { FlowRunner } from "./flows.js";
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
import type { BuildProgressListener } from "./progress.js";
import { lerFasesFechadas, registrarFaseFechada, shaDaFase } from "./ledger.js";
import type { TestRunner } from "./gates.js";

export interface BuildOptions {
  projectRoot: string;
  language: string;
  engine: string;
  call: EngineCaller;
  /**
   * O esqueleto, de onde saem os fluxos do gate 4.
   *
   * Vem de fora porque quem o guarda é o `init`, e o loop não importa o init —
   * o init já importa o loop, e o ciclo entre os dois seria pior que o parâmetro.
   * Ausente ou nulo: o build roda sem o gate que abre a aplicação, e diz isso.
   */
  skeleton?: Skeleton | null;
  /** Substituível nos testes: rodar navegador de verdade a cada cenário é inviável. */
  flowRunner?: FlowRunner;
  /** Desliga o gate 4 mesmo havendo esqueleto. */
  skipFlows?: boolean;
  /** Refaz até o que já fechou em run anterior com o mesmo texto. */
  rebuildAll?: boolean;
  /**
   * Recebe o que este build tem a devolver à base: o estado e o que o executor
   * anotou. Ausente significa build sem base — nada muda no resto.
   */
  onMemorias?: (memorias: MemoriaParaRegistrar[]) => Promise<void>;
  /**
   * Os documentos que a base entregou para este projeto.
   *
   * As skills são materializadas em `.capivara/skills/` antes da primeira fase e
   * escolhidas por área a cada uma. O resto (memória, documentação) já foi ao
   * estágio de documentação e não se repete aqui.
   */
  library?: McpDocument[];
  testRunner?: TestRunner;
  explicitTestCommand?: string;
  maxCycles?: number;
  keepGoing?: boolean;
  announce?: (message: string) => void;
  /**
   * Espelho do andamento, para quem desenha.
   *
   * `onPlanned` chega uma vez, com o plano inteiro: a tela precisa saber quantas
   * fases existem antes de a primeira começar, senão a lista cresce por baixo e
   * ninguém sabe quanto falta. `onProgress` chega a cada gate.
   */
  onPlanned?: (phases: { id: string; title: string }[]) => void;
  onProgress?: BuildProgressListener;
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

    /*
     * De onde saem os fluxos do gate 4. O esqueleto é do build inteiro; o
     * comando que sobe a aplicação é resolvido por fase, porque num greenfield
     * ele passa a existir no meio do caminho.
     */
    const esqueleto = options.skipFlows === true ? null : (options.skeleton ?? null);
    if (options.skipFlows !== true && esqueleto === null) {
      announce("aviso: sem esqueleto legível, o gate 4 não percorre fluxo nenhum nesta execução");
    }

    /*
     * A regressão é o que as fases ANTERIORES já fizeram passar — não o que
     * houver na pasta de roteiros. Um roteiro de outro plano, ou de uma fase que
     * ainda não rodou, cobraria da fase atual um comportamento que ela não
     * prometeu: no MCP_teste a fase 1, de banco e infra, reprovava por não ter a
     * tela de cadastro que só a fase 3 constrói.
     */
    const fluxosCumpridos: SkeletonWorkflow[] = [];

    const fluxosDaFase =
      esqueleto !== null
        ? (phaseNumber: number) => ({
            workflows: workflowsForPhase(esqueleto, phaseNumber),
            regressao: fluxosCumpridos.filter(
              (workflow) => !workflowsForPhase(esqueleto, phaseNumber).some((atual) => atual.number === workflow.number),
            ),
            resolveStart: () => startCommandFor(options.projectRoot),
            ...(options.flowRunner !== undefined ? { runner: options.flowRunner } : {}),
          })
        : null;

    /*
     * As skills vão para o disco UMA vez, antes da primeira fase.
     *
     * Materializar por fase reescreveria os mesmos arquivos a cada volta sem
     * nada mudar. O que muda por fase é a escolha — quais entram no prompt —, e
     * essa é barata.
     */
    const daBase = (options.library ?? []).filter((documento) => (documento.kind ?? "") === "skill");
    const pastaPorUri = new Map<string, string>();

    for (const skill of daBase) {
      const escrita = await materializarSkill(options.projectRoot, skill);
      pastaPorUri.set(skill.uri, escrita.pasta);
      announce(
        `skill materializada: ${escrita.pasta}/ (${escrita.arquivos + 1} arquivo(s), ${Math.round(escrita.bytes / 1024)} KB)`,
      );
    }
    if (daBase.length > 0) await escreverIndice(options.projectRoot, daBase);

    /*
     * Sem base, o disco.
     *
     * É o caminho de quem está com a base fora do ar e o de quem recebeu o
     * projeto num zip e nunca teve base nenhuma. Materializar não é preciso: os
     * arquivos já estão lá, e o índice diz a área de cada um.
     */
    const skills =
      daBase.length > 0
        ? daBase
        : await (async (): Promise<McpDocument[]> => {
            const doDisco = await lerSkillsDoDisco(options.projectRoot);
            if (doDisco.length > 0) {
              announce(`${doDisco.length} skill(s) lida(s) de .capivara/skills/ (a base não entregou nenhuma)`);
            }
            return doDisco;
          })();

    for (const skill of skills) {
      if (!pastaPorUri.has(skill.uri)) pastaPorUri.set(skill.uri, `.capivara/skills/${skill.uri.split("/").pop() ?? ""}`);
    }

    /**
     * O bloco de skills de uma fase: as da área dela, mais as gerais.
     *
     * A fase declara as áreas no plano; a skill declara a sua no catálogo. Quem
     * cruza é esta função, e o que o teto cortar aparece no log — skill escondida
     * em silêncio é pior que skill ausente.
     */
    /**
     * Onde o trabalho parou, escrito por quem sabe.
     *
     * O harness conhece o desfecho de cada fase sem depender de alguém anotar, e
     * esta é a memória que mais envelhece — por isso ela substitui a anterior em
     * vez de acumular. Falhar aqui não derruba o build: a base é conveniência.
     */
    const registrarEstado = async (
      concluidas: PhaseReport[],
      todas: readonly { id: string; title: string }[],
      parou: PhaseOutcome | null,
    ): Promise<void> => {
      if (!options.onMemorias) return;

      const porId = new Map(concluidas.map((fase) => [fase.id, fase]));
      const fases = todas.map((sessao) => {
        const relatada = porId.get(sessao.id);
        const status = relatada?.outcome.status ?? "pending";
        const falhou = relatada?.outcome.status === "failed" ? relatada.outcome : null;
        return {
          id: sessao.id,
          title: sessao.title,
          status,
          ...(falhou ? { gate: falhou.gate, cause: falhou.cause } : {}),
        };
      });

      // A fase que parou o build ainda não está em `phases` quando o loop sai.
      if (parou && parou.status === "failed") {
        const ultima = fases.find((fase) => fase.status === "pending");
        if (ultima) Object.assign(ultima, { status: "failed", gate: parou.gate, cause: parou.cause });
      }

      await options.onMemorias([estadoComoMemoria({ runId, fases })]);
    };

    const skillsDaFase = (sessionId: string, areasDaFase: string): string => {
      if (skills.length === 0) return "";
      const areas = areasDaFase
        .split(/[,;·]/)
        .map((area) => area.trim())
        .filter((area) => area !== "");

      const selecao = escolherSkills(skills, areas);

      /*
       * Dizer o que entrou, e não só o que ficou de fora.
       *
       * Quem olha a tela precisa saber que a skill de frontend NÃO foi carregada
       * numa fase de banco — é o motivo de a seleção existir. Sem esta linha, a
       * única forma de descobrir seria abrir o prompt gravado em disco.
       */
      const rotulo = areas.length > 0 ? `área ${areas.join(", ")}` : "sem área declarada";
      announce(
        `[${sessionId}] skills (${rotulo}): ${
          selecao.inteiras.map((documento) => documento.name).join(", ") || "nenhuma no prompt"
        }${selecao.noIndice.length > 0 ? ` · ${selecao.noIndice.length} só no índice` : ""}`,
      );
      if (selecao.cortadas.length > 0) {
        announce(`           o teto de contexto deixou de fora: ${selecao.cortadas.join(", ")} (ficam no índice)`);
      }

      return renderSkillBlock(selecao, pastaPorUri);
    };

    options.onPlanned?.(checked.sessions.map((session) => ({ id: session.id, title: session.title })));

    /*
     * `rebuildAll` ignora as DUAS memórias: a do próprio run, que é a retomada
     * depois de uma queda, e a dos runs anteriores. Quem pede para refazer tudo
     * está dizendo que não confia no que está lá — e um "tudo" que poupa metade
     * é pior que não existir.
     */
    const done = new Set(options.rebuildAll === true ? [] : progress.completed);

    /*
     * As fases que fecharam em runs ANTERIORES, com o mesmo texto.
     *
     * O id do run é o hash do plano inteiro, então acrescentar uma fase — o que
     * o `change` faz — muda o hash e devolve à fila as que já estavam prontas.
     * O registro é por texto: fase cujo markdown mudou volta a ser construída,
     * que é o certo quando alguém editou um critério.
     */
    const fechadasAntes = options.rebuildAll === true ? [] : await lerFasesFechadas(options.projectRoot);
    const shaFechado = new Map(fechadasAntes.map((fase) => [fase.sha, fase]));

    const phases: PhaseReport[] = [];

    for (const session of checked.sessions) {
      const fechadaAntes = shaFechado.get(shaDaFase(session.markdown));
      if (!done.has(session.id) && fechadaAntes) {
        announce(`[${session.id}] já fechada no run ${fechadaAntes.runId}, com este mesmo texto; não vou refazer`);
        options.onProgress?.({ kind: "phase", id: session.id, state: "concluído", cycle: 0, detail: "fechada antes" });
        for (const gate of ["G0", "G1", "G2", "G3"] as const) {
          options.onProgress?.({ kind: "gate", id: session.id, gate, state: "verde", cycle: 0 });
        }
        if (fluxosDaFase !== null) options.onProgress?.({ kind: "gate", id: session.id, gate: "G4", state: "verde", cycle: 0 });

        phases.push({ id: session.id, title: session.title, outcome: { status: "already-implemented", cycles: 0 } });
        // O fluxo de uma fase fechada continua sendo regressão das seguintes.
        if (esqueleto !== null) {
          for (const workflow of workflowsForPhase(esqueleto, session.number)) {
            if (!fluxosCumpridos.some((cumprido) => cumprido.number === workflow.number)) fluxosCumpridos.push(workflow);
          }
        }
        continue;
      }

      if (done.has(session.id)) {
        announce(`[${session.id}] já concluída neste run`);
        /*
         * A fase fechou NESTE run, e fechar é passar por todos os gates. Anunciá-la
         * como "pulada", com as cinco bolinhas apagadas, faz a tela dizer que
         * ninguém olhou para ela — e o resumo contá-la como fase que falta. Quem
         * retoma um build precisa ver de longe onde a execução está.
         *
         * O G4 só entra quando este run tem fluxos: sem `--no-flows` e sem
         * esqueleto, ele não foi avaliado nem na primeira passagem, e pintá-lo
         * verde diria que a aplicação foi aberta quando não foi.
         */
        for (const gate of ["G0", "G1", "G2", "G3"] as const) {
          options.onProgress?.({ kind: "gate", id: session.id, gate, state: "verde", cycle: 0 });
        }
        if (fluxosDaFase !== null) {
          options.onProgress?.({ kind: "gate", id: session.id, gate: "G4", state: "verde", cycle: 0 });
        }
        options.onProgress?.({ kind: "phase", id: session.id, state: "concluído", cycle: 0, detail: "concluída antes" });
        phases.push({ id: session.id, title: session.title, outcome: { status: "already-implemented", cycles: 0 } });
        continue;
      }

      const fluxosDestaFase = esqueleto !== null ? workflowsForPhase(esqueleto, session.number) : [];

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
        ...(skills.length > 0 ? { skills: skillsDaFase(session.id, session.areas) } : {}),
        ...(options.onMemorias ? { onMemorias: options.onMemorias } : {}),
        ...(fluxosDaFase ? { flows: fluxosDaFase(session.number) } : {}),
        ...(options.testRunner !== undefined ? { testRunner: options.testRunner } : {}),
        systemInstall: options.systemInstall === true,
        ...(options.maxCycles !== undefined ? { maxCycles: options.maxCycles } : {}),
        commitsEnabled: checked.commitsEnabled,
        announce,
        ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
        ...(options.sleep !== undefined ? { sleep: options.sleep } : {}),
        now,
      });

      phases.push({ id: session.id, title: session.title, outcome });

      if (outcome.status === "complete" || outcome.status === "already-implemented") {
        await registrarFaseFechada(options.projectRoot, {
          id: session.id,
          title: session.title,
          sha: shaDaFase(session.markdown),
          runId,
          closedAt: now().toISOString(),
        });
      }

      // Fluxo que passou vira regressão das fases seguintes: é o que faz um
      // defeito introduzido na fase 5 aparecer na fase 5.
      if (outcome.status === "complete" || outcome.status === "already-implemented") {
        for (const workflow of fluxosDestaFase) {
          if (!fluxosCumpridos.some((cumprido) => cumprido.number === workflow.number)) fluxosCumpridos.push(workflow);
        }
      }

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
          await registrarEstado(phases, checked.sessions, outcome);
          return { runId, exitCode: 2, phases, warnings: checked.warnings, errors: [detail], acceptance: null };
        }
      }
    }

    await registrarEstado(phases, checked.sessions, null);

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
