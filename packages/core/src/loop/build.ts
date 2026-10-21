/**
 * O driver do `capivara build`.
 *
 * Preflight, lock, e uma fase por vez até o fim. Fases já verdes neste run não
 * são reexecutadas: a retomada não paga duas vezes pelo mesmo trabalho.
 *
 * A identidade do run deriva dos bytes do plano. Um plano alterado é outro run,
 * e a evidência do anterior não é aplicada em silêncio a um plano diferente.
 */

import { appendFile, mkdir, readFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { sha12 } from "../contract/stamps.js";
import { workflowsForPhase, type Architecture, type Skeleton, type SkeletonWorkflow } from "../contract/index.js";
import { vincularArquitetura } from "./arquitetura.js";
import { LivroDeEvidencias } from "./evidencias.js";
import { orcamentoEfetivo, type OrcamentoDaRecuperacao } from "./defeitos.js";
import type { ContratoDaRetomada } from "../provider/cli/types.js";
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
  readRunState,
  writeAtomic,
  type RunBudgets,
} from "../state/index.js";
import { escolhaSemRepositorio, iniciarRepositorio, isClean, isRepository, lerEscolhaDeRepositorio, renderSemRepositorio } from "./git.js";
import { materializeSessions } from "./split.js";
import { preflight, type PreflightWarning } from "./preflight.js";
import { checkPrerequisites, prerequisiteChoice, readPrerequisiteChoice, renderPrerequisiteChoice, resolvePrerequisites, type PrerequisiteStatus } from "./prerequisites.js";
import { prepareBuildEnvironment } from "./environment-prepare.js";
import { readEnvironmentPlan } from "./environment-plan.js";
import type { EscolhaNumerada } from "./escolha.js";
import { resolveTestCommand } from "./testcmd.js";
import { DEFAULT_MAX_CYCLES, runPhase, type EngineCaller, type EngineResult, type PhaseOutcome } from "./runner.js";
import { runAcceptance, type AcceptanceResult, type CommandRunner } from "./acceptance.js";
import { acceptancePrompt, installPrompt } from "../prompts/index.js";
import type { BuildProgressListener } from "./progress.js";
import { lerFasesFechadas, registrarFaseFechada, shaDaFase } from "./ledger.js";
import { TasksAprovadas, tasksDaFase } from "./veredictos.js";
import { defaultTestRunner, gate0, type TestRunner } from "./gates.js";
import { adoptPreparedDependencies } from "./prepared-dependencies.js";
import { admitirArvore, alteracoesParaCommit, artefatosLocaisIgnorados, lerStatus } from "./admissao.js";
import { garantiaDeAutoridade } from "./autoridade.js";
import { conferirIsolamento } from "./isolamento.js";
import { larguraDoPlano } from "./escalonador.js";
import { executarEmParalelo, type AgenteDoPool, type ExecucaoDaFase } from "./paralelo.js";
import { FLOW_PORT } from "./flows.js";
import { garantirBase } from "./worktree.js";
import type { PhaseSession } from "./split.js";
import type { WorkerProgressListener } from "./progress.js";

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
  /**
   * A arquitetura estruturada que o `plan` guardou (§125).
   *
   * Vem de fora pelo mesmo motivo do esqueleto: quem a guarda é o estágio de
   * documentação. O build a confere contra o `architecture.md` publicado e o
   * carimbo do `environment.json` antes de qualquer sessão, e só então entrega
   * a fatia de cada fase ao executor e ao verificador.
   */
  architecture?: Architecture | null;
  /** Substituível nos testes: rodar navegador de verdade a cada cenário é inviável. */
  flowRunner?: FlowRunner;
  /** Desliga o gate 4 mesmo havendo esqueleto. */
  skipFlows?: boolean;
  /**
   * Quem rodou: provider, modelo e effort de cada papel.
   *
   * O `run.json` sempre teve o campo e ele sempre ficou vazio. Diagnosticar o
   * `MCP_teste2` exigiu adivinhar qual CLI tinha sido usada — e a resposta
   * mudava o veredito, porque o acesso de sistema que o executor recebe depende
   * do adaptador. O run precisa dizer quem o executou.
   */
  roles?: Record<string, { provider: string; model: string; effort: string }>;
  /** Refaz até o que já fechou em run anterior com o mesmo texto. */
  rebuildAll?: boolean;
  /**
   * Criar o repositório Git quando a pasta é nova. Ligado por padrão.
   *
   * Desligar é para quem versiona por fora ou não quer git nenhum: o loop roda
   * igual, sem commit por fase — e sem ponto de retorno entre as fases.
   */
  gitInit?: boolean;
  /**
   * Como perguntar ao desenvolvedor o que fazer com a falta de repositório.
   *
   * Sem isto, árvore com trabalho e sem Git é erro de preflight: um build não
   * interativo não tem a quem perguntar, e criar repositório sobre trabalho alheio
   * não é coisa que se faça por palpite.
   */
  askGit?: (rendered: string, escolha: EscolhaNumerada) => Promise<string>;
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
  /** Orçamento de sessões de reparo do verificador; quem chama deve conferir capacidade de CLI. */
  maxVerifierRepairs?: number;
  /** Orçamentos da recuperação por ciclo, gate e defeito (§125 D); ausente usa os padrões. */
  orcamento?: Partial<Pick<OrcamentoDaRecuperacao, "porCiclo" | "porGate" | "porDefeito">>;
  /** Como o provider do verificador retoma uma sessão (§125 E); null quando não retoma. */
  verifierResume?: ContratoDaRetomada | null;
  /** Tentar a retomada mesmo não verificada com provider real (`--verifier-resume`). */
  verifierResumeUnverified?: boolean;
  keepGoing?: boolean;
  announce?: (message: string) => void;
  /**
   * Espelho do andamento, para quem desenha.
   *
   * `onPlanned` chega uma vez, com o plano inteiro: a tela precisa saber quantas
   * fases existem antes de a primeira começar, senão a lista cresce por baixo e
   * ninguém sabe quanto falta. `onProgress` chega a cada gate.
   */
  onPlanned?: (phases: { id: string; title: string; taskCount: number }[], contexto?: { testCommand?: string; runId?: string }) => void;
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
  askPrerequisite?: (rendered: string, escolha: EscolhaNumerada) => Promise<string>;
  /** Uma sessão do executor com escopo de instalar e nada mais. */
  installPrerequisites?: (prompt: string) => Promise<EngineResult | void>;
  /** Desliga a aceitação operacional final. */
  skipAcceptance?: boolean;
  acceptanceRunner?: CommandRunner;
  acceptanceService?: CommandRunner;
  /**
   * Execução paralela (§97): até `maxConcurrency` fases ao mesmo tempo, cada
   * uma no seu worktree, com o agente do pool que o escalonador der a ela.
   *
   * Ausente é o build serial de sempre, inalterado. Presente, ou o paralelo
   * roda de verdade, ou o build não começa — nunca serial com nome de paralelo.
   */
  parallel?: {
    maxConcurrency: number;
    agentes: AgenteDoPool[];
    /** O que o CLI resolveu e quer na tela antes de começar: modo, agentes, limitações. */
    resumo: string[];
  };
  /** O estado de cada agente do pool, para quem desenha. */
  onWorker?: WorkerProgressListener;
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
  /** Sessões reais de instalação, inclusive quando nenhuma fase pôde começar. */
  preparation?: { sessions: number; evidence: string[] };
}

/**
 * Um instante gravado, dito no relógio de quem lê.
 *
 * O arquivo guarda ISO em UTC — ordenável e não ambíguo —, e a mensagem mostra a
 * hora local: "desde 2026-09-25T00:12:03.918Z" faz quem está às nove da noite
 * fazer a conta de cabeça para saber se o processo é de agora ou de ontem.
 */
function quandoLocal(iso: string): string {
  const instante = new Date(iso);
  return Number.isNaN(instante.getTime()) ? iso : instante.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });
}

/** O orçamento que esta execução usa, como o runner o calcula, para o `run.json` (spec §5.2). */
function orcamentoDoRun(options: BuildOptions): RunBudgets {
  const efetivo = orcamentoEfetivo(options.maxCycles ?? DEFAULT_MAX_CYCLES, options.maxVerifierRepairs ?? 0, options.orcamento);
  const contrato = options.verifierResume ?? null;
  const retomada =
    efetivo.reparosDoVerificador === 0 || contrato === null || contrato.elevacao !== "por-invocacao"
      ? "desligada"
      : contrato.estado === "garantido"
        ? "garantida"
        : options.verifierResumeUnverified === true
          ? "não verificada, pedida"
          : "desligada";
  return {
    cycles: efetivo.ciclos,
    repairsPerCycle: efetivo.porCiclo,
    repairsPerGate: efetivo.porGate,
    repairsPerDefect: efetivo.porDefeito,
    verifierRepairs: efetivo.reparosDoVerificador,
    verifierResume: retomada,
  };
}

export async function runBuild(options: BuildOptions): Promise<BuildOutcome> {
  const preparation = { sessions: 0, evidence: [] as string[] };
  const outcome = await performBuild(options, preparation);
  return preparation.sessions > 0 ? { ...outcome, preparation } : outcome;
}

async function performBuild(options: BuildOptions, preparation: NonNullable<BuildOutcome["preparation"]>): Promise<BuildOutcome> {
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
  let declaredRequirements;
  try {
    const skeleton = await readFile(join(artifactPaths(options.projectRoot).init, "skeleton.md"), "utf8").catch(() => "");
    declaredRequirements = await readEnvironmentPlan(options.projectRoot, skeleton, plan);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    announce(`erro: ${reason}`);
    return { runId, exitCode: 1, phases: [], warnings: [], errors: [reason], acceptance: null };
  }

  /*
   * A arquitetura aprovada, conferida antes de qualquer sessão (§125): o
   * documento publicado tem de ser o carimbado, e a forma estruturada só vira
   * fatia se renderizar igual a ele.
   */
  const arquitetura = await vincularArquitetura(options.projectRoot, plan, options.architecture ?? null, options.skeleton ?? null);
  if (arquitetura.vinculo.errors.length > 0) {
    for (const erro of arquitetura.vinculo.errors) announce(`erro: ${erro}`);
    return { runId, exitCode: 1, phases: [], warnings: [], errors: arquitetura.vinculo.errors, acceptance: null };
  }

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
      `já há um build deste plano em execução no pid ${emExecucao.pid} (desde ${quandoLocal(emExecucao.startedAt)}), ` +
      "e é ele que está escrevendo na árvore. Espere aquele processo terminar, ou encerre-o antes de rodar de novo.";
    announce(`erro: ${razao}`);
    return { runId, exitCode: 1, phases: [], warnings: [], errors: [razao], acceptance: null };
  }

  /*
   * O repositório é PRÉ-REQUISITO do build, não uma conveniência.
   *
   * Antes era um aviso, e avisar não resolveu nada: o `assitencia` rodou três
   * ciclos sem repositório, sem ponto de retorno entre as fases, e com uma task
   * correta reprovada no gate 3 porque o verificador foi conferir "arquivos
   * versionados" numa árvore que não tinha versionamento nenhum.
   *
   * Então o build garante o repositório, na ordem que respeita de quem é o
   * trabalho: em pasta nova ele cria sem perguntar, porque não há nada de ninguém
   * ali; sobre árvore que já tem trabalho ele PERGUNTA, com as mesmas três saídas
   * do pré-requisito de sistema ausente; e sem resposta possível ele para, em vez
   * de seguir para um build que não sabe voltar atrás.
   *
   * `--no-git` continua existindo para quem versiona por fora ou usa outro
   * controle de versão. É escolha explícita de quem chamou, e a mensagem diz isso.
   */
  let repository = await isRepository(options.projectRoot);

  if (!repository && options.gitInit !== false) {
    const iniciado = await iniciarRepositorio(options.projectRoot);
    if (iniciado.criado) {
      announce("repositório Git criado: cada fase verde vira um commit, e há para onde voltar");
      repository = true;
    }
  }

  if (!repository && options.gitInit !== false) {
    if (options.askGit) {
      for (;;) {
        const escolha = lerEscolhaDeRepositorio(await options.askGit(renderSemRepositorio(), escolhaSemRepositorio()));
        if (escolha === null) {
          announce("  responda com 1, 2 ou 3.");
          continue;
        }
        if (escolha === "abortar") break;
        if (escolha === "criar") {
          const criado = await iniciarRepositorio(options.projectRoot, { comTrabalhoExistente: true });
          if (!criado.criado) {
            announce(`não consegui criar o repositório: ${criado.motivo}`);
            break;
          }
          announce(
            criado.commitInicial
              ? "repositório Git criado, com o que já estava aqui no commit inicial"
              : criado.motivo !== ""
                ? `repositório Git criado; ${criado.motivo}`
                : "repositório Git criado",
          );
        }
        repository = await isRepository(options.projectRoot);
        if (repository) break;
        announce("ainda não é um repositório Git aqui.");
      }
    }

    if (!repository) {
      const razao = [
        "este projeto não é um repositório Git, e o build precisa de um.",
        "",
        "Cada fase verde vira um commit, e é o único ponto de retorno que existe: sem ele, uma fase que",
        "quebre o que outra construiu não tem para onde voltar. E critério que fale de arquivo versionado",
        "fica impossível de provar — o verificador confere, não encontra versionamento, e reprova uma task",
        "correta.",
        "",
        "  git init && git add -A && git commit -m \"estado inicial\"",
        "",
        "Se você versiona este projeto por fora, ou usa outro controle de versão, rode com --no-git: o",
        "loop roda igual, sem commit por fase.",
      ].join("\n");
      announce(`erro: ${razao}`);
      return { runId, exitCode: 1, phases: [], warnings: [], errors: [razao], acceptance: null };
    }
  }

  if (repository) {
    if (await adoptPreparedDependencies(options.projectRoot, declaredRequirements)) announce("dependências já preparadas registradas pelo Core; instalação preservada para iniciar as fases");
    const locais = await artefatosLocaisIgnorados(options.projectRoot, (await lerStatus(options.projectRoot)).map(entrada => entrada.caminho));
    if (locais.size > 0) announce(`${locais.size} arquivo(s) de artefatos locais ignorados já versionados diferem do HEAD; mantidos no disco, fora das alterações do produto`);
  }
  const checked = await preflight({
    projectRoot: options.projectRoot,
    runId,
    ...(options.explicitTestCommand !== undefined ? { explicitTestCommand: options.explicitTestCommand } : {}),
    git: await (async () => {
      const clean = repository ? await isClean(options.projectRoot) : true;
      /*
       * Árvore suja com arquivo sensível: o preflight diz qual é ANTES de
       * sugerir `git add -A` — seguida às cegas, a sugestão levaria o segredo
       * para o histórico (§100).
       */
      const sensiveis = clean ? [] : await admitirArvore(options.projectRoot, (await alteracoesParaCommit(options.projectRoot)).map((entrada) => entrada.caminho));
      return { repository, clean, ...(sensiveis.length > 0 ? { sensiveis } : {}) };
    })(),
    ...(options.systemInstall !== undefined ? { systemInstall: options.systemInstall } : {}),
    ...(options.environment !== undefined ? { environment: options.environment } : {}),
  });

  /*
   * Pré-requisito ausente é resolvido ANTES de qualquer chamada de modelo.
   * Três saídas — instalar agora, já instalei, abortar — e só se prossegue com a
   * dependência satisfeita de fato, confirmada por nova verificação e não pela
   * promessa de ninguém.
   */
  const missingPrerequisites = checked.ok ? checked.prerequisites.filter(item => !item.present) : checked.missingPrerequisites;
  if (missingPrerequisites.length > 0 && (options.askPrerequisite !== undefined || (options.systemInstall === true && options.installPrerequisites !== undefined))) {
    let resolucao: Awaited<ReturnType<typeof resolvePrerequisites>>;
    let verifiedInstallation: PrerequisiteStatus[] | null = null;
    try {
      resolucao = await resolvePrerequisites(missingPrerequisites, {
        verify: async requirements => {
          const statuses = verifiedInstallation ?? await checkPrerequisites(requirements, { cwd: options.projectRoot, ...(options.environment ? { environment: options.environment } : {}) });
          verifiedInstallation = null;
          return statuses;
        },
        choose: async (faltando) => {
          if (options.systemInstall === true && options.installPrerequisites !== undefined) return "instalar";
          for (;;) {
            const perguntar = options.askPrerequisite;
            if (!perguntar) return "abortar";
            const escolha = readPrerequisiteChoice(await perguntar(renderPrerequisiteChoice(faltando), prerequisiteChoice(faltando)));
            if (escolha) return escolha;
            announce("  responda com 1, 2 ou 3.");
          }
        },
        install: async (faltando) => {
          const prompt = installPrompt({
            language: options.language,
            missing: faltando,
          });
          const paths = runPaths(options.projectRoot, runId);
          await mkdir(paths.prompts, { recursive: true });
          await mkdir(paths.logs, { recursive: true });
          const id = `environment-install-${randomUUID()}`;
          // Não arquivar os registros recém-criados junto dos logs do run anterior.
          const records = join(paths.root, "preparation");
          await mkdir(records, { recursive: true });
          const promptPath = join(records, `${id}.md`);
          const logPath = join(records, `${id}.json`);
          await writeAtomic(promptPath, prompt);
          preparation.sessions += 1;
          preparation.evidence.push(promptPath, logPath, paths.events);
          const metadata = { timestamp: now().toISOString(), stage: "preflight", role: "builder", root: options.projectRoot,
            ...options.roles?.builder, attempt: preparation.sessions, prompt: promptPath, log: logPath };
          await writeAtomic(logPath, JSON.stringify({ ...metadata, status: "started" }, null, 2));
          await appendFile(join(paths.logs, "calls.jsonl"), `${JSON.stringify(metadata)}\n`);
          await appendEvent(paths.events, { timestamp: now().toISOString(), stage: "preflight", subject: "environment",
            attempt: preparation.sessions, status: "started", detail: `sessão de instalação: ${logPath}` });
          let response: EngineResult | void;
          try {
            response = await options.installPrerequisites?.(prompt);
          } catch (error) {
            await writeAtomic(logPath, JSON.stringify({ ...metadata, status: "failed", error: error instanceof Error ? error.message : String(error) }, null, 2));
            throw error;
          }
          const gate = response ? gate0(response, options.engine) : { green: true as const };
          const canVerify = response && !gate.green && !response.timedOut && !response.engineError && !response.providerFailure && response.resultRead !== false;
          if (canVerify) verifiedInstallation = await checkPrerequisites(faltando, { cwd: options.projectRoot, ...(options.environment ? { environment: options.environment } : {}) });
          const recovered = verifiedInstallation !== null && verifiedInstallation.every(status => status.present);
          await writeAtomic(logPath, JSON.stringify({ ...metadata, status: recovered ? "recovered" : gate.green ? "complete" : "failed", response: response ?? null,
            ...(verifiedInstallation ? { readiness: verifiedInstallation } : {}) }, null, 2));
          await appendEvent(paths.events, { timestamp: now().toISOString(), stage: "preflight", subject: "environment",
            attempt: preparation.sessions, status: gate.green || recovered ? "complete" : "blocked", detail: recovered
              ? `sessão terminou com código ${response!.exitCode}, mas o Core comprovou todos os requisitos; instalação reaproveitada: ${logPath}`
              : gate.green ? `sessão entregue; comprovar prontidão: ${logPath}` : gate.cause });
          if (recovered) announce(`instalação comprovada pelo Core apesar do código ${response!.exitCode} da sessão; seguindo sem reinstalar`);
          if (!gate.green && !recovered) throw new Error(gate.cause);
        },
        announce,
      }, 2);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      const reason = `a preparação do ambiente falhou antes do desenvolvimento: ${error instanceof Error ? error.message : String(error)}`;
      announce(`erro: ${reason}`);
      return { runId, exitCode: 1, phases: [], warnings: [], errors: [reason], acceptance: null };
    }

    if (!resolucao.resolved) {
      announce(`erro: ${resolucao.reason}`);
      for (const status of resolucao.missing) announce(`  ${status.technology}: ${status.path ? `prontidão reprovada em ${status.cwd ?? options.projectRoot}` : `${status.binary} não está no PATH`}`);
      return { runId, exitCode: 1, phases: [], warnings: [], errors: [`a preparação do ambiente falhou antes do desenvolvimento: ${resolucao.reason}`], acceptance: null };
    }

    announce(`pré-requisitos satisfeitos: ${resolucao.installed.join(", ") || "nada faltava"}`);
    if (repository && await adoptPreparedDependencies(options.projectRoot, declaredRequirements)) announce("preparação das dependências registrada pelo Core antes dos worktrees");
    if (checked.ok) {
      checked.prerequisites = checked.prerequisites.map(item => resolucao.statuses.find(updated => updated.binary === item.binary && updated.technology === item.technology) ?? item);
      checked.warnings = checked.warnings.filter(item => item.code !== "instala-sistema");
    }
    // Sem a pergunta na segunda passada: o que faltava foi resolvido, e um build
    // que voltasse a perguntar entraria em laço.
    if (!checked.ok) {
      const { askPrerequisite: _resolvido, ...semPergunta } = options;
      return performBuild(semPergunta, preparation);
    }
  }

  if (!checked.ok) {
    for (const error of checked.errors) announce(`erro: ${error}`);
    for (const error of checked.contractErrors) announce(`  linha ${error.line}: ${error.code} ${error.message} → ${error.hint}`);
    return { runId, exitCode: 1, phases: [], warnings: [], errors: checked.errors, acceptance: null };
  }

  if (missingPrerequisites.length > 0 && options.installPrerequisites === undefined && options.askPrerequisite === undefined) {
    const reason = "não foi possível preparar os pré-requisitos antes da construção: " + missingPrerequisites.map(item => item.technology).join(", ");
    return { runId, exitCode: 1, phases: [], warnings: checked.warnings, errors: [reason], acceptance: null };
  }

  if (options.systemInstall === true) {
    // Default perigoso não pode rodar calado.
    announce("ATENÇÃO: o executor roda com acesso de sistema e pode instalar pacotes com sudo nesta máquina.");
    announce("         Use --no-system-install para mantê-lo dentro do workspace.");
  }
  for (const warning of checked.warnings) announce(`aviso: ${warning.message}`);
  for (const aviso of arquitetura.vinculo.warnings) announce(`aviso: ${aviso}`);
  if (arquitetura.vinculo.bound.length > 0) {
    announce(`arquitetura do plan vinculada: ${arquitetura.vinculo.bound.length} de ${checked.sessions.length} fase(s) recebem a fatia com componentes e contratos`);
  }

  /*
   * O que está garantido sobre o Git do executor, dito antes da primeira
   * chamada (§101): impedido só onde o sandbox do provider impede de fato;
   * no resto, o Core detecta e para — e diz isso.
   */
  if (checked.commitsEnabled) {
    const executores = options.parallel
      ? options.parallel.agentes.map((agente) => ({ provider: agente.engine, sistema: agente.systemInstall }))
      : [{ provider: options.engine, sistema: options.systemInstall === true }];
    const ditas = new Set<string>();
    for (const executor of executores) {
      const garantia = garantiaDeAutoridade(executor.provider, executor.sistema);
      if (ditas.has(garantia)) continue;
      ditas.add(garantia);
      announce(`autoridade Git: ${garantia}`);
    }
  }

  /*
   * O resumo da execução paralela, antes de qualquer chamada de modelo: quem
   * pediu quatro agentes precisa ver com que modelos, o que não vai funcionar
   * como esperado, e se o isolamento está garantido — e o build só segue se o
   * paralelo for de fato possível aqui.
   */
  if (options.parallel) {
    const isolamento = await conferirIsolamento(options.projectRoot, {
      commitsEnabled: checked.commitsEnabled,
      containerized: checked.testCommand?.containerized ?? false,
    });
    for (const linha of options.parallel.resumo) announce(linha);
    const largura = larguraDoPlano(checked.sessions);
    announce(
      largura >= options.parallel.maxConcurrency
        ? `o grafo deste plano deixa até ${largura} fase(s) rodarem ao mesmo tempo`
        : `o grafo deste plano deixa no máximo ${largura} fase(s) ao mesmo tempo: ${options.parallel.maxConcurrency - largura} agente(s) não terão o que fazer`,
    );
    if (isolamento.impedimentos.length > 0) {
      const razao = [
        "a execução paralela foi pedida, mas não pode rodar aqui:",
        ...isolamento.impedimentos.map((motivo) => `  · ${motivo}`),
        "",
        "Rode com --serial para construir uma fase por vez.",
      ].join("\n");
      announce(`erro: ${razao}`);
      return { runId, exitCode: 1, phases: [], warnings: checked.warnings, errors: [razao], acceptance: null };
    }
    announce(
      isolamento.motivos.length === 0
        ? "isolamento: cada agente num worktree próprio; nenhum recurso compartilhado declarado até aqui (reavaliado antes de cada fase)"
        : `isolamento: ${isolamento.motivos.join("; ")} — um agente por vez enquanto valer`,
    );
    for (const limitacao of isolamento.limitacoes) announce(`limitação: ${limitacao}`);
    /*
     * O worktree parte de um commit. Repositório recém-criado numa pasta
     * vazia ainda não tem nenhum: um commit vazio dá a base, e não muda nada
     * na árvore.
     */
    if (await garantirBase(options.projectRoot)) announce("repositório sem commit nenhum: criado um commit vazio, base dos worktrees");
  }

  const lock = await acquireLock({ projectRoot: options.projectRoot, runId, command: "build", now });
  const paths = runPaths(options.projectRoot, runId);
  const previousState = await readRunState(options.projectRoot, runId);
  const snapshot = createRunState({
    runId,
    command: "build",
    language: options.language,
    now,
    ...(options.roles ? { roles: options.roles } : {}),
    sources: [{ name: "project-phases.md", sha12: sha12(plan) }],
    budgets: orcamentoDoRun(options),
  });
  if (previousState) snapshot.createdAt = previousState.createdAt;

  try {
    if (previousState) {
      const attempt = `${now().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
      const archive = join(paths.root, "attempts", attempt);
      await mkdir(archive, { recursive: true });
      await writeAtomic(join(archive, "run.json"), JSON.stringify(previousState, null, 2));
      for (const name of ["logs", "prompts"]) {
        await rename(join(paths.root, name), join(archive, name)).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
        await mkdir(join(paths.root, name), { recursive: true });
      }
    }
    await writeRunState(options.projectRoot, snapshot, now);
    const environment = await prepareBuildEnvironment(options.projectRoot, options.testRunner ?? defaultTestRunner, announce, {
      browser: options.skipFlows !== true && options.flowRunner === undefined && (options.skeleton?.workflows.length ?? 0) > 0,
      systemInstall: options.systemInstall === true,
    });
    await writeAtomic(join(paths.logs, "environment-preflight.log"), `${JSON.stringify(checked.prerequisites, null, 2)}\n\n${environment.evidence}`);
    if (!environment.ok) {
      const reason = `a preparação do ambiente falhou antes do desenvolvimento; nenhuma fase foi iniciada. Evidência: ${join(paths.logs, "environment-preflight.log")}\n${environment.evidence}`;
      await writeRunState(options.projectRoot, { ...snapshot, status: "blocked", stage: "preflight" }, now);
      announce(reason);
      return { runId, exitCode: 1, phases: [], warnings: checked.warnings, errors: [reason], acceptance: null };
    }
    announce("ambiente aprovado; iniciando desenvolvimento sem repetir as sondas de prontidão nas fases");
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
            /*
             * TODOS os cumpridos, na ordem em que foram cumpridos — inclusive os
             * que esta fase cobre de novo (§103). A passagem roda em sequência
             * sobre um banco só, e cada roteiro foi escrito contando com o que os
             * anteriores deixaram. Tirar daqui os fluxos da fase os jogava para a
             * ordem do plano: na P06 do piloto paralelo, que cobria os cinco, a
             * ordem 5,1,4,2,3 virou 1,2,3,4,5, os quatro roteiros certos
             * reprovaram um atrás do outro, e a fase gastou dois ciclos do
             * executor e parou. O gate 4 tira a repetição e mantém a primeira
             * posição; os fluxos novos da fase vão para o fim, como antes.
             */
            regressao: [...fluxosCumpridos],
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

    options.onPlanned?.(
      checked.sessions.map((session) => ({ id: session.id, title: session.title, taskCount: session.taskCount })),
      // O comando do gate 2 é a única coisa do preflight que quem olha a tela
      // precisa saber de cor: é ele que decide se a suíte roda de verdade.
      // O run também: é a pasta onde quem desenha grava o log de cada agente.
      { ...(checked.testCommand ? { testCommand: checked.testCommand.command } : {}), runId },
    );

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
    /*
     * A TERCEIRA memória, uma granularidade abaixo: a task já verificada.
     *
     * As duas de cima evitam refazer uma FASE. Esta evita repergunta dentro da
     * fase que ainda não fechou — que é onde o run morria: catorze tasks relidas
     * por ciclo, duas incompletas por vez, sempre outras duas. `--rebuild-all`
     * limpa esta também, porque quem pede para refazer tudo pede isso mesmo.
     */
    const aprovadas = await TasksAprovadas.abrir(options.projectRoot, runId, options.rebuildAll === true);
    /*
     * O registro de evidências do run (§125 B): um só, para que no paralelo as
     * fases registrem pela mesma fila, e para a regressão do G4 de uma fase ver
     * a prova dos fluxos que outra percorreu.
     */
    const livro = await LivroDeEvidencias.abrir(paths.root, runId);
    const shaFechado = new Map(fechadasAntes.map((fase) => [fase.sha, fase]));

    const phases: PhaseReport[] = [];

    /** As opções de uma fase — no serial, na raiz; no paralelo, no worktree dela. */
    const opcoesDaFase = (session: PhaseSession, execucao?: ExecucaoDaFase): Parameters<typeof runPhase>[0] => {
      const arvore = execucao?.workRoot ?? options.projectRoot;
      const fluxos = fluxosDaFase ? fluxosDaFase(session.number) : null;
      const fatia = arquitetura.fatia(session.number);
      return {
        ...(fatia ? { architecture: fatia } : {}),
        evidencias: livro,
        ...(options.rebuildAll === true ? { refazer: true } : {}),
        ...(revalidarFase.has(session.id) ? { revalidar: revalidarFase.get(session.id)! } : {}),
        territorioDoFluxo: (workflow, donos) => arquitetura.territorio(workflow, donos, session.number),
        ...(options.orcamento ? { orcamento: options.orcamento } : {}),
        ...(options.verifierResume !== undefined ? { verifierResume: options.verifierResume } : {}),
        ...(options.verifierResumeUnverified === true ? { verifierResumeUnverified: true } : {}),
        projectRoot: options.projectRoot,
        runId,
        language: options.language,
        engine: execucao?.engine ?? options.engine,
        session,
        testCommand: checked.testCommand,
        environmentApproved: true,
        resolveTest: () =>
          resolveTestCommand(arvore, {
            ...(options.explicitTestCommand !== undefined ? { explicit: options.explicitTestCommand } : {}),
            ...(options.environment !== undefined ? { environment: options.environment } : {}),
          }),
        call: options.call,
        ...(skills.length > 0 ? { skills: skillsDaFase(session.id, session.areas) } : {}),
        ...(options.onMemorias ? { onMemorias: options.onMemorias } : {}),
        ...(fluxos
          ? {
              flows: {
                ...fluxos,
                ...(execucao ? { resolveStart: () => startCommandFor(arvore), preferredPort: execucao.preferredPort } : {}),
              },
            }
          : {}),
        ...(options.testRunner !== undefined ? { testRunner: options.testRunner } : {}),
        aprovadas,
        systemInstall: execucao?.systemInstall ?? options.systemInstall === true,
        ...(options.maxCycles !== undefined ? { maxCycles: options.maxCycles } : {}),
        ...(options.maxVerifierRepairs !== undefined ? { maxVerifierRepairs: options.maxVerifierRepairs } : {}),
        commitsEnabled: checked.commitsEnabled,
        announce,
        ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
        ...(options.sleep !== undefined ? { sleep: options.sleep } : {}),
        now,
        ...(execucao ? { workRoot: execucao.workRoot, worker: execucao.worker, integracaoPendente: true, conferirPrincipal: execucao.conferirPrincipal, ...(execucao.integrationFailure ? { integrationFailure: execucao.integrationFailure } : {}) } : {}),
      };
    };

    /*
     * Os fluxos da fase entram nos cumpridos na ordem em que a fase FECHOU (§104).
     *
     * A passagem roda os roteiros nessa ordem, e cada um foi escrito contando com
     * o que os anteriores deixaram. Ao vivo, a ordem de chegada já é essa; na
     * retomada, as fases puladas chegam na ordem do PLANO — e no paralelo as duas
     * divergem: no piloto, P01, P02, P05, P03, P04 fecharam nessa ordem (fluxos
     * 5,1,4,2,3), e a retomada os reconstruiria como 5,1,2,3,4. O ledger guarda
     * quando cada fase fechou; sem a data, o fluxo fica junto do anterior.
     */
    const cumpridoEm = new Map<string, string>();
    const cumprir = (session: PhaseSession, fechadaEm: string | undefined): void => {
      if (esqueleto === null) return;
      for (const workflow of workflowsForPhase(esqueleto, session.number)) {
        if (fluxosCumpridos.some((cumprido) => cumprido.number === workflow.number)) continue;
        const anterior = fluxosCumpridos.at(-1);
        fluxosCumpridos.push(workflow);
        cumpridoEm.set(workflow.number, fechadaEm ?? (anterior ? (cumpridoEm.get(anterior.number) ?? "") : ""));
      }
      // `sort` é estável: empate fica na ordem de chegada.
      fluxosCumpridos.sort((a, b) => (cumpridoEm.get(a.number) ?? "").localeCompare(cumpridoEm.get(b.number) ?? ""));
    };

    /** O que toda fase verde deixa: o registro no ledger e os fluxos como regressão das seguintes. */
    const aposVerde = async (session: PhaseSession): Promise<void> => {
      const fechadaEm = now().toISOString();
      const fatia = arquitetura.fatia(session.number);
      await registrarFaseFechada(options.projectRoot, {
        id: session.id,
        title: session.title,
        sha: shaDaFase(session.markdown),
        runId,
        closedAt: fechadaEm,
        // Sem fatia é "", não ausente: ausente é o registro anterior ao campo, que vale pelo texto.
        sliceSha12: fatia?.sha12 ?? "",
      });
      cumprir(session, fechadaEm);
    };

    /*
     * A fase que já fechou não roda de novo: em run anterior com o mesmo texto,
     * ou neste mesmo run antes de uma queda. O serial e o paralelo pulam pelo
     * mesmo caminho — duas cópias desta regra divergiriam na primeira correção.
     */
    /** As fases fechadas que voltam só para revalidação documental (§125). */
    const revalidarFase = new Map<string, string>();
    const pularSeFechada = (session: PhaseSession): boolean => {
      const registrada = shaFechado.get(shaDaFase(session.markdown));
      const fatiaAtual = arquitetura.fatia(session.number);
      /*
       * Mesmo texto, outra arquitetura: o contrato que a fase entrega ou
       * consome mudou, e a aprovação dela não viu o contrato novo (§125). Ela
       * volta a ser construída sobre o que já existe, em vez de ser pulada.
       */
      // Fechada sob uma fatia que hoje não se comprova (vínculo quebrado) também não vale como atual.
      const fatiaMudou = registrada?.sliceSha12 !== undefined && registrada.sliceSha12 !== (fatiaAtual?.sha12 ?? "");
      if (registrada && fatiaMudou) {
        // Vale também para a fase fechada neste mesmo run: o plano é o mesmo, a arquitetura não.
        announce(`[${session.id}] fechada no run ${registrada.runId} com o mesmo texto, mas a fatia da arquitetura mudou desde então; volta a ser verificada contra o contrato novo, sem nova implementação`);
        revalidarFase.set(session.id, `a fatia da arquitetura mudou desde que a fase fechou no run ${registrada.runId}`);
        return false;
      }
      const fechadaAntes = registrada;
      if (!done.has(session.id) && fechadaAntes) {
        announce(`[${session.id}] já fechada no run ${fechadaAntes.runId}, com este mesmo texto; não vou refazer`);
        options.onProgress?.({ kind: "phase", id: session.id, state: "concluído", cycle: 0, detail: "fechada antes" });
        for (const gate of ["G0", "G1", "G2", "G3"] as const) {
          options.onProgress?.({ kind: "gate", id: session.id, gate, state: "verde", cycle: 0 });
        }
        if (fluxosDaFase !== null) options.onProgress?.({ kind: "gate", id: session.id, gate: "G4", state: "verde", cycle: 0 });

        // O fluxo de uma fase fechada continua sendo regressão das seguintes.
        cumprir(session, shaFechado.get(shaDaFase(session.markdown))?.closedAt);
        return true;
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
        /*
         * E o fluxo dela continua sendo regressão das seguintes — como no ramo de
         * cima, o da fase fechada em run anterior. Faltava aqui: no `assistencia2`
         * retomado, a P04 rodou só os próprios fluxos, e o fluxo 2, escrito para
         * rodar depois do 1, rodou primeiro num banco sem tabela.
         */
        cumprir(session, shaFechado.get(shaDaFase(session.markdown))?.closedAt);
        return true;
      }
      return false;
    };

    /** A parada do build, igual no serial e no paralelo: evento, estado na base, código 2. */
    const parar = async (outcome: PhaseOutcome): Promise<BuildOutcome> => {
      const detail =
        outcome.status === "failed"
          ? `${outcome.gate}: ${outcome.cause}`
          : outcome.status === "credential-rejected"
            ? `o provider ${outcome.engine} recusou a credencial: ${outcome.evidence}`
            : outcome.status === "commit-blocked"
              ? outcome.cause
              : "limite de uso esgotado";
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
    };

    if (options.parallel) {
      const resultado = await executarEmParalelo({
        projectRoot: options.projectRoot,
        ...(options.rebuildAll === true ? { rebuildAll: true } : {}),
        environmentApproved: true,
        runId,
        sessions: checked.sessions,
        agentes: options.parallel.agentes,
        maxConcurrency: options.parallel.maxConcurrency,
        keepGoing: options.keepGoing === true,
        jaFechada: pularSeFechada,
        rodar: (session, execucao) => runPhase(opcoesDaFase(session, execucao)),
        ...(options.maxVerifierRepairs !== undefined ? { maxVerifierRepairs: options.maxVerifierRepairs } : {}),
        aposIntegrar: (session) => aposVerde(session),
        esquecer: async (session) => {
          const tasks = tasksDaFase(session.markdown);
          await aprovadas.revogar(session.id, tasks, tasks.map((task) => task.index));
          // A metade irmã (§125): as provas do run sobre o código que saiu da árvore também deixam de valer.
          for (const { evidence, validity } of livro.daFase(session.id)) {
            if (validity.state !== "INVALIDATED") {
              await livro.alterarValidade(evidence.evidenceId, "INVALIDATED", "o código da fase saiu da árvore principal (parcial guardado no branch da fase)", "esquecer", now);
            }
          }
        },
        isolamento: () =>
          conferirIsolamento(options.projectRoot, {
            worktreeSupported: true,
            commitsEnabled: checked.commitsEnabled,
            containerized: checked.testCommand?.containerized ?? false,
          }),
        comandoDeTeste: async () =>
          (
            await resolveTestCommand(options.projectRoot, {
              ...(options.explicitTestCommand !== undefined ? { explicit: options.explicitTestCommand } : {}),
              ...(options.environment !== undefined ? { environment: options.environment } : {}),
            })
          )?.command ?? null,
        ...(options.testRunner !== undefined ? { testRunner: options.testRunner } : {}),
        instalar: options.testRunner ?? defaultTestRunner,
        systemInstall: options.systemInstall === true,
        portaBase: FLOW_PORT,
        ...(fluxosDaFase
          ? {
              semEntrypoint: async () => (await startCommandFor(options.projectRoot)) === null,
              comFluxos: (session: PhaseSession) => fluxosDaFase(session.number).workflows.length > 0,
            }
          : {}),
        announce,
        ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
        ...(options.onWorker !== undefined ? { onWorker: options.onWorker } : {}),
        ...(options.environment !== undefined ? { environment: options.environment } : {}),
        now,
      });
      for (const { session, outcome } of resultado.relatorios) phases.push({ id: session.id, title: session.title, outcome });
      if (resultado.parada) return await parar(resultado.parada.outcome);
    }

    for (const session of options.parallel ? [] : checked.sessions) {
      if (pularSeFechada(session)) {
        phases.push({ id: session.id, title: session.title, outcome: { status: "already-implemented", cycles: 0 } });
        continue;
      }

      const outcome = await runPhase(opcoesDaFase(session));

      phases.push({ id: session.id, title: session.title, outcome });

      // Fluxo que passou vira regressão das fases seguintes: é o que faz um
      // defeito introduzido na fase 5 aparecer na fase 5.
      if (outcome.status === "complete" || outcome.status === "already-implemented") await aposVerde(session);

      if (
        outcome.status === "failed" ||
        outcome.status === "rate-limit-exhausted" ||
        outcome.status === "credential-rejected" ||
        outcome.status === "commit-blocked"
      ) {
        const detail =
          outcome.status === "failed"
            ? `${outcome.gate}: ${outcome.cause}`
            : outcome.status === "credential-rejected"
              ? `o provider ${outcome.engine} recusou a credencial: ${outcome.evidence}`
              : outcome.status === "commit-blocked"
                ? outcome.cause
                : "limite de uso esgotado";
        const [primeira, ...resto] = detail.split("\n");
        announce(`[${session.id}] PAROU — ${primeira ?? ""}`);
        // A causa inteira sai aqui, e só aqui: quem chama recebe o mesmo texto
        // em `errors` para uso programático, não para reimprimir.
        for (const linha of resto) announce(`           ${linha}`);
        /*
         * `--keep-going` não vale para credencial recusada: a próxima fase bate no
         * mesmo provider com a mesma credencial, e seguir seria marcar as onze
         * restantes como falhas por um motivo que não é delas.
         */
        /*
         * Nem o commit bloqueado (§100): a fase seguinte construiria sobre um
         * trabalho fora do histórico, e o commit dela levaria o mesmo arquivo.
         */
        if (!options.keepGoing || outcome.status === "credential-rejected" || outcome.status === "commit-blocked") return await parar(outcome);
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
    try {
      const lastEvent = (await readEvents(paths.events)).at(-1);
      snapshot.stage = lastEvent
        ? lastEvent.stage === "complete" ? "complete" : lastEvent.stage === "validate" ? "validate" : "implement"
        : snapshot.stage;
      snapshot.subject = lastEvent?.subject ?? "-";
      snapshot.attempt = lastEvent?.attempt ?? 0;
      snapshot.status = lastEvent?.status === "complete" && lastEvent.stage === "complete"
        ? "complete"
        : lastEvent?.status === "paused" ? "paused" : "blocked";
      await writeRunState(options.projectRoot, snapshot, now);
    } finally {
      await lock.release();
    }
  }
}
