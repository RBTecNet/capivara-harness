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
import { cobreWorkflow, workflowsForPhase, type Adiamento, type Architecture, type Disponibilidade, type Skeleton, type SkeletonWorkflow } from "../contract/index.js";
import { disponibilidadeNoBuild, vincularArquitetura } from "./arquitetura.js";
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
import { arquivosMudados, commitDaEntrega, estadoDoCodigo, escolhaSemRepositorio, noHistoricoDoHead, iniciarRepositorio, isClean, isRepository, lerEscolhaDeRepositorio, renderSemRepositorio } from "./git.js";
import { gravarRelatorio } from "./relatorio.js";
import { comBancosDeTeste } from "./test-databases.js";
import { prepararAmbiente } from "./ambiente.js";
import { montarEntrega, renderEntrega } from "./entrega.js";
import { materializeSessions } from "./split.js";
import { preflight, type PreflightWarning } from "./preflight.js";
import { checkPrerequisites, prerequisiteChoice, readPrerequisiteChoice, renderPrerequisiteChoice, resolvePrerequisites, type PrerequisiteStatus } from "./prerequisites.js";
import { prepareBuildEnvironment } from "./environment-prepare.js";
import { readEnvironmentPlan } from "./environment-plan.js";
import type { EscolhaNumerada } from "./escolha.js";
import { resolveTestCommand } from "./testcmd.js";
import { DEFAULT_MAX_CYCLES, MARCA_FORA_DO_NAVEGADOR, runPhase, type EngineCaller, type EngineResult, type PhaseOutcome } from "./runner.js";
import { runAcceptance, type AcceptanceResult, type CommandRunner } from "./acceptance.js";
import { acceptancePrompt, installPrompt } from "../prompts/index.js";
import type { BuildProgressListener } from "./progress.js";
import { lerFasesFechadas, registrarFaseFechada, shaDaFase } from "./ledger.js";
import { TasksAprovadas, tasksDaFase } from "./veredictos.js";
import { defaultTestRunner, gate0, gate2, type TestRunner } from "./gates.js";
import { adoptPreparedDependencies, conteudoDe, criadosPelaPreparacao, explicarPreparacaoNaoAdotada, pendentesDaPreparacao } from "./prepared-dependencies.js";
import { admitirArvore, alteracoesParaCommit, artefatosLocaisIgnorados, lerStatus } from "./admissao.js";
import { garantiaDeAutoridade } from "./autoridade.js";
import { conferirIsolamento } from "./isolamento.js";
import { larguraDoPlano } from "./escalonador.js";
import { executarEmParalelo, type AgenteDoPool, type ExecucaoDaFase } from "./paralelo.js";
import { FLOW_PORT, citaOContrato } from "./flows.js";
import { stackDoSkeleton } from "../prompts/acceptance-policy.js";
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
    if (await adoptPreparedDependencies(options.projectRoot, declaredRequirements, await criadosPelaPreparacao(join(runPaths(options.projectRoot, runId).root, "preparation")))) announce("dependências já preparadas registradas pelo Core; instalação preservada para iniciar as fases");
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
          /*
           * A proveniência da adoção (§131): o que esta sessão deixou na árvore —
           * pendente depois e não antes, ou já atestado por uma sessão anterior
           * deste run e mexido de novo — vai para o registro com o conteúdo. O
           * que já estava pendente é de quem o escreveu, e a adoção nunca o
           * leva. Sem a leitura, a sessão segue sem proveniência, e nada dela é
           * adotado.
           */
          const antes = repository ? await pendentesDaPreparacao(options.projectRoot).catch(() => null) : null;
          const proveniencia = async (): Promise<{ pendentesAntes?: string[]; criados?: { caminho: string; sha256: string }[] }> => {
            if (antes === null) return {};
            const depois = await pendentesDaPreparacao(options.projectRoot).catch(() => null);
            if (depois === null) return { pendentesAntes: antes };
            const jaEstavam = new Set(antes);
            const atestados = await criadosPelaPreparacao(records) ?? new Map<string, Set<string>>();
            const criados: { caminho: string; sha256: string }[] = [];
            for (const caminho of depois.filter(caminho => !jaEstavam.has(caminho) || atestados.has(caminho))) {
              const sha256 = await conteudoDe(join(options.projectRoot, caminho));
              if (sha256 !== null) criados.push({ caminho, sha256 });
            }
            return { pendentesAntes: antes, criados };
          };
          await writeAtomic(logPath, JSON.stringify({ ...metadata, ...(antes ? { pendentesAntes: antes } : {}), status: "started" }, null, 2));
          await appendFile(join(paths.logs, "calls.jsonl"), `${JSON.stringify(metadata)}\n`);
          await appendEvent(paths.events, { timestamp: now().toISOString(), stage: "preflight", subject: "environment",
            attempt: preparation.sessions, status: "started", detail: `sessão de instalação: ${logPath}` });
          let response: EngineResult | void;
          try {
            response = await options.installPrerequisites?.(prompt);
          } catch (error) {
            await writeAtomic(logPath, JSON.stringify({ ...metadata, ...(await proveniencia()), status: "failed", error: error instanceof Error ? error.message : String(error) }, null, 2));
            throw error;
          }
          const gate = response ? gate0(response, options.engine) : { green: true as const };
          const canVerify = response && !gate.green && !response.timedOut && !response.engineError && !response.providerFailure && response.resultRead !== false;
          if (canVerify) verifiedInstallation = await checkPrerequisites(faltando, { cwd: options.projectRoot, ...(options.environment ? { environment: options.environment } : {}) });
          const recovered = verifiedInstallation !== null && verifiedInstallation.every(status => status.present);
          await writeAtomic(logPath, JSON.stringify({ ...metadata, ...(await proveniencia()), status: recovered ? "recovered" : gate.green ? "complete" : "failed", response: response ?? null,
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
    const preparacoes = join(runPaths(options.projectRoot, runId).root, "preparation");
    if (repository && await adoptPreparedDependencies(options.projectRoot, declaredRequirements, await criadosPelaPreparacao(preparacoes))) announce("preparação das dependências registrada pelo Core antes dos worktrees");
    /*
     * A preparação que não pôde ser adotada para o build aqui (§131), antes da
     * primeira fase. Seguir com ela pendente levava o manifesto (e, sem
     * exclusão, o `node_modules`) para o commit da fase no serial, e barrava a
     * integração da fase verde no paralelo, depois de pago o trabalho. Árvore
     * que já estava suja antes cai no preflight da segunda passada, como sempre.
     */
    if (repository && checked.ok && !(await isClean(options.projectRoot))) {
      const pendentes = await pendentesDaPreparacao(options.projectRoot).catch(() => []);
      const reason = [
        `depois da preparação do ambiente, a árvore principal tem alterações que o Core não pôde adotar (${pendentes.slice(0, 8).join(", ")}${pendentes.length > 8 ? ", …" : ""}); nenhuma fase foi iniciada.`,
        await explicarPreparacaoNaoAdotada(options.projectRoot, preparacoes) ?? "Se são suas, commite-as; se vieram da preparação, apague-as — ela os refaz na próxima execução.",
      ].join("\n");
      announce(`erro: ${reason}`);
      return { runId, exitCode: 1, phases: [], warnings: checked.warnings, errors: [reason], acceptance: null };
    }
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
    // Árvore suja com preparação registrada neste run: dizer por que ela não foi adotada (§131).
    const preparacaoNaoAdotada = repository && checked.errors.some(error => error.includes("alterações não commitadas"))
      ? await explicarPreparacaoNaoAdotada(options.projectRoot, join(runPaths(options.projectRoot, runId).root, "preparation"))
      : null;
    if (preparacaoNaoAdotada) checked.errors.push(preparacaoNaoAdotada);
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
    /** A Stack de agora: a decisão "fora do navegador" de uma fase fechada só vale enquanto o trecho citado estiver nela (§133). */
    const stackAtual = stackDoSkeleton(await readFile(join(options.projectRoot, ".capivara/init/skeleton.md"), "utf8").catch(() => ""));
    // Sem gate de fluxos nesta execução, nada reabre por isso: o G4 nem poderia perguntar de novo.
    const trechoQueSaiu = (fechada: { foraDoNavegador?: { workflow: string; trecho: string }[] } | undefined) =>
      esqueleto === null ? undefined : fechada?.foraDoNavegador?.find((fluxo) => !citaOContrato(fluxo.trecho, stackAtual));
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

    /*
     * Quando cada fluxo pode ser cobrado (§127): a mesma derivação que o plano
     * usou para escrever e auditar. A fase cobra os fluxos que cobre — menos os
     * que o plano deixa EXPLICITAMENTE para uma fase posterior que também os
     * cobre e espera por ela (o texto da fase a nomeia; ou o caminho do fluxo
     * pela arquitetura só fica de pé lá). No Luna a P4 cobria o workflow 3 e
     * dizia "pronta para a integração … na fase 6", e o G4 o cobrou na P4.
     */
    const disponibilidade: Disponibilidade | null = esqueleto === null ? null : disponibilidadeNoBuild(esqueleto, arquitetura.tempo());
    const cobradosNaFase = (phaseNumber: number): SkeletonWorkflow[] => {
      if (esqueleto === null) return [];
      const cobrados = new Set(disponibilidade?.cobrados(phaseNumber) ?? []);
      return workflowsForPhase(esqueleto, phaseNumber).filter((workflow) => cobrados.has(workflow.number));
    };
    // O que a guarda final acusaria já se sabe aqui: o fluxo que nenhuma fase cobre é dito antes da primeira fase.
    if (esqueleto !== null) {
      const descobertos = esqueleto.workflows.filter((workflow) => !esqueleto.phases.some((phase) => cobreWorkflow(phase.covers, workflow.number)));
      for (const workflow of descobertos) {
        announce(`aviso: o fluxo ${workflow.number} (${workflow.name}) não é coberto por fase nenhuma do plano; o build não declara a aplicação concluída sem ele — corrija o plano (\`capivara plan\`)`);
      }
    }
    const adiadosDaFase = (phaseNumber: number): { workflow: SkeletonWorkflow; adiamento: Adiamento }[] =>
      esqueleto === null || disponibilidade === null
        ? []
        : disponibilidade.adiados(phaseNumber).flatMap((adiamento) => {
            const workflow = esqueleto.workflows.find((cada) => cada.number === adiamento.workflow);
            return workflow ? [{ workflow, adiamento }] : [];
          });

    const fluxosDaFase =
      esqueleto !== null
        ? (phaseNumber: number) => ({
            workflows: cobradosNaFase(phaseNumber),
            ...(adiadosDaFase(phaseNumber).length > 0 ? { adiados: adiadosDaFase(phaseNumber) } : {}),
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
    /*
     * "Fechada antes" é uma afirmação sobre o código (§125 G; spec §9), e o
     * ledger guarda o HEAD em que cada fase fechou: a fase só é pulada se ele
     * continuar no histórico do HEAD de agora. Entrada antiga, sem o campo, ou
     * projeto sem Git: não há o que conferir, e o anúncio diz isso.
     */
    const historicoDaFechada = new Map<string, boolean | null>();
    for (const fase of fechadasAntes) {
      if (fase.head !== undefined) historicoDaFechada.set(fase.sha, await noHistoricoDoHead(options.projectRoot, fase.head));
    }

    const phases: PhaseReport[] = [];

    /** As opções de uma fase — no serial, na raiz; no paralelo, no worktree dela. */
    /** As fases que já começaram nesta execução: o --rebuild-all vale só para a primeira rodada de cada uma. */
    const refeitas = new Set<string>();
    const opcoesDaFase = (session: PhaseSession, execucao?: ExecucaoDaFase): Parameters<typeof runPhase>[0] => {
      const arvore = execucao?.workRoot ?? options.projectRoot;
      const fluxos = fluxosDaFase ? fluxosDaFase(session.number) : null;
      const fatia = arquitetura.fatia(session.number);
      const primeiraRodada = !refeitas.has(session.id);
      refeitas.add(session.id);
      return {
        ...(fatia ? { architecture: fatia } : {}),
        evidencias: livro,
        // Refazer é da PRIMEIRA rodada da fase nesta execução: a volta de um conflito ou da integração continua do que ela fez.
        ...(options.rebuildAll === true && primeiraRodada ? { refazer: true } : {}),
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
        ...(execucao
          ? {
              workRoot: execucao.workRoot, worker: execucao.worker, integracaoPendente: true, conferirPrincipal: execucao.conferirPrincipal,
              ...(execucao.integrationFailure ? { integrationFailure: execucao.integrationFailure } : {}),
              ...(execucao.conciliacao ? { conciliacao: execucao.conciliacao } : {}),
            }
          : {}),
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
    /**
     * O fluxo que uma fase fechou SEM percorrer, por estar o produto fora do
     * navegador (§133), e o trecho do contrato. Não é cumprido nem regressão: a
     * guarda final o nomeia, e a aplicação não se declara concluída sem prova dele.
     */
    const naoPercorridos = new Map<string, { fase: number; trecho: string }>();
    const cumprir = (session: PhaseSession, fechadaEm: string | undefined, foraDoNavegador: readonly { workflow: string; trecho: string }[] = []): void => {
      if (esqueleto === null) return;
      for (const fluxo of foraDoNavegador) naoPercorridos.set(fluxo.workflow, { fase: session.number, trecho: fluxo.trecho });
      // Só o que a fase cobrou: o fluxo que ela deixou para depois não passou aqui, e não é regressão de ninguém ainda (§127).
      for (const workflow of cobradosNaFase(session.number)) {
        if (foraDoNavegador.some((fluxo) => fluxo.workflow === workflow.number)) continue;
        if (fluxosCumpridos.some((cumprido) => cumprido.number === workflow.number)) continue;
        const anterior = fluxosCumpridos.at(-1);
        fluxosCumpridos.push(workflow);
        cumpridoEm.set(workflow.number, fechadaEm ?? (anterior ? (cumpridoEm.get(anterior.number) ?? "") : ""));
      }
      // `sort` é estável: empate fica na ordem de chegada.
      fluxosCumpridos.sort((a, b) => (cumpridoEm.get(a.number) ?? "").localeCompare(cumpridoEm.get(b.number) ?? ""));
    };

    /** O que toda fase verde deixa: o registro no ledger e os fluxos como regressão das seguintes. */
    const aposVerde = async (session: PhaseSession, outcome?: PhaseOutcome): Promise<void> => {
      const fechadaEm = now().toISOString();
      /*
       * Sem gate de fluxos (`--no-flows`), a fase não decidiu nada sobre eles: o
       * registro anterior continua valendo, e reescrevê-lo sem o campo faria a
       * execução seguinte contar o fluxo como cumprido (§133).
       */
      const foraDoNavegador = esqueleto === null
        ? shaFechado.get(shaDaFase(session.markdown))?.foraDoNavegador ?? []
        : outcome && (outcome.status === "complete" || outcome.status === "already-implemented") ? outcome.foraDoNavegador ?? [] : [];
      const fatia = arquitetura.fatia(session.number);
      // O commit que o git recusou: o código ficou na árvore, e nenhum HEAD o contém — sem HEAD no registro, e revalidada depois.
      const semCommit = checked.commitsEnabled && outcome?.status === "complete" && !outcome.committed;
      // No paralelo, depois do cherry-pick: o HEAD da principal, que já tem a fase.
      const head = checked.commitsEnabled && !semCommit ? (await estadoDoCodigo(options.projectRoot)).head : null;
      await registrarFaseFechada(options.projectRoot, {
        id: session.id,
        title: session.title,
        sha: shaDaFase(session.markdown),
        runId,
        closedAt: fechadaEm,
        // Sem fatia é "", não ausente: ausente é o registro anterior ao campo, que vale pelo texto.
        sliceSha12: fatia?.sha12 ?? "",
        ...(head ? { head } : {}),
        ...(semCommit ? { semCommit: true } : {}),
        ...(foraDoNavegador.length > 0 ? { foraDoNavegador } : {}),
      });
      cumprir(session, fechadaEm, foraDoNavegador);
    };

    /*
     * A fase que já fechou não roda de novo: em run anterior com o mesmo texto,
     * ou neste mesmo run antes de uma queda. O serial e o paralelo pulam pelo
     * mesmo caminho — duas cópias desta regra divergiriam na primeira correção.
     */
    /** As fases fechadas que voltam só para revalidação documental (§125). */
    const revalidarFase = new Map<string, string>();
    /**
     * A fase fechou antes e nada a reabre: mesmo texto, mesma fatia, commit no
     * histórico. É a pergunta que `pularSeFechada` faz, sem os efeitos — o
     * paralelo a faz para todas as fases antes de rodar qualquer uma (§127).
     */
    const fechadaIntacta = (session: PhaseSession): boolean => {
      const registrada = shaFechado.get(shaDaFase(session.markdown));
      if (!registrada) return false;
      if (registrada.sliceSha12 !== undefined && registrada.sliceSha12 !== (arquitetura.fatia(session.number)?.sha12 ?? "")) return false;
      if (trechoQueSaiu(registrada)) return false;
      return registrada.semCommit !== true && historicoDaFechada.get(registrada.sha) !== false;
    };
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
      /*
       * O fluxo que a fase deixou fora do navegador por um trecho que a Stack de
       * agora não traz mais (§133): o produto foi redefinido, e a decisão também
       * cai. A fase volta a ser verificada, sem implementação, e o G4 pergunta de
       * novo — é assim que um fluxo tirado do navegador por engano volta a ser cobrado.
       */
      const saiuDaStack = trechoQueSaiu(registrada);
      if (registrada && saiuDaStack) {
        announce(`[${session.id}] fechada no run ${registrada.runId} com o fluxo ${saiuDaStack.workflow} fora do navegador por «${saiuDaStack.trecho}», que a Stack atual não traz; volta a ser verificada, sem nova implementação`);
        revalidarFase.set(session.id, `o trecho que deixou o fluxo ${saiuDaStack.workflow} fora do navegador não está mais na Stack`);
        return false;
      }
      const fechadaAntes = registrada;
      const noHistorico = fechadaAntes ? historicoDaFechada.get(fechadaAntes.sha) : undefined;
      if (fechadaAntes?.semCommit === true) {
        announce(`[${session.id}] fechou no run ${fechadaAntes.runId} sem commit (o git recusou): o código pode não estar mais na árvore; volta a ser verificada, sem nova implementação`);
        revalidarFase.set(session.id, `a fase fechou no run ${fechadaAntes.runId} sem commit`);
        return false;
      }
      // Vale também para a fase fechada neste run: um reset no meio tira o código dela do mesmo jeito.
      if (fechadaAntes && noHistorico === false) {
        announce(`[${session.id}] fechada no run ${fechadaAntes.runId} com este mesmo texto, mas o commit em que ela fechou (${fechadaAntes.head!.slice(0, 12)}) não está no histórico do HEAD; volta a ser verificada, sem nova implementação`);
        revalidarFase.set(session.id, `o commit em que a fase fechou no run ${fechadaAntes.runId} não está no histórico do HEAD`);
        return false;
      }
      /*
       * O fluxo que outra fase deixou para esta (§127). Se a que o deixou roda
       * de novo — um `change` mudou um critério dela —, a prova que esta fase
       * tirou do fluxo é de outro código, e pular esta fase deixaria o fluxo
       * sem ser percorrido em lugar nenhum: ela volta a ser verificada, sem
       * implementação, e o G4 dela o percorre sobre o código novo.
       */
      const deixadosAqui = (disponibilidade?.todosAdiados() ?? []).filter((adiado) => {
        if (adiado.para !== session.number || !fechadaAntes) return false;
        const origem = checked.sessions.find((outra) => outra.number === adiado.fase);
        if (origem === undefined) return false;
        // A origem roda nesta execução, ou fechou DEPOIS desta (numa execução anterior deste run): a prova desta é de código velho.
        return !fechadaIntacta(origem) || (shaFechado.get(shaDaFase(origem.markdown))?.closedAt ?? "") > fechadaAntes.closedAt;
      });
      if (fechadaAntes && !done.has(session.id) && deixadosAqui.length > 0) {
        const motivo = `${deixadosAqui.map((adiado) => `o fluxo ${adiado.workflow}, que a P${String(adiado.fase).padStart(2, "0")} deixa para esta fase,`).join(" e ")} volta a ser percorrido: a fase de origem roda de novo nesta execução`;
        announce(`[${session.id}] fechada no run ${fechadaAntes.runId} com este mesmo texto, mas ${motivo}; volta a ser verificada, sem nova implementação`);
        revalidarFase.set(session.id, motivo);
        return false;
      }
      if (!done.has(session.id) && fechadaAntes) {
        announce(
          `[${session.id}] já fechada no run ${fechadaAntes.runId}, com este mesmo texto` +
            `${noHistorico === true ? " e o código dela no histórico do HEAD" : " (a presença do código não é conferida: o registro não guarda o commit)"}; não vou refazer`,
        );
        options.onProgress?.({ kind: "phase", id: session.id, state: "concluído", cycle: 0, detail: "fechada antes" });
        for (const gate of ["G0", "G1", "G2", "G3"] as const) {
          options.onProgress?.({ kind: "gate", id: session.id, gate, state: "verde", cycle: 0 });
        }
        // Verde diria que a aplicação foi aberta; o fluxo fora do navegador não foi (§133).
        if (fluxosDaFase !== null) options.onProgress?.({ kind: "gate", id: session.id, gate: "G4", state: fechadaAntes.foraDoNavegador?.length ? "neutro" : "verde", cycle: 0 });

        // O fluxo de uma fase fechada continua sendo regressão das seguintes.
        cumprir(session, shaFechado.get(shaDaFase(session.markdown))?.closedAt, shaFechado.get(shaDaFase(session.markdown))?.foraDoNavegador);
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
          // O fluxo que ficou fora do navegador não foi aberto: neutro, como no ramo da fase fechada antes (§133).
          const naoAberto = (shaFechado.get(shaDaFase(session.markdown))?.foraDoNavegador?.length ?? 0) > 0;
          options.onProgress?.({ kind: "gate", id: session.id, gate: "G4", state: naoAberto ? "neutro" : "verde", cycle: 0 });
        }
        options.onProgress?.({ kind: "phase", id: session.id, state: "concluído", cycle: 0, detail: "concluída antes" });
        /*
         * E o fluxo dela continua sendo regressão das seguintes — como no ramo de
         * cima, o da fase fechada em run anterior. Faltava aqui: no `assistencia2`
         * retomado, a P04 rodou só os próprios fluxos, e o fluxo 2, escrito para
         * rodar depois do 1, rodou primeiro num banco sem tabela.
         */
        cumprir(session, shaFechado.get(shaDaFase(session.markdown))?.closedAt, shaFechado.get(shaDaFase(session.markdown))?.foraDoNavegador);
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
        // O mapa de componentes do PLAN evita o conflito previsível (§125 F).
        arquivosDaFase: (session) => arquitetura.fatia(session.number)?.arquivos ?? [],
        ...(options.maxVerifierRepairs !== undefined ? { maxVerifierRepairs: options.maxVerifierRepairs } : {}),
        aposIntegrar: (session, outcome) => aposVerde(session, outcome),
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
      if (outcome.status === "complete" || outcome.status === "already-implemented") await aposVerde(session, outcome);

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

    /*
     * §10 da especificação: a aplicação só é concluída com TODAS as fases
     * fechadas. Com `--keep-going`, uma fase que falhou (ou que ficou pulada por
     * depender dela) não parava o build — e ele terminava em "todas as fases
     * verdes", código 0, sobre um produto incompleto.
     */
    const fechadas = new Set(phases.filter((fase) => fase.outcome.status === "complete" || fase.outcome.status === "already-implemented").map((fase) => fase.id));
    const naoFechadas = checked.sessions.filter((session) => !fechadas.has(session.id));
    if (naoFechadas.length > 0) {
      const detalhe = `${naoFechadas.length} de ${checked.sessions.length} fase(s) não fecharam: ${naoFechadas.map((session) => session.id).join(", ")}`;
      announce(`aplicação NÃO concluída — ${detalhe}; a aceitação operacional não roda sobre um produto incompleto`);
      await appendEvent(paths.events, { timestamp: now().toISOString(), stage: "implement", subject: "-", attempt: 1, status: "paused", detail: detalhe });
      const primeira = phases.find((fase) => !fechadas.has(fase.id))?.outcome ?? null;
      await registrarEstado(phases, checked.sessions, primeira);
      return { runId, exitCode: 2, phases, warnings: checked.warnings, errors: [detalhe], acceptance: null };
    }

    /*
     * Nenhum fluxo fica devendo (§127): o que uma fase deixou para outra tem de
     * ter passado na que o completa. Pela derivação, a fase de destino o cobre
     * e o percorre; se, por qualquer caminho, ele não passou, a aplicação não é
     * declarada concluída com um fluxo obrigatório nunca percorrido.
     */
    if (esqueleto !== null) {
      const cumpridos = new Set(fluxosCumpridos.map((workflow) => workflow.number));
      /*
       * Defesa (§133): o livro deste run sabe o que ficou fora do navegador mesmo
       * quando o registro da fase fechada não chegou a ser gravado com isso (queda
       * entre o fim da fase e o registro). Fora do navegador sem percurso
       * posterior não é cumprido.
       */
      const historico = (await LivroDeEvidencias.abrir(paths.root, runId)).historico();
      historico.forEach((evidencia, indice) => {
        const numero = /^fora-do-navegador-(.+)$/.exec(evidencia.checkId)?.[1];
        const trecho = evidencia.inputs.extra?.["trecho"];
        if (numero === undefined || evidencia.inputs.extra?.["marca"] !== MARCA_FORA_DO_NAVEGADOR || typeof trecho !== "string") return;
        if (historico.slice(indice + 1).some((outra) => outra.checkId === `fluxo-${numero}` && outra.outcome === "PASS")) return;
        cumpridos.delete(numero);
        if (!naoPercorridos.has(numero)) naoPercorridos.set(numero, { fase: Number(evidencia.phaseId.replace(/^P/, "")), trecho });
      });
      const adiados = disponibilidade?.todosAdiados() ?? [];
      const fase = (numero: number): string => `P${String(numero).padStart(2, "0")}`;
      const devidos = esqueleto.workflows.filter((workflow) => !cumpridos.has(workflow.number)).map((workflow) => {
        const adiado = adiados.find((cada) => cada.workflow === workflow.number);
        const foraDoNavegador = naoPercorridos.get(workflow.number);
        if (foraDoNavegador) {
          return `o fluxo ${workflow.number} (${workflow.name}) não foi percorrido: o gate 4 abre a aplicação num navegador, e o contrato descreve o produto fora dele («${foraDoNavegador.trecho}», ${fase(foraDoNavegador.fase)}); as fases fecharam pelo código, sem prova do percurso`;
        }
        return adiado
          ? `o fluxo ${workflow.number} (${workflow.name}), que a ${fase(adiado.fase)} deixou para a ${fase(adiado.para)}, nunca passou no gate 4`
          : `o fluxo ${workflow.number} (${workflow.name}) nunca foi percorrido: nenhuma fase o cobrou`;
      });
      const unicos = [...new Set(devidos)];
      if (unicos.length > 0) {
        const foraDoNavegador = esqueleto.workflows.some((workflow) => !cumpridos.has(workflow.number) && naoPercorridos.has(workflow.number));
        const detalhe = `fluxo obrigatório pendente: ${unicos.join("; ")}` +
          (foraDoNavegador ? " — se o produto se usa num navegador, a Stack do skeleton está errada: corrigida a Stack, o build seguinte reabre a fase e volta a cobrar o fluxo" : "");
        announce(`aplicação NÃO concluída — ${detalhe}`);
        await appendEvent(paths.events, { timestamp: now().toISOString(), stage: "implement", subject: "-", attempt: 1, status: "paused", detail: detalhe });
        await registrarEstado(phases, checked.sessions, null);
        return { runId, exitCode: 2, phases, warnings: checked.warnings, errors: [detalhe], acceptance: null };
      }
    }

    await registrarEstado(phases, checked.sessions, null);

    // Todas as fases verdes provam que as regras estão implementadas e testadas.
    // Não provam que o produto sobe: o piloto 1b entregou 30 testes verdes sem
    // que ninguém tivesse aplicado uma migração ou aberto uma conexão.
    let acceptance: AcceptanceResult | null = null;
    const tocadosNaEntrega: string[] = [];
    /** O reparo da aceitação mudou o código sem que se saiba o quê (sem árvore do Git), ou sem suíte para prová-lo. */
    let reparoSemLista = false;
    let reparoSemSuite = false;
    /** O último estado que a suíte provou: o das fases fechadas, até um reparo da aceitação passar por ela. */
    let provadoEm: string | null = null;
    if (options.skipAcceptance !== true) {
      announce("aceitação operacional: copiando o projeto para uma pasta limpa");
      acceptance = await runAcceptance({
        projectRoot: options.projectRoot,
        ...(options.acceptanceRunner !== undefined ? { runner: options.acceptanceRunner } : {}),
        ...(options.acceptanceService !== undefined ? { service: options.acceptanceService } : {}),
      });

      provadoEm = (await estadoDoCodigo(options.projectRoot)).tree;
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
        const resposta = await options.call({
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

        /*
         * O reparo da entrega é julgado pelo Core (§125 G), contra o último
         * estado que a suíte PROVOU — não contra o começo desta tentativa: um
         * reparo que quebrou a suíte numa tentativa não é absolvido porque a
         * seguinte não mexeu em nada. O que mudou é conferido pela suíte (com
         * os bancos de teste e o preparo do G2, nunca o banco do usuário), uma
         * vez, e só então a aceitação roda de novo. G3 e G4 continuam valendo
         * para o que o reparo não tocou; o que ele tocou fica dito na entrega.
         */
        const agora = (await estadoDoCodigo(options.projectRoot)).tree;
        const listados = await arquivosMudados(options.projectRoot, provadoEm, agora);
        const mudou = listados === null ? agora === null || provadoEm === null || agora !== provadoEm : listados.length > 0;
        if (listados) tocadosNaEntrega.push(...listados);
        else if (mudou) reparoSemLista = true;
        const sessao = gate0(resposta, options.engine);
        if (!sessao.green && !mudou) {
          // A sessão que não entregou nada não é reparo: parar com a causa dela, sem gastar as tentativas restantes.
          acceptance = { accepted: false, steps: [], failure: { id: "sessão", cause: `a sessão de reparo da aceitação não entregou resultado utilizável: ${sessao.cause}\n\n${causa}` } };
          break;
        }
        if (mudou) {
          const teste = checked.testCommand ?? (await resolveTestCommand(options.projectRoot, {
            ...(options.explicitTestCommand !== undefined ? { explicit: options.explicitTestCommand } : {}),
            ...(options.environment !== undefined ? { environment: options.environment } : {}),
          }));
          if (teste) {
            const suite = await comBancosDeTeste(options.projectRoot, options.testRunner ?? defaultTestRunner, async (testar) => {
              await prepararAmbiente(options.projectRoot, testar);
              return gate2(options.projectRoot, teste.command, testar, options.systemInstall === true);
            });
            if (!suite.green) {
              acceptance = { accepted: false, steps: [], failure: { id: "suíte", cause: `o reparo da aceitação quebrou a suíte do projeto:\n${suite.cause}` } };
              continue;
            }
            provadoEm = agora;
          } else {
            reparoSemSuite = true;
          }
        }

        acceptance = await runAcceptance({
          projectRoot: options.projectRoot,
          ...(options.acceptanceRunner !== undefined ? { runner: options.acceptanceRunner } : {}),
          ...(options.acceptanceService !== undefined ? { service: options.acceptanceService } : {}),
        });
        if (acceptance.accepted && checked.commitsEnabled) {
          const commit = await commitDaEntrega(options.projectRoot, tentativa);
          announce(`aceitação: ${commit.message}`);
          // O reparo que não entra no histórico não é entrega: a aplicação não é declarada concluída com ele fora.
          if (!commit.committed && !commit.message.startsWith("nada a commitar")) {
            acceptance = { accepted: false, steps: acceptance.steps, failure: { id: "commit", cause: `a aceitação passou, mas o reparo dela não entrou no histórico: ${commit.message}. O reparo continua na árvore` } };
            break;
          }
        }
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

    /*
     * Os fluxos cuja última prova não vale mais para o conteúdo entregue
     * (spec §10: reutilizar o que está provado e dizer o que não está). O G4 não
     * é repetido inteiro aqui; o que ficou sem prova atual é dito na entrega.
     */
    const fluxosSemProvaAtual = checked.sessions.flatMap((session) =>
      livro.daFase(session.id)
        .filter(({ evidence, validity }) => evidence.gate === "G4" && /^fluxo-/u.test(evidence.checkId) && validity.state !== "VALID")
        .map(({ evidence, validity }) => `${evidence.checkId.replace("fluxo-", "fluxo ")} (${session.id}): a última prova ${validity.state === "UNKNOWN" ? "não se sabe se vale" : "não vale"} para o conteúdo entregue — ${validity.reason}`),
    );
    // As instruções e as limitações conhecidas, do que de fato rodou (spec §10).
    const entrega = await montarEntrega(options.projectRoot, acceptance, [
      ...(tocadosNaEntrega.length > 0 || reparoSemLista
        ? [
            `o reparo da aceitação tocou ${tocadosNaEntrega.length > 0 ? [...new Set(tocadosNaEntrega)].join(", ") : "arquivos que não puderam ser determinados (sem árvore do Git)"}: ` +
              `${reparoSemSuite ? "sem suíte resolvida, provado só pela aceitação" : "provado pela suíte e pela aceitação"}; a verificação independente (G3/G4) não foi repetida sobre ele`,
          ]
        : []),
      // A fase que passou e não entrou no histórico (commit recusado pelo git): o código está na árvore, e isso é dito.
      ...phases.flatMap((fase) =>
        checked.commitsEnabled && fase.outcome.status === "complete" && !fase.outcome.committed
          ? [`${fase.id} passou nos gates, mas o commit não foi criado (${fase.outcome.message}): o código está na árvore, fora do histórico`]
          : [],
      ),
      ...fluxosSemProvaAtual,
    ]);
    const caminhoDaEntrega = join(paths.root, "entrega.md");
    await writeAtomic(caminhoDaEntrega, renderEntrega(runId, entrega));
    announce(`entrega: instruções e limitações em ${caminhoDaEntrega}`);

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
      // O relatório sai do que ficou gravado, a cada fim de execução (§125 G): derivado, nunca autoridade.
      await gravarRelatorio(options.projectRoot, runId, now, checked.sessions.map((session) => session.id)).catch(() => undefined);
    } finally {
      await lock.release();
    }
  }
}
