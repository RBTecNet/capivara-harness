/**
 * A máquina de estados do `init` e do `plan`.
 *
 * `init`: entrevista → esqueleto → PLAN READY. Uma chamada olha o produto
 * inteiro, e é a única que olha.
 * `plan`: a arquitetura, uma fase por chamada, cada uma vendo só a sua fatia →
 * lacunas → conferência mecânica → uma auditoria do plano inteiro (e uma emenda,
 * no máximo) → RALPH READY. O plano é montado em código, nunca escrito de uma vez.
 *
 * Toda dependência externa entra por parâmetro — a chamada ao modelo e a
 * pergunta ao desenvolvedor. Isso é o que permite exercitar o init inteiro, do
 * pedido ao gate, sem tocar em provider real.
 */

import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { affectedPhases, architectureSliceForPhase, assemblePhasesDocument, fasesIntactas, blocoDaDisponibilidade, disponibilidadeDaArquitetura, tabelaDaDisponibilidade, buildStamp, checkCoverage, checkDesignRefs, checkTestPrescription, checkWriteOwnership, testPrescriptionHint, testPrescriptions, testToolPrescriptions, checkEntities, checkStories, checkWorkflows, assemblePhase, checkRewriteDrift, coverageFromSkeleton, extractTasks, parseArchitecture, parsePhaseFragment, parseSkeleton, phaseHeading, phasesFromArchitecture, renderArchitecture, renderSkeleton, requirementsFromArchitecture, skeletonForPlanning, sliceForPhase, normalizePhasePart, parsePhases, preserveUnaddressedTasks, sha12 } from "../contract/index.js";
import { achadoNaOrigem, alvoNoEnvelope, veioDoEnvelope } from "../audit/envelope.js";
import { tirarPedidoDeTeste } from "../audit/sem-teste.js";
import { admitir, citacoesConferidas, type Lugar } from "../audit/admissibilidade.js";
import type { Architecture, ContractError, CoverageSources, EnvironmentRequirement, PhasesDocument, Skeleton, StampInput } from "../contract/index.js";
import { DEFAULT_MAX_RETURNS, enderecoDaDecisao, balancoDaRodada, descreverBalanco, fingerprint, nextAuditAction, parseAudit, persistentFindings, writerDid } from "../audit/index.js";
import type { AuditAttempt, AuditVerdict, Finding, Remark } from "../audit/index.js";
import { tasksBlock } from "../contract/templates.js";
import { MAX_CRITERIA_PER_PHASE, MAX_CRITERIA_PER_TASK, MAX_TASKS_PER_PHASE, isRepairable, publish, repairDeterministically, stripAllMarkers, stripDeadDesignRefs, stripResolvedMarkers, substanceDefects } from "../authoring/index.js";
import { buildAnswer, buildCheckpoint, classifyLocally, DELEGAR, decisaoDeBanco, leituraInsistente, naoObjetivos, perguntaDeLacuna, perguntaDoBanco, perguntaInsistente, regrasDeBanco, needsDecisionMarkers, parseClassification, parseQuestionBatch, planRound, readHandoff, suposicaoDelegada, unresolved, writeHandoff } from "../interview/index.js";
import type { Answer, Assumption, Question } from "../interview/index.js";
import { DOCUMENTO_DO_TEMPO, repairBlock, amendPhasePrompt, architectPrompt, architectureAuditPrompt, auditRetryPrompt, languageBlock, phaseFromSlicePrompt, planAuditPrompt, skeletonPrompt, gapPrompt, interviewPrompt } from "../prompts/index.js";
import type { AskedQuestion, WriterContext } from "../prompts/index.js";
import { appendEvent, artifactPaths, createRunState, ensureArtifactTree, readEvents, runIdFor, runPaths, writeAtomic, writeRunState } from "../state/index.js";
import type { RunStage } from "../state/index.js";
import { detectRateLimit, planWait } from "../loop/ratelimit.js";
import { renderEnvironmentPlan } from "../loop/environment-plan.js";
import { sondasDoRuntimeQueFalham, type PrerequisiteStatus } from "../loop/prerequisites.js";
import { ambienteDoHarness, descreverAmbiente, inspectProject, summarizeInventory } from "./inventory.js";
import { decisoesComoMemorias, renderLibraryBlock, type McpDocument, type MemoriaParaRegistrar } from "../mcp/index.js";
import { INIT_ARTIFACTS, evaluateReadiness } from "./readiness.js";
import { contradicaoDecididaComoFinding, decisaoDoAuditorComoFinding, perguntaDaContradicao, perguntaDoAuditor } from "../interview/index.js";
import { ASSUNTO_DA_PLATAFORMA, decisaoDaPlataforma, desktopDeOutraPlataforma, perguntaDaPlataforma, regrasDaPlataforma } from "../interview/index.js";
import { NOTA_DE_ENGENHARIA, autoridadeDaDecisao, decisaoDeEngenhariaComoFinding, shaDaAutoridade, sinaisDeEngenharia } from "../audit/index.js";
import { MemoriaDoPlano } from "./plan-cache.js";
import type { PlanProgressListener } from "./progress.js";
import { evaluatePlanReadiness, renderPlanReadiness } from "./plan-readiness.js";
import { readSkeletonState, writeSkeletonState } from "./skeleton-state.js";
import { readArchitectureState, writeArchitectureState } from "./architecture-state.js";
import { writeRequestState } from "./request-state.js";
import type { Readiness } from "./readiness.js";
import type { DeveloperRequest } from "./request.js";
import { renderReport, type InitReport, type RoleCost } from "./report.js";

export interface AgentCall {
  /**
   * `verifier` aparece no init por uma razão só: o ensaio. Quem vai decidir
   * DONE ou INCOMPLETE no build é consultado antes de existir código, porque
   * depois cada descoberta custa um ciclo de correção.
   */
  role: "writer" | "auditor" | "verifier";
  stage: RunStage;
  subject: string;
  attempt: number;
  prompt: string;
}

export type AgentCaller = (call: AgentCall) => Promise<{
  /** Exclusivamente para evidência; não entra no documento nem no parser. */
  partialOutput?: string;
  stdout: string;
  exitCode: number;
  /** Tokens da chamada, quando a CLI os reporta. Ausente é "não medido". */
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number };
  /**
   * A CLI declarou a volta como erro do MOTOR, não como resposta.
   *
   * Só o build olhava isto (gate 0). No init e no plan uma CLI que falhava antes
   * de responder virava "o modelo devolveu texto inválido" e gastava tentativas
   * pedindo correção de forma a quem nunca respondeu (HANDOFF §16).
   */
  engineError?: boolean;
  /** O limite do harness que encerrou a chamada, quando foi isso. */
  timedOut?: string | null;
}>;
/** `signal` aborta quando a pergunta venceu o prazo e deve sair da tela. */
export type AskDeveloper = (question: Question, index: number, total: number, opcoes?: { signal?: AbortSignal }) => Promise<string>;

export interface InitOptions {
  projectRoot: string;
  request: DeveloperRequest;
  /** Documentos que a base documental entregou para este projeto. */
  library?: McpDocument[];
  /**
   * Devolve à base o que a entrevista fechou.
   *
   * Decisões, não respostas cruas: a resposta morre quando o pedido muda, e a
   * decisão continua verdadeira. É o que faz a segunda execução do mesmo projeto
   * não repetir dezessete perguntas.
   */
  onMemorias?: (memorias: MemoriaParaRegistrar[]) => Promise<void>;
  language: string;
  call: AgentCaller;
  /** Quem rodou: provider, modelo e effort de cada papel, para o `run.json`. */
  roles?: Record<string, { provider: string; model: string; effort: string }>;
  ask: AskDeveloper;
  /**
   * O prazo de uma pergunta do `plan`, em milissegundos (10 minutos por padrão).
   * Vencido, o run segue com a leitura recomendada e a registra como suposição.
   */
  planQuestionTimeoutMs?: number;
  /** O sistema operacional desta máquina; ausente é o do processo. Existe para teste, como o `ask`. */
  sistema?: NodeJS.Platform;
  /**
   * A tela de fases do `plan`.
   *
   * Opcional como todo o resto da observação: sem ela o estágio funciona igual e
   * as linhas de `announce` continuam sendo a saída.
   */
  onPhaseProgress?: PlanProgressListener;
  announce?: (message: string) => void;
  maxAuditReturns?: number;
  /**
   * Rodadas de DESCOBERTA da entrevista: quantas vezes vale pagar o modelo para
   * procurar perguntas novas. Não é teto de decisões — o que ficar aberto é
   * reperguntado pela insistência, que não tem teto.
   */
  maxInterviewRounds?: number;
  /**
   * Perguntas de lacuna por RODADA — não um teto de decisões.
   *
   * Havia também um `maxGapRounds`, e a multiplicação dos dois era um teto de
   * trinta decisões por run: passado ele, o que faltava virava `[NEEDS DECISION]`
   * no plano e NOT READY no gate. Ele não existe mais. Este aqui só decide
   * quantas perguntas aparecem juntas na mesma tela.
   */
  maxGapQuestions?: number;
  /** Ignora o que este run já publicou e recomeça do zero. */
  fresh?: boolean;
  /** Fases escritas ao mesmo tempo. Elas são independentes; o teto é de cortesia. */
  maxParallelParts?: number;
  /** Rodadas para fechar defeito mecânico, separadas do teto do auditor. */
  maxMechanicalRounds?: number;
  /**
   * Quantas vezes a arquitetura pode ser refeita por achado — do auditor da
   * arquitetura ou de um achado do plano endereçado a `Architecture`.
   * Refazer a arquitetura reorganiza fases; o que não mudou de envelope é
   * reaproveitado do cache, então o custo é só das fases que mudaram.
   */
  maxArchitectureReturns?: number;
  /**
   * Onde o run começa e termina.
   *
   * `init` produz o esqueleto e para em PLAN READY; `plan` lê o esqueleto de
   * disco e detalha as fases até RALPH READY. `both` faz os dois de uma vez, que
   * é como os testes exercitam o ciclo de ponta a ponta.
   */
  stage?: "init" | "plan" | "both";
  /** Provider de cada papel, só para reconhecer o formato do limite de uso. */
  providers?: Partial<Record<AgentCall["role"], string>>;
  /** Injetada para o teste não dormir de verdade. */
  sleep?: (seconds: number) => Promise<void>;
  /**
   * Espelho dos eventos do run, para quem quiser desenhar progresso.
   * O painel observa por aqui e nunca pergunta nada ao orquestrador.
   */
  onProgress?: (event: { stage: RunStage; subject: string; status: "started" | "complete" | "retry" | "blocked"; detail: string; attempt: number }) => void;
  now?: () => Date;
}

export interface InitOutcome {
  runId: string;
  readiness: Readiness;
  report: InitReport;
  rendered: string;
}

/**
 * Um id de pergunta só é único DENTRO de um documento: o modelo começa em Q-01
 * em cada levantamento. Agregar sem qualificar embaralha as decisões — o piloto
 * 1 produziu "Atores e acesso: Definir uma stack web completa agora" porque a
 * resposta do Q-01 de um documento sobrescreveu a de outro.
 */
/**
 * O que a emenda mudou além do pedido, comparando as duas versões da fase.
 *
 * A leitura de uma fase solta é do contrato; aqui só se compara o que ele
 * devolve.
 */
function driftBetween(antes: string, depois: string, findings: readonly Finding[]): string[] {
  const faseAntes = parsePhaseFragment(antes);
  const faseDepois = parsePhaseFragment(depois);
  if (!faseAntes || !faseDepois) return [];

  return checkRewriteDrift({ before: faseAntes.tasks, after: faseDepois.tasks, findings });
}

/** Quantas esperas por chamada antes de desistir: duas janelas de reset bastam. */
const MAX_ESPERAS_POR_CHAMADA = 2;

/**
 * Indisponibilidade transitória do provider, como a CLI a descreve.
 *
 * Conexão derrubada, gateway fora, sobrecarga: nada disso diz uma palavra sobre
 * o conteúdo, e a mesma chamada costuma passar segundos depois. O que já está
 * em disco não se perde de qualquer forma; o que se perde sem esta espera é o
 * run — e com ele a retomada manual de quem estava no terminal.
 */
const INDISPONIBILIDADE = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|fetch failed|network error|\b50[234]\b|bad gateway|gateway time-?out|overloaded|temporarily unavailable|service unavailable|server error/i;
/** As esperas entre repetições por indisponibilidade, em segundos. Curtas e finitas. */
const ESPERAS_POR_INDISPONIBILIDADE = [5, 20] as const;

/** Quantas tasks há neste markdown. Zero é resposta inválida do escritor. */
/** Há decisão pendente no texto? O marcador é o contrato entre escritor e entrevista. */
function temDecisaoPendente(markdown: string): boolean {
  return /\[NEEDS DECISION\]/.test(markdown);
}


function contaTasks(markdown: string): number {
  return [...markdown.matchAll(/^\s*-\s*\[[ xX]\]\s*\*\*Task:\*\*/gm)].length;
}

/**
 * Quando o build percorre cada workflow, para quem audita o plano inteiro (§127).
 * Derivado da arquitetura — que é dona de covers, dependsOn e componentes —,
 * nunca escrito por modelo.
 */
function tempoDosFluxos(arquitetura: Architecture, esqueleto: Skeleton): string[] {
  const nomes = new Map(esqueleto.workflows.map((workflow) => [workflow.number, workflow.name]));
  return tabelaDaDisponibilidade(disponibilidadeDaArquitetura(arquitetura, esqueleto), arquitetura.phases.map((phase) => phase.number), nomes);
}

/** O mesmo, da fase: o que o escritor e o auditor dela precisam saber antes de escrever um critério. */
function tempoDaFase(arquitetura: Architecture | null, esqueleto: Skeleton, numero: number): string {
  if (arquitetura === null) return "";
  const nomes = new Map(esqueleto.workflows.map((workflow) => [workflow.number, workflow.name]));
  return blocoDaDisponibilidade(disponibilidadeDaArquitetura(arquitetura, esqueleto), numero, nomes).join("\n");
}

/**
 * A emenda estragou a fase?
 *
 * Devolve a razão da recusa, ou `null` quando a fase emendada serve. Três
 * perguntas, nesta ordem de gravidade: sobrou alguma task, sobraram TANTAS
 * quanto antes, e o que sobrou ainda passa no contrato.
 *
 * O marcador de decisão pendente é aceito aqui de propósito: ele é a forma legal
 * de a emenda dizer que falta decidir, e quem o resolve é a rodada de lacunas,
 * antes de qualquer publicação.
 */
function emendaInutil(candidato: string, anterior: string): string | null {
  if (contaTasks(candidato) === 0) return "voltou sem nenhuma task";

  /*
   * Fase que encolhe NÃO é defeito.
   *
   * A primeira versão desta conferência recusava a emenda que voltasse com menos
   * tasks do que tinha — e isso briga com a correção de dimensionamento do §52,
   * que manda consolidar exatamente assim. Duas tasks que entregam a mesma
   * capacidade viram uma, e a fase encolhe por acerto.
   *
   * O que denuncia a fase destruída é a FORMA: a carta do `assitencia` voltou
   * com uma task sem critério e sem trace, e é isso que se recusa.
   */

  /*
   * A comparação é com o que ela substitui, nunca com a perfeição.
   *
   * A emenda existe para consertar uma fase que já tem defeito — recusá-la por
   * carregar o MESMO defeito que a anterior travaria o ciclo justamente quando
   * ele está fazendo o seu trabalho. O que não se aceita é defeito NOVO.
   */
  const novos = defeitosDaFase(candidato).filter((codigo) => !defeitosDaFase(anterior).includes(codigo));
  return novos.length === 0 ? null : novos.join(", ");
}

/** Os códigos de contrato de uma fase isolada. I-13 fica de fora: marcador é legal aqui. */
function defeitosDaFase(fase: string): string[] {
  if (fase.trim() === "") return [];
  const lido = parsePhases(
    assemblePhasesDocument({
      projectName: "emenda",
      stamp: buildStamp([{ name: "skeleton.md", content: "" }]),
      overview: "conferência da emenda",
      phases: [fase],
      openQuestions: [],
    }),
  );
  return lido.ok ? [] : [...new Set(lido.errors.filter((erro) => erro.code !== "I-13").map((erro) => erro.code))];
}

/**
 * O trecho da saída do provider que cabe num diagnóstico.
 *
 * Uma CLI que falha costuma despejar o envelope inteiro da sessão; o que
 * interessa é a mensagem de erro, e ela quase sempre está no fim. Linhas vazias
 * e repetidas saem, porque o que sobra é lido por alguém cansado.
 */
function recorte(saida: string, linhas = 12): string {
  const limpas = saida
    .split("\n")
    .map((linha) => linha.trimEnd())
    .filter((linha) => linha.trim() !== "");
  const ultimas = limpas.slice(-linhas).map((linha) => (linha.length > 300 ? `${linha.slice(0, 297)}...` : linha));
  return ultimas.length > 0 ? ultimas.map((linha) => `    ${linha}`).join("\n") : "    (a CLI não escreveu nada)";
}

function scoped(document: string, questionId: string, stage = "interview"): string {
  return `${document}#${stage}#${questionId}`;
}

/** Um documento escrito, com a forma de reescrevê-lo quando o auditor devolve. */
/** O que a reescrita pode saber sobre a natureza dos achados que recebeu. */
interface OpcoesDaEmenda {
  /**
   * Só reescreve fase que algum achado NOMEIE.
   *
   * Para quem sabe que o achado é de uma fase só — uma decisão de lacuna, uma
   * arbitragem — e prefere não reescrever nada a reescrever tudo. O padrão
   * continua sendo o fallback conservador, que é o certo para a auditoria de
   * coerência: ela não nomeia fase porque o defeito é ENTRE elas.
   */
  somenteNomeadas?: boolean;
  /**
   * Quem emenda. O padrão é o escritor; em modo de reparo (§121) é o auditor,
   * com o bloco de reparo anexado ao mesmo prompt de emenda.
   */
  papel?: "writer" | "auditor";
  /** O histórico compacto que o reparador recebe. */
  historico?: readonly string[];
  /**
   * A volta única à arquitetura do bloqueio que sobrou depois da emenda: fora
   * do orçamento de reorganizações, com uma auditoria só da arquitetura
   * refeita. Reprovada, ou igual à anterior, ela é descartada e o plano volta
   * como estava.
   */
  voltaUnica?: boolean;
}

interface Authored {
  content: string;
  rewrite: (findings: Finding[], attempt: number, opcoes?: OpcoesDaEmenda) => Promise<Authored>;
}

/** O que a segunda chamada acrescenta ao prompt depois de a resposta ser cortada pelo limite de tokens. */
const RESPOSTA_COMPACTA = [
  "## Compact answer",
  "Your previous answer to this same request was cut by the output token limit and was discarded.",
  "Answer the same request again, compactly: no prose, no explanation, no repetition — only the contract the",
  "request asks for, complete and in the same format.",
].join("\n");

export class InitBlockedError extends Error {
  readonly runId: string;
  constructor(message: string, runId: string) {
    super(message);
    this.name = "InitBlockedError";
    this.runId = runId;
  }
}

export async function runInit(options: InitOptions): Promise<InitOutcome> {
  const now = options.now ?? (() => new Date());
  const announce = options.announce ?? (() => undefined);
  const maxAuditReturns = options.maxAuditReturns ?? DEFAULT_MAX_RETURNS;
  const maxInterviewRounds = options.maxInterviewRounds ?? 3;
  const maxGapQuestions = options.maxGapQuestions ?? 5;
  const maxParallelParts = Math.max(1, options.maxParallelParts ?? 3);
  const sistema = options.sistema ?? process.platform;
  // O aplicativo de janela de outra plataforma é uma lacuna: o init a pergunta, e a resposta vira regra do esqueleto.
  const desktopDeFora = desktopDeOutraPlataforma(options.request.text, sistema);
  const maxMechanicalRounds = Math.max(1, options.maxMechanicalRounds ?? 3);
  const maxArchitectureReturns = Math.max(0, options.maxArchitectureReturns ?? 2);
  const esperar = options.sleep ?? ((seconds: number) => new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000)));
  const providerDoPapel = (role: AgentCall["role"]): string => options.providers?.[role] ?? "default";

  const runId = runIdFor("init", options.request.sha12);
  const paths = runPaths(options.projectRoot, runId);
  await ensureArtifactTree(options.projectRoot);
  const state = createRunState({
    runId,
    command: options.stage === "plan" ? "plan" : "init",
    language: options.language,
    now,
    ...(options.roles ? { roles: options.roles } : {}),
  });
  await writeRunState(options.projectRoot, state, now);

  const costs = new Map<string, RoleCost>();

  /**
   * Uma chamada, contabilizada — e um timeout não conta como recusa.
   *
   * O piloto 3 morreu no levantamento de user-stories.md com código 124 depois de
   * doze perguntas respondidas à mão. Estouro de tempo não diz nada sobre o
   * conteúdo: a mesma chamada costuma passar na segunda. Desistir na primeira
   * joga fora meia hora de entrevista para economizar uma chamada.
   */
  /*
   * O nome do arquivo da transcrição.
   *
   * `subject` carrega `.md`, `#` e `/` — `project-phases.md#P2` viraria caminho
   * com pasta inexistente. Tudo o que não é identificador vira `-`.
   */
  const arquivoDaChamada = (call: AgentCall, tentativa: number, id: string): string =>
    `${call.stage}.${call.subject.replace(/[^A-Za-z0-9_.-]+/g, "-")}.${call.role}.${call.attempt ?? 1}-${tentativa}.${id}`;

  const track = async (pedida: AgentCall): Promise<string> => {
    let esperas = 0;
    let indisponibilidades = 0;
    // A chamada desta tentativa: a segunda, depois do limite de tokens, pede a mesma resposta compacta.
    let call = pedida;

    for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
      const startedAt = Date.now();
      const response = await options.call(call);

      /*
       * A transcrição da chamada, como o build já guardava a dele.
       *
       * O `build` gravava prompt e saída de cada ciclo; o `init` e o `plan` —
       * que custam dezenas de chamadas — não guardavam nada. Quando um `plan`
       * morria no meio, não sobrava o que ler: nem o que foi pedido, nem o que
       * o provider respondeu. A pergunta "foi o modelo ou fomos nós?" ficava
       * sem como ser respondida, e o modelo levava a culpa por padrão.
       *
       * Gravar não pode derrubar a chamada que já foi paga: falha aqui é
       * silenciosa de propósito.
       */
      // Lotes paralelos e retomadas têm os mesmos assunto/papel/tentativa.
      // A identidade da evidência é de cada requisição, inclusive após espera.
      const arquivo = arquivoDaChamada(call, tentativa, randomUUID());
      await writeAtomic(join(paths.prompts, `${arquivo}.txt`), call.prompt).catch(() => undefined);
      await writeAtomic(join(paths.logs, `${arquivo}.log`), response.stdout).catch(() => undefined);
      if (response.partialOutput) {
        await writeAtomic(join(paths.logs, `${arquivo}.partial.txt`), response.partialOutput).catch(() => undefined);
      }

      const cost = costs.get(call.role) ?? { role: call.role, calls: 0, inputTokens: null, outputTokens: null, milliseconds: 0 };
      cost.calls += 1;
      cost.milliseconds += Date.now() - startedAt;
      if (response.usage) {
        cost.inputTokens = (cost.inputTokens ?? 0) + response.usage.inputTokens;
        cost.outputTokens = (cost.outputTokens ?? 0) + response.usage.outputTokens;
        if (response.usage.costUsd !== undefined) cost.costUsd = (cost.costUsd ?? 0) + response.usage.costUsd;
      }
      costs.set(call.role, cost);

      /*
       * Limite de uso não é resposta ruim nem defeito do documento: é o provider
       * indisponível. O loop já esperava e repetia sem consumir ciclo; o init
       * simplesmente morria, e com ele a entrevista inteira. Esperar aqui custa
       * tempo de relógio; não esperar custa o run.
       */
      const limite = detectRateLimit(response.stdout, providerDoPapel(call.role));
      if (limite && esperas < MAX_ESPERAS_POR_CHAMADA) {
        esperas += 1;
        const plano = planWait(limite);
        announce(`  ${plano.reason}; aguardando ${plano.seconds}s antes de repetir ${call.subject}`);
        await event(call.stage, call.subject, "retry", `limite de uso: ${plano.reason}`, call.attempt);
        await esperar(plano.seconds);
        tentativa -= 1; // a espera não gasta a tentativa: não houve defeito.
        continue;
      }

      /*
       * Motor que falhou não é resposta.
       *
       * Com envelope, a CLI diz quando a volta foi erro dela — credencial,
       * sessão que não subiu, limite do harness. Esse texto não pode chegar a
       * um parser como se fosse o que o modelo escreveu: vira "JSON inválido",
       * "fase sem task", "auditoria sem status", e cada um desses gasta uma
       * tentativa de correção de forma com quem nunca chegou a responder.
       */
      const falhouNoMotor = response.engineError === true || (typeof response.timedOut === "string" && response.timedOut !== "");
      if (response.exitCode === 0 && !falhouNoMotor) return response.stdout;

      const estouro = response.exitCode === 124 || (typeof response.timedOut === "string" && response.timedOut !== "");

      /*
       * Provider fora do ar espera e repete, dentro de um limite curto.
       *
       * É o irmão do limite de uso logo acima: lá a CLI diz quando voltar; aqui
       * ela só diz que não conseguiu. Duas esperas curtas cobrem o soluço
       * comum; o que passar disso é diagnóstico retomável, com o texto da CLI.
       */
      const transitorio = !estouro && INDISPONIBILIDADE.test(response.stdout);
      if (transitorio && indisponibilidades < ESPERAS_POR_INDISPONIBILIDADE.length) {
        const segundos = ESPERAS_POR_INDISPONIBILIDADE[indisponibilidades]!;
        indisponibilidades += 1;
        announce(`  o provider de ${call.role} respondeu indisponível em ${call.subject}; aguardando ${segundos}s antes de repetir (${indisponibilidades}/${ESPERAS_POR_INDISPONIBILIDADE.length})`);
        await event(call.stage, call.subject, "retry", `provider indisponível: ${recorte(response.stdout, 2).trim()}`, call.attempt);
        await esperar(segundos);
        tentativa -= 1; // indisponibilidade não é defeito de resposta: não gasta a tentativa.
        continue;
      }
      if (estouro && tentativa === 1) {
        announce(`  a chamada de ${call.role} em ${call.subject} estourou o tempo; tentando uma segunda vez`);
        await event(call.stage, call.subject, "retry", "timeout do provider", call.attempt);
        continue;
      }

      /*
       * Sair com erro sem escrever nada é o único fracasso sem diagnóstico.
       *
       * Credencial vencida, modelo inexistente e free tier recusando uso
       * externo saem todos com código 1 — e todos *dizem* o que houve. Quando o
       * stdout vem vazio não há o que ler, e a causa mais provável é o soluço:
       * a sessão que não subiu, a conexão que caiu antes do primeiro byte.
       *
       * Isso custou um `plan` inteiro. Três fases já estavam escritas e
       * auditadas quando a chamada de coerência voltou vazia; a execução
       * seguinte refez as três do zero. O timeout já tinha a segunda chance
       * exatamente por esse motivo, e esse caso é o mesmo: o provider não
       * respondeu. Uma só, e a segunda falha vale pelo que ela for.
       */
      /*
       * Só o silêncio ganha a segunda chance automática. Um erro do motor QUE
       * DIZ o que houve — credencial, cota, geração cortada — é definitivo até
       * prova em contrário, e repeti-lo às cegas gasta dinheiro para receber a
       * mesma recusa (§115.14). O que ele ganha é não ser lido como resposta.
       */
      const mudo = response.stdout.trim() === "";
      if (mudo && tentativa === 1 && !estouro) {
        announce(
          falhouNoMotor
            ? `  a CLI de ${call.role} declarou erro do motor sem escrever nada em ${call.subject}; tentando uma segunda vez`
            : `  ${call.role} saiu com código ${response.exitCode} sem escrever nada em ${call.subject}; tentando uma segunda vez`,
        );
        await event(call.stage, call.subject, "retry", falhouNoMotor ? "erro do motor da CLI, sem saída" : `saída vazia com código ${response.exitCode}`, call.attempt);
        continue;
      }

      if (/a geração atingiu o limite de tokens/i.test(response.stdout)) {
        /*
         * O limite de saída cortou a resposta: UMA chamada nova pedindo a
         * mesma resposta, compacta — sem prosa, só o contrato. Estourar de novo
         * para, como antes; o texto parcial nunca é aprovado.
         */
        if (tentativa === 1) {
          announce(`  a geração de ${call.role} em ${call.subject} atingiu o limite de tokens; pedindo a mesma resposta, compacta, uma vez`);
          await event(call.stage, call.subject, "retry", "limite de tokens: a mesma resposta, compacta", call.attempt);
          call = { ...pedida, prompt: `${pedida.prompt}\n\n${RESPOSTA_COMPACTA}` };
          continue;
        }
        throw new InitBlockedError([
          `A geração de ${call.role} em ${call.subject} atingiu o limite de tokens${call !== pedida ? ", também na chamada que pedia a resposta compacta" : ""}.`,
          "",
          "O que o provider respondeu:",
          recorte(response.stdout),
          "",
          "O esqueleto e as fases guardadas em cache continuam disponíveis; o texto parcial não foi aprovado.",
        ].join("\n"), runId);
      }

      throw new InitBlockedError(
        estouro
          ? [
              `A chamada de ${call.role} em ${call.subject} estourou o tempo duas vezes.`,
              "",
              "O provider não respondeu dentro do limite. Nada do que já foi publicado se perdeu.",
              "Rode o mesmo comando de novo; se repetir, tente um modelo mais rápido para esse papel:",
              `    capivara init ... --${call.role}-model <modelo>`,
            ].join("\n")
          : [
              falhouNoMotor && response.exitCode === 0
                ? `A CLI de ${call.role} declarou erro do motor em ${call.subject}.`
                : `O papel ${call.role} falhou com código ${response.exitCode} em ${call.subject}.`,
              "",
              /*
               * O que a CLI disse é a única pista de por que ela saiu.
               *
               * A mensagem dizia só "falhou com código 1", e a causa ficava no
               * stdout descartado. Um free tier recusando uso externo, uma
               * credencial vencida e um modelo inexistente produzem o mesmo
               * código de saída e diagnósticos completamente diferentes.
               */
              "O que o provider respondeu:",
              recorte(response.stdout),
              "",
              `Nada do que já foi publicado se perdeu. Verifique o modelo e a credencial de ${call.role}:`,
              `    capivara ${options.stage === "plan" ? "plan" : "init"} ... --${call.role}-provider <provider> --${call.role}-model <modelo>`,
            ].join("\n"),
        runId,
      );
    }

    throw new InitBlockedError(`o papel ${call.role} não respondeu em ${call.subject}`, runId);
  };

  const event = async (stage: RunStage, subject: string, status: "started" | "complete" | "retry" | "blocked", detail = "", attempt = 1): Promise<void> => {
    await appendEvent(paths.events, { timestamp: now().toISOString(), stage, subject, attempt, status, detail });
    options.onProgress?.({ stage, subject, status, detail, attempt });
  };

  const inventory = await inspectProject(options.projectRoot);
  const daBase = renderLibraryBlock(options.library ?? []);
  const inventoryText = daBase === "" ? summarizeInventory(inventory) : `${summarizeInventory(inventory)}\n\n${daBase}`;
  if (daBase !== "") announce(`  ${options.library?.length} documento(s) da base documental no contexto`);
  announce(inventory.empty ? "Projeto vazio: greenfield." : `Inventário: ${inventory.files.length} arquivo(s).`);

  /** O plano executável publicado por este run. */
  let plano = "";
  let planoAprovado = false;

  /*
   * As lacunas já perguntadas, para o run inteiro.
   *
   * Aqui em cima e não ao lado de `closeGaps` porque as declarações abaixo do
   * `return await buildFromSkeleton()` nunca chegam a ser executadas: a função é
   * içada, o `const` não, e o uso estoura em TDZ.
   */
  const lacunasPerguntadas = new Set<string>();

  /**
   * As decisões que já foram insistidas, e as que o auditor levantou.
   *
   * Aqui em cima pela mesma razão de todas as outras: declaração abaixo do
   * `return await buildFromSkeleton()` nunca é executada, e o uso estoura em TDZ.
   * A armadilha já foi paga com `lacunasPerguntadas`.
   */
  const insistidas = new Set<string>();
  const decisoesDoAuditor = new Set<string>();

  /**
   * Os marcadores cuja decisão está FECHADA, e a pergunta que fechou cada um.
   *
   * `lacunasPerguntadas` responde "já perguntei isto?", e só isso não basta:
   * perguntar não é decidir, e decidir não é o escritor apagar o marcador. Sem
   * saber quais marcadores já têm decisão, o laço de lacunas não tinha como
   * apagar o que sobrou nem como distinguir "não há mais nada a perguntar" de
   * "não há mais nada a fazer" — e devolvia o plano marcado.
   */
  const lacunasDecididas = new Set<string>();
  /** Marcadores de engenharia já devolvidos ao escritor uma vez (§122); se voltarem, a pendência é preservada e perguntada. */
  const marcadoresDevolvidos = new Set<string>();
  /** A arquitetura já voltou uma vez pela sonda do runtime que a máquina não satisfaz (`sondasImpossiveis`). */
  let sondasDevolvidas = false;
  const marcadorDaPergunta = new Map<string, string>();

  /*
   * O que este run já escreveu e já teve aprovado, guardado em disco.
   *
   * A memória evita reescrever e reauditar ENTRE execuções: ela guarda o
   * esqueleto, a arquitetura, as fases escritas e as auditorias aprovadas, e uma
   * retomada depois de o provider cair recomeça de onde parou.
   */
  const memoria = await MemoriaDoPlano.abrir(options.projectRoot, runId, options.fresh === true);
  const relatarFase: PlanProgressListener = options.onPhaseProgress ?? ((): void => undefined);

  const allAnswers: Answer[] = [];
  const allQuestions: Question[] = [];
  /** Suposições que o escritor registrou em vez de perguntar; o relatório as mostra. */
  const allAssumptions: Assumption[] = [];
  const remarks: { document: string; remark: Remark }[] = [];
  /*
   * O que vai ao relatório e NÃO aos auditores (§126). `remarks` é lido por
   * todo auditor de fase como ressalva a resolver; um aviso sobre a versão do
   * harness que gravou o esqueleto viraria achado que nenhuma fase corrige.
   */
  const avisosDoRelatorio: { document: string; remark: Remark }[] = [];

  /*
   * A pergunta do `plan` tem prazo (etapa 2 da redução).
   *
   * O `plan` pergunta só sobre o que construir, e toda pergunta dele traz a
   * leitura recomendada. Sem resposta no prazo, o run segue com ela e a registra
   * como suposição: um plano parado à espera de quem saiu da frente do terminal
   * não entrega nada. A pergunta vencida sai da tela pelo `signal`, para a
   * resposta da seguinte não cair nela. O `init` continua sem prazo: ali a
   * entrevista é a razão de existir do estágio.
   */
  const prazoDaPergunta = options.planQuestionTimeoutMs ?? 10 * 60_000;
  let perguntasComPrazo = false;
  const perguntar = async (pergunta: Question, indice: number, total: number): Promise<string> => {
    if (!perguntasComPrazo) return await options.ask(pergunta, indice, total);
    const prazo = new AbortController();
    let relogio: ReturnType<typeof setTimeout> | undefined;
    const vencida = new Promise<null>((resolve) => {
      relogio = setTimeout(() => {
        prazo.abort();
        resolve(null);
      }, prazoDaPergunta);
    });
    const pedido = options.ask(pergunta, indice, total, { signal: prazo.signal });
    // A pergunta retirada pode rejeitar depois de o prazo vencer; essa rejeição não é de ninguém.
    pedido.catch(() => undefined);
    try {
      const resposta = await Promise.race([pedido, vencida]);
      if (resposta !== null) return resposta;
    } finally {
      clearTimeout(relogio);
    }
    const recomendada = pergunta.recommended.trim();
    const exata = pergunta.options.findIndex((opcao) => opcao.label.trim() === recomendada);
    const posicao = exata >= 0 || recomendada === "" ? exata : pergunta.options.findIndex((opcao) => opcao.label.includes(recomendada));
    const escolhida = posicao >= 0 ? posicao : pergunta.options.findIndex((opcao) => opcao.label === DELEGAR);
    const leitura = recomendada !== "" ? recomendada : (pergunta.options[escolhida]?.label ?? "");
    const minutos = Math.max(1, Math.round(prazoDaPergunta / 60_000));
    if (leitura === "") {
      announce(`  ${pergunta.topic}: sem resposta em ${minutos} min e sem leitura recomendada; a decisão segue em aberto`);
      return "";
    }
    allAssumptions.push({ topic: pergunta.topic, statement: leitura, basis: `sem resposta em ${minutos} min: o plan seguiu com a leitura recomendada` });
    announce(`  ${pergunta.topic}: sem resposta em ${minutos} min; sigo com a leitura recomendada (${leitura}) e a registro como suposição`);
    return escolhida >= 0 ? String(escolhida + 1) : leitura;
  };
  /** Presente apenas no caminho por esqueleto; é dele que sai a cobertura. */
  let skeletonAtual: Skeleton | null = null;
  /** O esqueleto como o `init` o publicou: é dele que a arquitetura é derivada. */
  let esqueletoDeOrigem: Skeleton | null = null;
  /** A arquitetura que vale para este plano, e o markdown dela como foi publicado. */
  let arquiteturaAtual: Architecture | null = null;
  let arquiteturaMd = "";
  /** Quantas vezes a arquitetura foi refeita por achado neste run. */
  /** As estratégias de recuperação tentadas por documento (§121), para o diagnóstico. */
  const estrategias = new Map<string, string[]>();
  let reorganizacoes = 0;
  /** A arquitetura atual foi escrita pelo auditor: quem a julga é o verifier (§121). */
  let arquiteturaReparada = false;

  /*
   * Um caminho só: uma leitura do produto inteiro, depois cada fase vendo a sua
   * fatia.
   *
   * A cadeia de quatro documentos em prosa foi removida. Ela existia para um
   * leitor que não existe — o desenvolvedor não lê documentação, verifica se a
   * aplicação funciona — e custava oito vezes mais para entregar um plano três
   * vezes maior. O critério de aceite é um só: o loop consegue executar.
   */
  /*
   * A memória vai ao disco ANTES de qualquer erro sair daqui.
   *
   * As gravações do cache entram numa fila assíncrona, e um run que morre no
   * meio — provider fora na fase 2 com a fase 1 recém-escrita — saía com a
   * gravação da fase 1 ainda na fila. O `finally` é o que torna verdade a frase
   * "nada do que já foi feito se perdeu" que toda parada promete.
   */
  try {
    return await buildFromSkeleton();
  } finally {
    await memoria.fechar();
  }

  async function interview(document: string, upstream: { name: string; content: string }[]) {
    const questions: Question[] = [];
    const answers: Answer[] = [];

    /*
     * O handoff é gravado ao fim de cada rodada, e é ele que impede reperguntar.
     * Semeado aqui, o `planRound` vê as respostas que já existem e só pede o que
     * falta; o levantamento novo chega e é deduplicado por id contra estas.
     */
    /*
     * A pergunta que o harness faz por conta própria.
     *
     * Ela entra ANTES do levantamento do escritor porque é a decisão de que todo
     * o resto depende: a stack, as fases de dados e o que os gates podem testar.
     * E entra pela mesma fila, para herdar repergunta, classificação e handoff
     * sem um segundo caminho para manter.
     */
    if (document === "skeleton") questions.push(perguntaDoBanco(options.request.text));
    if (document === "skeleton" && desktopDeFora !== null) questions.push(perguntaDaPlataforma(desktopDeFora, sistema));

    const retomado = options.fresh === true ? null : await readHandoff(options.projectRoot, runId, document);
    if (retomado && retomado.answers.length > 0) {
      questions.push(...retomado.questions.filter((question) => !questions.some((entry) => entry.id === question.id)));
      answers.push(...retomado.answers);
      announce(`  ${retomado.answers.length} resposta(s) retomada(s) de ${document}; não vou perguntar de novo`);

      /*
       * Tudo respondido não precisa de levantamento.
       *
       * O piloto 3 pagou 4,5 minutos de modelo para perguntar o que perguntar,
       * duas vezes no mesmo documento, com as 24 respostas já em mãos — e o lote
       * que voltou foi inteiro deduplicado contra elas. A convergência é
       * verificável antes da chamada; verificá-la depois é pagar para descobrir
       * o que já se sabia.
       */
      const jaConvergiu = planRound({ round: 1, questions, answers, assumptions: [], maxRounds: maxInterviewRounds });
      if (jaConvergiu.converged || jaConvergiu.ask.length === 0) {
        await event("interview", document, "complete", `${answers.length} resposta(s) retomada(s)`);
        return { questions, answers };
      }
    }

    for (let round = 1; round <= maxInterviewRounds; round += 1) {
      const writer: WriterContext = {
        language: options.language,
        request: options.request.text,
        decisions: allAnswers.filter((answer) => answer.disposition === "ACCEPTED").map((answer) => answer.decision),
        assumptions: [],
        upstream,
      };
      // Já respondido inclui as rodadas anteriores e, no `plan`, o que o `init`
      // fechou. Sem isso a mesma decisão é reaberta: no piloto 1 a stack foi
      // perguntada quatro vezes, com quatro nomes diferentes.
      const previous = [
        ...allQuestions.map((question) => {
          const answer = allAnswers.find((entry) => entry.questionId === question.id);
          return {
            question: `${question.topic}: ${question.decision}`,
            answer: answer?.disposition === "ACCEPTED" ? answer.decision : (answer?.raw ?? ""),
            disposition: answer?.disposition ?? "UNANSWERED",
          };
        }),
        ...answers.map((answer) => ({
          question: questions.find((entry) => entry.id === answer.questionId)?.decision ?? answer.questionId,
          answer: answer.raw,
          disposition: answer.disposition,
        })),
      ];

      // Lote malformado repete SÓ o levantamento, com os defeitos nomeados.
      // O desenvolvedor não paga por um erro de formato de quem levanta as
      // perguntas, e nomear o defeito quase sempre resolve na segunda.
      const base = interviewPrompt(document, writer, inventoryText, previous, round);
      let batch = parseQuestionBatch(await track({ role: "writer", stage: "interview", subject: document, attempt: round, prompt: base }));

      if (!batch.ok) {
        const corrective = [
          base,
          "",
          "## Your previous answer was rejected before it reached the developer",
          ...batch.defects.map((defect) => `- ${defect.questionId}: ${defect.problem} — ${defect.hint}`),
          "",
          "Emit the whole batch again, complete. Every question carries id, topic, evidence, decision and why.",
        ].join("\n");
        batch = parseQuestionBatch(
          await track({ role: "writer", stage: "interview", subject: document, attempt: round, prompt: corrective }),
        );
      }

      /*
       * Lote recusado ainda tem pergunta boa dentro — e jogá-las fora era matar
       * o run.
       *
       * A rodada de lacunas aprendeu isso e esta não: `parseQuestionBatch` já
       * devolve as perguntas SEM defeito junto da recusa (§72), e aqui elas eram
       * ignoradas para lançar `InitBlockedError`. Oito perguntas perfeitas
       * morriam porque três vieram tortas, e com elas morria a entrevista
       * inteira. É a correção pela metade de novo, no irmão que ninguém olhou.
       *
       * Sem nenhuma pergunta aproveitável o run também não morre: quem levanta
       * perguntas falhou, e isso não é o mesmo que não haver decisões a tomar. O
       * que faltar volta pelas lacunas, pela auditoria e pela insistência — três
       * caminhos que existem exatamente para isto.
       */
      if (!batch.ok) {
        const aproveitadas = batch.questions.length;
        announce(
          aproveitadas > 0
            ? `  ${batch.defects.length} pergunta(s) vieram malformadas e ficaram de fora; sigo com as ${aproveitadas} que estão boas`
            : `  o levantamento de ${document} veio malformado duas vezes (${batch.defects
                .map((defect) => `${defect.questionId}: ${defect.problem}`)
                .join("; ")}); sigo sem ele e o que faltar volta pelas lacunas`,
        );
        await event("interview", document, "retry", `lote recusado: ${batch.defects.length} defeito(s)`, round);
      }

      for (const question of batch.questions) if (!questions.some((entry) => entry.id === question.id)) questions.push(question);

      /*
       * As omissões entram DEPOIS das perguntas, na mesma fila.
       *
       * Depois porque o que o pedido diz vale mais que o que ele não diz: quem
       * responde chega nelas já tendo decidido o essencial. Na mesma fila porque
       * assim elas herdam tudo — repergunta com o que faltou, classificação,
       * registro no handoff, memória e relatório —, sem um segundo caminho para
       * manter.
       */
      const omissoes = batch.ok ? batch.omissions : [];
      for (const omission of omissoes) {
        if (!questions.some((entry) => entry.id === omission.id)) questions.push(omission);
      }
      if (omissoes.length > 0) {
        announce(`  ${omissoes.length} área(s) que o pedido não menciona; você decide se entram`);
      }
      const suposicoesDoLote = batch.ok ? batch.assumptions : [];
      for (const assumption of suposicoesDoLote) {
        if (!allAssumptions.some((entry) => entry.statement === assumption.statement)) allAssumptions.push(assumption);
      }
      if (suposicoesDoLote.length > 0) {
        announce(`  ${suposicoesDoLote.length} suposição(ões) registrada(s) em vez de perguntar; estão no relatório`);
      }

      const plan = planRound({ round, questions, answers, assumptions: [], maxRounds: maxInterviewRounds });
      if (plan.converged || plan.ask.length === 0) break;

      let index = 0;
      for (const question of plan.ask) {
        index += 1;
        const raw = await perguntar(question, index, plan.ask.length);
        answers.push(await settle(document, question, raw, round, index, plan.ask.length));
      }

      await writeHandoff(options.projectRoot, {
        contract: "capivara-handoff/v1",
        runId,
        language: options.language,
        document,
        round,
        questions,
        answers,
        assumptions: [],
        updatedAt: now().toISOString(),
      });

      /*
       * A rodada seguinte existe para fechar o que ficou aberto.
       *
       * Sem esta saída, o laço sempre paga um levantamento a mais só para
       * descobrir que não há o que perguntar — quatro minutos de modelo por
       * documento, dezesseis num run de quatro, e o lote que volta é
       * inteiramente descartado por duplicidade. Medido no piloto 3: a
       * entrevista consumiu 49% do tempo com o desenvolvedor respondendo tudo
       * pelo número recomendado, em segundos.
       *
       * Quando TUDO foi aceito, não há pendência para uma rodada seguinte
       * resolver. O que o escritor descobrir ao escrever ainda volta pela rodada
       * de gaps, que é o caminho certo para isso.
       */
      if (answers.every((answer) => answer.disposition === "ACCEPTED")) break;
    }

    await event("interview", document, "complete", `${answers.length} resposta(s)`);
    return { questions, answers };
  }

  /**
   * Classifica a resposta e NUNCA a descarta em silêncio.
   *
   * O piloto 3 mostrou o estrago: o desenvolvedor escreveu uma decisão completa
   * em texto livre, o classificador devolveu DEFERRED por causa de um pedaço da
   * pergunta que a própria resposta havia abolido, e a tela não disse nada. A
   * rodada de gaps perguntou de novo, recomendou o contrário, e o documento foi
   * publicado dizendo o oposto do que o desenvolvedor tinha decidido.
   *
   * Resposta que não fecha volta para quem a escreveu, com o que falta na tela.
   */
  async function settle(
    document: string,
    question: Question,
    raw: string,
    round: number,
    index: number,
    total: number,
  ): Promise<Answer> {
    const local = classifyLocally(question, raw);
    if (local.settled) return buildAnswer(question, raw, local, round, now);

    let texto = raw;
    let classification = await classifyWithModel(document, question, texto, round);

    if (classification.disposition !== "ACCEPTED") {
      announce(`  Sua resposta não fechou a decisão: ${classification.open}`);
      announce("  Responda de novo fechando esse ponto — ou deixe vazio para mantê-la em aberto.");
      const segunda = await perguntar(question, index, total);
      if (segunda.trim() !== "") {
        const localDaSegunda = classifyLocally(question, segunda);
        texto = segunda;
        classification = localDaSegunda.settled ? localDaSegunda : await classifyWithModel(document, question, segunda, round);
      }
      if (classification.disposition !== "ACCEPTED") {
        announce("  Segue em aberto; ela volta antes do gate.");
      }
    }

    return buildAnswer(question, texto, classification, round, now);
  }

  async function classifyWithModel(document: string, question: Question, raw: string, round: number) {
    const output = await track({
      role: "auditor",
      stage: "interview",
      subject: `${document}:${question.id}`,
      attempt: round,
      prompt: [
        languageBlock(options.language),
        "",
        "Classify the developer's answer. Reply with exactly one line and nothing else:",
        `CAPIVARA_ANSWER: ${question.id} | <ACCEPTED|PARTIAL|AMBIGUOUS|DEFERRED|CONTRADICTED> | <normalized decision, or what is still missing>`,
        "",
        "ACCEPTED requires one single material interpretation that answers the decision asked.",
        "Never add precision the answer did not supply.",
        "",
        "A question may ask several things at once. An answer that REMOVES THE PREMISE of one of them",
        "has answered it: if the developer rules out deleting columns, then what happens to the cards of",
        "a deleted column is settled, not missing. Do not hold an answer open for failing to describe a",
        "case the answer itself abolished.",
        "",
        "The developer is the authority. An answer that decides is ACCEPTED even when it decides against",
        "the recommendation, against the options offered, or against what the question assumed.",
        "",
        `What the question was about: ${question.topic}`,
        `What had been observed: ${question.evidence}`,
        `Question: ${question.decision}`,
        ...(question.options.length > 0
          ? ["Options that had been offered:", ...question.options.map((option) => `- ${option.label}`)]
          : []),
        `Answer: ${raw}`,
      ].join("\n"),
    });
    const verdict = parseClassification(output).find((entry) => entry.questionId === question.id);
    if (!verdict) return { disposition: "PARTIAL" as const, decision: "", open: question.decision };
    return {
      disposition: verdict.disposition,
      decision: verdict.disposition === "ACCEPTED" ? verdict.text : "",
      open: verdict.disposition === "ACCEPTED" ? "" : verdict.text || question.decision,
    };
  }

  /**
   * Fecha os gaps que o ESCRITOR descobriu.
   *
   * A entrevista prévia não alcança tudo: só ao escrever é que se sabe qual
   * decisão falta de verdade. Sem este caminho de volta, um [NEEDS DECISION]
   * atravessaria toda a cadeia para virar bloqueio no fim do run — com o
   * desenvolvedor descobrindo tarde algo que responderia em dez segundos.
   *
   * O teto existe porque um marcador que sobrevive a duas rodadas de perguntas
   * não é falta de informação: é uma decisão que ninguém quer tomar agora, e o
   * gate de prontidão é o lugar certo para isso aparecer.
   */
  /**
   * Uma chamada de auditoria, com a repetição por saída inválida que já existia.
   *
   * Quando ela desiste, mostra O QUE VEIO. Dizer "nenhum CAPIVARA_AUDIT_STATUS"
   * é verdade e não ajuda: no `MCP_teste2` o auditor tinha respondido certo e
   * apenas colado a chave no fim da frase de abertura, e descobrir isso exigiu
   * abrir o log com `cat -A`. A causa cabia na tela.
   */
  async function auditCall(subject: string, attempt: number, prompt: () => string, papel: "auditor" | "verifier" = "auditor"): Promise<AuditVerdict> {
    let ultima = "";
    const original = prompt();
    let proximoPrompt = original;
    /*
     * Duas tentativas do papel pedido; a terceira é do OUTRO papel de
     * julgamento (§121). Saída inválida duas vezes diz que este modelo não
     * cumpre o protocolo neste prompt, não que a auditoria seja impossível —
     * o verifier e o auditor leem o mesmo protocolo, em sessão própria.
     */
    /*
     * Quem reparou não lê (§122). No INIT e no PLAN o verifier só audita
     * depois de um reparo pelo auditor; quando ele falha duas vezes no
     * protocolo, a terceira leitura não pode voltar ao auditor — seria o
     * reparador aprovando a própria emenda. O escritor é a alternativa
     * independente que existe: outra sessão, outro papel, e não foi ele quem
     * reparou. Se também falhar, o run para com o diagnóstico; nunca aprova.
     */
    const outro: "auditor" | "verifier" | "writer" = papel === "auditor" ? "verifier" : "writer";
    for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
      const role = tentativa === 3 ? outro : papel;
      if (tentativa === 3) {
        announce(`  o ${papel} de ${subject} não cumpriu o protocolo duas vezes; a leitura passa ao ${outro}, em sessão própria${outro === "writer" ? " — o auditor reparou este documento e não lê o próprio reparo" : ""}`);
        if (outro === "writer") anunciarIndependencia("writer", "auditor");
        registrarEstrategia(subject, `auditoria de ${subject} refeita pelo papel ${outro} depois de duas saídas inválidas do ${papel}`);
        await event("audit", subject, "retry", `saída inválida duas vezes; leitura pelo ${outro}`, attempt);
      }
      ultima = await track({ role, stage: "audit", subject, attempt, prompt: tentativa === 3 ? original : proximoPrompt });
      const parsed = parseAudit(ultima);
      if (parsed.ok) {
        // O que o parser consertou sozinho é dito: é uma chamada que não foi paga.
        for (const nota of parsed.applied) announce(`  ${nota}`);
        return await semPedidoDeTeste(subject, parsed.verdict, attempt);
      }
      if (tentativa === 3) {
        const amostra = ultima.trim().slice(0, 300).replace(/\n/g, "\n  ");
        throw new InitBlockedError(
          diagnostico(subject, [
            `a auditoria de ${subject} devolveu saída inválida três vezes (${papel}, ${papel}, ${outro}): ${parsed.defects.join("; ")}`,
            "",
            "O que veio por último, do começo:",
            `  ${amostra || "(nada)"}`,
          ], "Nada do que já foi publicado se perdeu; `capivara plan` retoma daqui. Verifique os modelos dos papéis auditor e verifier."),
          runId,
        );
      }
      proximoPrompt = auditRetryPrompt(original, ultima, parsed.defects);
    }
    throw new InitBlockedError("inalcançável", runId);
  }

  /**
   * O caminho por esqueleto, do pedido ao plano.
   *
   * Uma chamada pensa o produto inteiro; as fases são escritas em paralelo,
   * cada uma com a sua fatia; os portões que protegem a execução continuam os
   * mesmos, porque são eles que respondem se o loop consegue executar.
   */
  async function buildFromSkeleton(): Promise<InitOutcome> {
    const estagio = options.stage ?? "both";

    // O `plan` não reentrevista nem reescreve o esqueleto: ele lê o que o `init`
    // publicou. Se não houver, não há o que planejar.
    if (estagio === "plan") {
      const emDisco = await readFile(join(artifactPaths(options.projectRoot).init, "skeleton.md"), "utf8").catch(() => "");
      const guardado = await readSkeletonState(options.projectRoot, runId);
      if (emDisco.trim() !== "" && !guardado) {
        throw new InitBlockedError("esqueleto ausente ou incompatível com a Capivara 0.6.0. Gere novamente com `capivara init --fresh` e depois `capivara plan --fresh`; os arquivos existentes são preservados.", runId);
      }
      if (emDisco.trim() === "" || !guardado) {
        throw new InitBlockedError(
          "não há esqueleto publicado neste projeto. Rode `capivara init` primeiro: é ele que produz as fases.",
          runId,
        );
      }
      skeletonAtual = guardado;

      /*
       * As decisões do `init` viajam para o `plan` pelo handoff.
       *
       * Sem isto, o segundo estágio não sabe nada do que o desenvolvedor
       * respondeu no primeiro, e a rodada de lacunas volta a perguntar — ou pior,
       * recomenda o contrário do que ele acabou de decidir, que foi o defeito
       * mais caro que o piloto 3 produziu.
       */
      const doInit = await readHandoff(options.projectRoot, runId, "skeleton");
      if (doInit) {
        allQuestions.push(...doInit.questions.map((question) => ({ ...question, id: scoped("skeleton", question.id) })));
        allAnswers.push(...doInit.answers.map((answer) => ({ ...answer, questionId: scoped("skeleton", answer.questionId) })));
        announce(`  ${doInit.answers.length} decisão(ões) do init carregada(s); não vou perguntar de novo`);

        /*
         * As regras de banco são do harness, e o harness muda (§126).
         *
         * O esqueleto gravado por uma versão anterior carrega o texto dela —
         * no Parallel Lab com Luna, "criado e destruído pela própria execução
         * dos testes", a frase que a arquitetura transformou em goal de fase.
         * O `plan` não reescreve o que o `init` publicou: trocar a regra aqui
         * mudaria o documento por baixo do desenvolvedor e a identidade de
         * tudo o que foi aprovado sobre ele. Diz a diferença e a rota — o
         * `init` republica com as respostas e a chamada do esqueleto que já
         * estão em disco —, e segue com o que está publicado.
         */
        // Só o texto que as versões anteriores escreviam: uma regra do escritor com o mesmo assunto é mantida pelo init e não é "de outra versão".
        const atuais = regrasDeBanco(decisaoDeBanco(doInit.questions, doInit.answers));
        const defasadas = atuais.filter((regra) =>
          guardado.rules.some((gravada) => gravada.subject === regra.subject && gravada.statement !== regra.statement && /criado e destru[ií]do pela pr[oó]pria execu[cç][aã]o/iu.test(gravada.statement)),
        );
        if (defasadas.length > 0) {
          const observacao =
            `a(s) regra(s) de banco ${defasadas.map((regra) => `"${regra.subject}"`).join(", ")} deste esqueleto foram escritas por uma versão anterior do harness e ainda prescrevem o procedimento da execução de teste ("criado e destruído pela própria execução"); ` +
            "o plano segue com o que está publicado. Para republicá-las, rode `capivara init` neste projeto — as respostas da entrevista e a chamada do esqueleto em disco são reaproveitadas — e depois `capivara plan`";
          announce(`  ${observacao}`);
          avisosDoRelatorio.push({ document: "skeleton.md", remark: { where: "regras de banco", observation: observacao } });
        }
      }

      /*
       * E as decisões do PLANO anterior, que eram gravadas e nunca lidas.
       *
       * `persistAnswers` diz, em comentário, que grava "para o run seguinte não
       * perguntar a mesma coisa" — e nada lia aquele arquivo. Um `plan` que
       * recomeça perdia tudo o que tinha sido decidido nele: as lacunas, os pontos
       * que o auditor devolveu ao desenvolvedor, as arbitragens. No `assistencia2`
       * eram dezessete decisões, várias delas parágrafos inteiros escritos à mão.
       *
       * O que volta são as ACEITAS, deduplicadas pelo texto. Não tento
       * reconstruir o par pergunta-resposta: os ids das rodadas de lacuna colidem
       * no handoff por construção (cada rodada recomeça em `Q-01`), e o que a
       * autoridade precisa é do TEXTO da decisão, que é o que o escritor e o
       * auditor leem. O que ficou em aberto não volta: se o marcador reaparecer, a
       * insistência o pega de novo, e com as saídas que a fecham.
       */
      const doPlano = await readHandoff(options.projectRoot, runId, "project-phases.md");
      if (doPlano) {
        const vistas = new Set<string>();
        let retomadas = 0;
        for (const answer of doPlano.answers) {
          if (answer.disposition !== "ACCEPTED" || answer.decision.trim() === "") continue;
          if (vistas.has(answer.decision)) continue;
          vistas.add(answer.decision);
          retomadas += 1;

          const original = doPlano.questions.find((question) => question.id === answer.questionId);
          const id = scoped("project-phases.md", `R-${String(retomadas).padStart(2, "0")}`, "retomado");
          allQuestions.push({
            id,
            topic: original?.topic ?? "decisão do plano anterior",
            evidence: "",
            decision: original?.decision ?? answer.decision,
            why: "",
            options: [],
            recommended: "",
            recommendationBasis: "",
          });
          allAnswers.push({ ...answer, questionId: id });
        }
        if (retomadas > 0) {
          announce(`  ${retomadas} decisão(ões) do plano anterior carregada(s); elas continuam valendo como autoridade`);
        }
      }

      announce(`— esqueleto lido: ${guardado.phases.length} fases, ${guardado.rules.length} regra(s) transversal(is)`);
      return await detalharFases(guardado);
    }

    await event("interview", "skeleton", "started");
    const entrevista = await interview("skeleton", []);
    allAnswers.push(...entrevista.answers.map((answer) => ({ ...answer, questionId: scoped("skeleton", answer.questionId) })));
    allQuestions.push(...entrevista.questions.map((question) => ({ ...question, id: scoped("skeleton", question.id) })));

    /*
     * Insiste ANTES de escrever o esqueleto, porque é aqui que ainda muda tudo.
     *
     * Uma decisão que fica aberta agora atravessa o esqueleto, as dezesseis fases
     * e o gate, para reaparecer no fim como "nenhuma decisão material segue em
     * aberto ✗". Perguntada aqui, ela custa dez segundos e o esqueleto nasce certo.
     */
    await insistirNasDecisoes("skeleton", maxInterviewRounds + 1, "antes de escrever o esqueleto");

    const decisoes = allAnswers.filter((answer) => answer.disposition === "ACCEPTED").map((answer) => answer.decision);
    const suposicoes = allAssumptions.map((assumption) => `${assumption.topic}: ${assumption.statement} (${assumption.basis})`);

    /*
     * O que o desenvolvedor recusou fica escrito no esqueleto.
     *
     * Não passa pelo escritor: ele escreveria "não haverá edição de clientes"
     * como prosa dele, e prosa do escritor é palpite. Isto é decisão do
     * desenvolvedor, gravada como ele a tomou, e por isso é o harness que a
     * põe lá — depois do parser, onde nada pode reescrevê-la.
     */
    const fora = naoObjetivos(entrevista.questions, entrevista.answers);
    if (fora.length > 0) announce(`  ${fora.length} área(s) registrada(s) como fora do escopo`);

    // O esqueleto é recusado pelo parser antes de custar qualquer fase escrita.
    await event("authoring", "skeleton", "started");
    /*
     * O escritor tenta até três vezes, e cada tentativa recebe os defeitos da
     * anterior nomeados.
     *
     * Eram duas, e conferiam só o parser. O piloto 6 terminou em NOT READY
     * porque uma story não aparecia no `covers` de fase nenhuma — defeito
     * mecânico, verificável em código, descoberto no gate quando já não havia
     * mais tentativa. A lição já estava escrita na auditoria do plano e não
     * tinha sido aplicada aqui: conferir no laço transforma um run perdido numa
     * segunda chamada de três minutos.
     *
     * Três tentativas porque agora há duas famílias de defeito a atravessar —
     * forma e executabilidade — e o esqueleto é a chamada mais barata do ciclo
     * e aquela de que todo o resto depende.
     */
    let esqueleto: Skeleton | null = null;
    let defeitos: string[] = [];
    const anteriores: string[] = [];
    // A mesma conferência mecânica da saída, antes de aceitar ou guardar uma resposta.
    const rejeicoesDoEsqueleto = (skeleton: Skeleton) => evaluatePlanReadiness({ skeleton, unresolvedQuestions: [] }).checks.filter(
      (check) => !check.passed && check.id !== "esqueleto" && check.id !== "decisoes",
    );
    for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
      const promptBase = skeletonPrompt({
        language: options.language,
        request: options.request.text,
        decisions: decisoes,
        assumptions: suposicoes,
        inventory: inventoryText,
        maxTasksPerPhase: MAX_TASKS_PER_PHASE,
        maxCriteriaPerTask: MAX_CRITERIA_PER_TASK,
        ...(defeitos.length > 0 ? { defects: defeitos } : {}),
      });
      // A terceira tentativa é do auditor, com o bloco de reparo (§121): duas estruturas inválidas do writer bastam.
      const papel: "writer" | "auditor" = tentativa === 3 ? "auditor" : "writer";
      if (papel === "auditor") {
        announce("  o escritor devolveu o esqueleto inválido duas vezes; o auditor assume a escrita, com os defeitos nomeados");
        registrarEstrategia("skeleton.md", "escrita do esqueleto pelo auditor depois de duas estruturas inválidas do writer");
        await event("authoring", "skeleton", "retry", "inválido duas vezes; o auditor assume", tentativa);
      }
      const promptDoEsqueleto = papel === "auditor"
        ? `${promptBase}\n\n${repairBlock({ document: "skeleton.md", findings: [], history: [`o writer devolveu duas estruturas inválidas: ${defeitos.join("; ")}`] })}`
        : promptBase;

      /*
       * O esqueleto que este mesmo prompt já produziu não é pago de novo.
       *
       * O `init` retomado depois de uma falha — provider fora, processo morto
       * entre a publicação e a gravação do estado — tinha todas as respostas em
       * disco e repagava a chamada do esqueleto assim mesmo. A chave é a mesma
       * das fases: o prompt, que carrega pedido, decisões e tetos.
       */
      const guardado = memoria.esqueletoEscrito(promptDoEsqueleto);
      if (guardado !== null) announce("  esqueleto reaproveitado de uma execução anterior: o prompt não mudou");
      const saida = guardado ?? (await track({ role: papel, stage: "authoring", subject: "skeleton", attempt: tentativa, prompt: promptDoEsqueleto }));

      /*
       * O mecanismo sem autoridade (I-17, §123) volta ao escritor nomeado nas
       * duas primeiras tentativas e ao auditor na terceira. O que sobrar
       * depois dela não bloqueia o run: o esqueleto é publicado com o resíduo
       * em ressalva, e o arquiteto recebe a regra de que um mecanismo sem
       * autoridade é escolha dele. Um run que para por causa de um caminho de
       * arquivo numa regra é exatamente "encontrar um motivo para interromper".
       */
      const limites = {
        maxTasksPerPhase: MAX_TASKS_PER_PHASE,
        authority: autoridadeDeTeste(),
        mechanisms: tentativa === 3 ? "tolerate" as const : "reject" as const,
      };
      let aceita = saida;
      let lido = parseSkeleton(saida, limites);
      let executaveis = lido.ok ? rejeicoesDoEsqueleto(lido.skeleton) : [];
      // A última tentativa já tolera I-17. Uma resposta anterior pode passar
      // nessa mesma política, sem perder os vínculos que a substituta omitiu. Reusar
      // o documento completo evita inventar associações entre fases ou fluxos
      // que o agente reorganizou. Só uma resposta que passa INTEIRA serve.
      if (tentativa === 3 && (!lido.ok || executaveis.length > 0)) {
        for (const anterior of anteriores.toReversed()) {
          const relido = parseSkeleton(anterior, limites);
          if (!relido.ok || rejeicoesDoEsqueleto(relido.skeleton).length > 0) continue;
          aceita = anterior;
          lido = relido;
          executaveis = [];
          announce("  a resposta substituta não passa na conferência estrutural; preservado o esqueleto anterior completo, conferido pela mesma política da tentativa final");
          break;
        }
      }
      anteriores.push(saida);
      if (!lido.ok) {
        defeitos = lido.defects.map((defeito) => `${defeito.problem} → ${defeito.hint}`);
        const comMecanismo = lido.defects.filter((defeito) => defeito.problem.includes("fixa mecanismo de implementação")).length;
        announce(
          `  o esqueleto veio com ${defeitos.length} defeito(s)${comMecanismo > 0 ? `, ${comMecanismo} dele(s) por fixar mecanismo de implementação que é do plano (I-17)` : " de forma"}; pedindo de novo com eles nomeados`,
        );
        continue;
      }
      for (const conserto of lido.applied) announce(`    esqueleto: ${conserto}`);
      if (lido.tolerated.length > 0) {
        announce(`  o esqueleto segue com ${lido.tolerated.length} ressalva(s): mecanismo de implementação que o escritor e o auditor não retiraram; o plano decide por conta própria (I-17)`);
        for (const residuo of lido.tolerated) {
          announce(`    ressalva: ${residuo}`);
          // O procedimento da execução de teste (§126) tolerado é do build, não do plano.
          const deTeste = residuo.includes("procedimento da execução de teste");
          // O pedido de testes tolerado fora do lugar (§129) também: a ressalva iria aos auditores do plano, que não leem teste.
          const pedidoDeTeste = residuo.includes("carrega o pedido de testes para o plano");
          remarks.push({
            document: "skeleton.md",
            remark: pedidoDeTeste
              ? { where: "I-16", observation: `${residuo} — o que o pedido diz sobre testes é executado pelo build; no plano, vale só o comportamento do produto` }
              : deTeste
                ? { where: "I-16", observation: `${residuo} — como a execução dos testes obtém e descarta o banco é do build; a regra vale pelo isolamento` }
                : { where: "I-17", observation: `${residuo} — o plano escolhe o mecanismo; a regra vale pelo comportamento` },
          });
        }
      }

      /*
       * O gate é a autoridade sobre o que é um esqueleto executável, então o
       * laço consulta O MESMO gate em vez de reimplementar a regra — é a tese do
       * contrato único aplicada aqui dentro.
       *
       * Fora as decisões em aberto, que são da entrevista e não do escritor: ele
       * não tem como fechá-las reescrevendo.
       */
      if (executaveis.length === 0) {
        esqueleto = lido.skeleton;
        // Só o esqueleto que PASSOU no gate entra na memória: uma resposta que
        // o gate recusou merece outra chamada, não a mesma resposta de novo.
        if (guardado === null || aceita !== saida) memoria.guardarEsqueleto(promptDoEsqueleto, aceita);
        break;
      }

      defeitos = executaveis.map((check) => `${check.title} — ${check.detail}`);
      announce(`  o esqueleto não passa no gate em ${executaveis.length} ponto(s); pedindo de novo com eles nomeados`);
    }

    if (!esqueleto) {
      throw new InitBlockedError(
        diagnostico("skeleton.md", [`o esqueleto veio inválido três vezes, duas do writer e uma do auditor: ${defeitos.join("; ")}`],
          "As respostas da entrevista estão em disco; `capivara init` retoma daqui. Verifique os modelos dos papéis writer e auditor."),
        runId,
      );
    }

    if (fora.length > 0) esqueleto = { ...esqueleto, nonGoals: fora };

    /*
     * As regras de banco entram aqui, e não no prompt.
     *
     * Pedir ao escritor que as reproduza seria pedir que ele as reescrevesse — e
     * uma regra reescrita é uma regra diferente. Elas são decisão do
     * desenvolvedor traduzida pelo harness, então o harness as põe no documento,
     * depois do parser, com as palavras exatas que valem para todas as fases.
     */
    const regrasDoBanco = regrasDeBanco(decisaoDeBanco(entrevista.questions, entrevista.answers));
    if (regrasDoBanco.length > 0) {
      const existentes = esqueleto.rules;
      esqueleto = {
        ...esqueleto,
        rules: [...existentes, ...regrasDoBanco.filter((regra) => !existentes.some((atual) => atual.subject === regra.subject))],
      };
      announce(`  ${regrasDoBanco.length} regra(s) de banco escritas a partir da sua decisão: .env, .env.example, migração e banco descartável nos testes`);
    }
    // A plataforma do aplicativo de janela, com as palavras da decisão: o build as lê para saber o que provar aqui.
    const regrasDaPlataformaDecidida = regrasDaPlataforma(decisaoDaPlataforma(entrevista.questions, entrevista.answers), desktopDeFora, sistema);
    if (regrasDaPlataformaDecidida.length > 0) {
      esqueleto = { ...esqueleto, rules: [...esqueleto.rules.filter((regra) => regra.subject !== ASSUNTO_DA_PLATAFORMA), ...regrasDaPlataformaDecidida] };
      announce(`  plataforma do aplicativo escrita a partir da sua decisão: ${regrasDaPlataformaDecidida[0]!.statement}`);
    }

    await publish(options.projectRoot, [{ name: "skeleton.md", content: renderSkeleton(esqueleto) }]);
    await event("publish", "skeleton", "complete", `${esqueleto.phases.length} fase(s), ${esqueleto.entities.length} entidade(s)`);
    announce(`  esqueleto: ${esqueleto.phases.length} fases, ${esqueleto.entities.length} entidades, ${esqueleto.rules.length} regra(s) transversal(is)`);

    await writeSkeletonState(options.projectRoot, runId, esqueleto);
    await writeRequestState(options.projectRoot, options.request);
    skeletonAtual = esqueleto;

    if (estagio === "init") {
      const planReadiness = evaluatePlanReadiness({
        skeleton: esqueleto,
        unresolvedQuestions: needsDecisionMarkers({
          round: maxInterviewRounds,
          questions: allQuestions,
          answers: allAnswers,
          assumptions: [],
          maxRounds: maxInterviewRounds,
        }),
      });

      await writeRunState(options.projectRoot, { ...state, stage: planReadiness.ready ? "ready" : "publish", status: planReadiness.ready ? "complete" : "blocked" }, now);
      await event(planReadiness.ready ? "ready" : "publish", "-", planReadiness.ready ? "complete" : "blocked", planReadiness.ready ? "PLAN READY" : "NOT READY");

      const relatorio: InitReport = {
        ready: planReadiness.ready,
        published: [`${artifactPaths(options.projectRoot).init}/skeleton.md`],
        phases: esqueleto.phases.length,
        tasks: esqueleto.phases.reduce((total, phase) => total + phase.taskCount, 0),
        mvpCutPhase: esqueleto.mvpCutPhase,
        coverage: { stories: esqueleto.stories.length, entities: esqueleto.entities.length, workflows: esqueleto.workflows.length },
        checkpoint: buildCheckpoint({ round: maxInterviewRounds, questions: allQuestions, answers: allAnswers, assumptions: allAssumptions, maxRounds: maxInterviewRounds }),
        remarks,
        costs: [...costs.values()],
        readiness: { ready: planReadiness.ready, checks: planReadiness.checks, contractErrors: [] },
      };

      await memoria.fechar();
      return { runId, readiness: relatorio.readiness, report: relatorio, rendered: renderPlanReadiness(planReadiness) };
    }

    return await detalharFases(esqueleto);
  }

  /**
   * O segundo estágio: a arquitetura, e então cada fase com tasks e critérios.
   *
   * A arquitetura é a chamada que olha o produto inteiro e concentra o raciocínio
   * arquitetural — componentes, contratos, infraestrutura e a divisão de fases
   * que vale. Cada fase vê a sua fatia do esqueleto E a sua fatia da arquitetura:
   * o que precisava ser acordado entre elas já foi, antes de qualquer task.
   */
  async function detalharFases(esqueletoDoInit: Skeleton): Promise<InitOutcome> {
    perguntasComPrazo = true;
    /*
     * O que o `init` deixou aberto é perguntado antes da primeira fase.
     *
     * O `plan` carrega as decisões do init pelo handoff, e carregava também as
     * que ficaram em aberto — para nada: nenhuma fase pode ser escrita sobre uma
     * decisão que não existe, e o escritor responde a isso marcando
     * `[NEEDS DECISION]`, que é trabalho refeito. Perguntar aqui é uma pergunta
     * agora contra dezesseis marcadores depois.
     */
    /*
     * O que já estava decidido ANTES de insistir.
     *
     * O esqueleto foi escrito destas, e a fatia de cada fase já as reflete:
     * repeti-las no prompt da fase seria pagar contexto para dizer duas vezes a
     * mesma coisa, e pior, dizê-la sob um título errado. O que a fase precisa ver
     * é só o que foi decidido DEPOIS — a insistência a seguir é justamente isso.
     */
    const antesDaInsistencia = new Set(
      allAnswers
        // Só as do esqueleto: a fatia de cada fase já as reflete. Tudo o mais foi
        // decidido DEPOIS de o esqueleto existir — inclusive o que um `plan`
        // anterior fechou —, e é disso que o escritor da fase precisa saber.
        .filter((answer) => answer.disposition === "ACCEPTED" && answer.questionId.startsWith("skeleton#"))
        .map((answer) => answer.decision),
    );
    await insistirNasDecisoes("project-phases.md", maxInterviewRounds + 1, "antes de detalhar as fases");
    const depoisDoEsqueleto = (): string[] =>
      allAnswers
        .filter((answer) => answer.disposition === "ACCEPTED" && !antesDaInsistencia.has(answer.decision))
        .map((answer) => answer.decision);

    /*
     * A arquitetura vem antes de qualquer fase, e é dela que sai a divisão de
     * fases que vale. O esqueleto do init é a proposta; o publicado daqui em
     * diante carrega a divisão e as sondas decididas pela arquitetura — é o que
     * o build e o `change` leem, e por isso é o esqueleto que muda, não eles.
     */
    esqueletoDeOrigem = esqueletoDoInit;
    relatarFase({ kind: "documento", etapa: "arquitetura" });
    const arquitetura = await arquitetar();
    skeletonAtual = await aplicarArquitetura(arquitetura);
    arquiteturaAtual = arquitetura;

    // Cada fase vê a sua fatia, e só ela. É a troca que corta a reconstrução do
    // projeto inteiro em toda chamada.
    const promptDeFase = (number: number): string => phaseFromSlicePrompt({
      language: options.language,
      request: options.request.text,
      slice: sliceForPhase(skeletonAtual!, number),
      ...(arquiteturaAtual ? { architecture: architectureSliceForPhase(arquiteturaAtual, number) } : {}),
      ...(arquiteturaAtual && tempoDaFase(arquiteturaAtual, skeletonAtual!, number) !== "" ? { tempo: tempoDaFase(arquiteturaAtual, skeletonAtual!, number) } : {}),
      phaseNumber: number,
      totalPhases: skeletonAtual!.phases.length,
      decisions: depoisDoEsqueleto(),
      grammar: tasksBlock(number),
      maxCriteriaPerTask: MAX_CRITERIA_PER_TASK,
      maxTasksPerPhase: MAX_TASKS_PER_PHASE,
    });

    const fases = await escreverFases(promptDeFase);

    plano = montarPlano(fases, unresolved({
      round: maxInterviewRounds,
      questions: allQuestions,
      answers: allAnswers,
      assumptions: [],
      maxRounds: maxInterviewRounds,
    }).map((item) => `${item.topic}: ${item.statement}`));

    const writerDoPlano = writerContext([]);
    relatarFase({ kind: "documento", etapa: "lacunas" });
    const semGaps = await closeGaps("project-phases.md", planoAutorado(fases, promptDeFase), writerDoPlano);
    plano = semGaps.content;

    relatarFase({ kind: "documento", etapa: "auditoria" });
    const final = await auditarPlano(semGaps, writerDoPlano);
    plano = final.content;
    planoAprovado = true;
    remarks.push(...final.remarks.map((remark) => ({ document: "project-phases.md", remark })));

    await publish(options.projectRoot, [{ name: "project-phases.md", content: final.content }]);
    await event("publish", "project-phases.md", "complete");

    return await concluir();
  }

  /** O plano montado em código, do esqueleto e da arquitetura que valem agora. */
  function montarPlano(partes: readonly string[], openQuestions: readonly string[]): string {
    const esqueleto = skeletonAtual!;
    return assemblePhasesDocument({
      projectName: esqueleto.projectName,
      stamp: buildStamp([
        { name: "skeleton.md", content: renderSkeleton(esqueleto) },
        ...(arquiteturaMd !== "" ? [{ name: "architecture.md", content: arquiteturaMd }] : []),
      ]),
      overview: `${esqueleto.phases.length} fases, fundação primeiro. O MVP fecha na fase ${esqueleto.mvpCutPhase}.`,
      phases: [...partes],
      openQuestions: [...openQuestions],
    });
  }

  /** O prompt do arquiteto, sempre sobre o esqueleto de ORIGEM e as decisões de agora. */
  function promptDoArquiteto(extras: { defects?: string[]; previous?: { architecture: string; findings: Finding[]; resolved?: Finding[] }; strategy?: "serialize" } = {}): string {
    return architectPrompt({
      language: options.language,
      request: options.request.text,
      skeleton: renderSkeleton(skeletonForPlanning(esqueletoDeOrigem!)),
      decisions: allAnswers.filter((answer) => answer.disposition === "ACCEPTED").map((answer) => answer.decision),
      assumptions: allAssumptions.map((assumption) => `${assumption.topic}: ${assumption.statement} (${assumption.basis})`),
      inventory: inventoryText,
      maxTasksPerPhase: MAX_TASKS_PER_PHASE,
      maxCriteriaPerTask: MAX_CRITERIA_PER_TASK,
      ...(extras.defects && extras.defects.length > 0 ? { defects: extras.defects } : {}),
      ...(extras.previous ? { previous: extras.previous } : {}),
      ...(extras.strategy ? { strategy: extras.strategy } : {}),
    });
  }

  /** O esqueleto com a divisão de fases e as sondas que a arquitetura decidiu. */
  function comArquitetura(arquitetura: Architecture): Skeleton {
    return {
      ...esqueletoDeOrigem!,
      phases: phasesFromArchitecture(arquitetura),
      mvpCutPhase: arquitetura.mvpCutPhase,
      environment: requirementsFromArchitecture(arquitetura),
    };
  }

  /**
   * A arquitetura deste plano: desenhada, auditada e publicada — ou reaproveitada.
   *
   * Reaproveitada quando o estado em disco foi derivado deste mesmo esqueleto
   * (de origem ou já aplicado) sob as mesmas decisões: nada do que decide a
   * arquitetura mudou, e a chamada seria paga para receber o que já está lá.
   */
  async function arquitetar(): Promise<Architecture> {
    const autoridade = shaDaAutoridade(allAnswers.filter((answer) => answer.disposition === "ACCEPTED").map((answer) => answer.decision));
    const shaDoEsqueleto = sha12(renderSkeleton(esqueletoDeOrigem!));

    const guardada = options.fresh === true ? null : await readArchitectureState(options.projectRoot, runId);
    /*
     * Reaproveitar não dispensa o contrato (§126): a arquitetura aprovada por
     * uma versão anterior pode carregar o que o contrato de hoje devolve — o
     * procedimento da execução de teste no goal das fases, no Luna. A mesma
     * leitura que um desenho novo passaria, sem chamada nenhuma.
     */
    const mesmaOrigem =
      guardada !== null &&
      guardada.authoritySha12 === autoridade &&
      (guardada.sourceSkeletonSha12 === shaDoEsqueleto || guardada.appliedSkeletonSha12 === shaDoEsqueleto);
    const contratoAtual = guardada === null || !mesmaOrigem
      ? null
      : parseArchitecture(JSON.stringify(guardada.architecture), esqueletoDeOrigem!, { maxTasksPerPhase: MAX_TASKS_PER_PHASE, authority: autoridadeDeTeste() });
    if (contratoAtual !== null && !contratoAtual.ok) {
      announce(`  a arquitetura guardada não passa no contrato atual (${contratoAtual.defects.map((defeito) => defeito.problem).join("; ")}); vou desenhá-la de novo`);
    }
    const reaproveitavel = guardada !== null && mesmaOrigem && contratoAtual?.ok === true;
    const impossiveisDaGuardada = reaproveitavel ? await sondasImpossiveis(guardada.architecture) : [];
    if (reaproveitavel && impossiveisDaGuardada.length === 0) {
      announce("  arquitetura reaproveitada de uma execução anterior: esqueleto e decisões não mudaram");
      await event("authoring", "architecture", "complete", "reaproveitada: esqueleto e decisões não mudaram");
      await publicarArquitetura(guardada.architecture, autoridade);
      return guardada.architecture;
    }
    if (impossiveisDaGuardada.length > 0) announce("  a arquitetura guardada tem sonda que esta máquina não satisfaz; vou desenhá-la de novo com o achado");

    await event("authoring", "architecture", "started");
    const desenhada = impossiveisDaGuardada.length > 0 ? await devolverPelasSondas(guardada!.architecture, impossiveisDaGuardada, {}, "writer") : await desenharArquitetura({});
    const auditada = await auditarArquitetura(desenhada);
    await publicarArquitetura(auditada, autoridade);
    return auditada;
  }

  /**
   * Uma arquitetura que passa no contrato, em até três tentativas com os
   * defeitos nomeados — e reaproveitada do cache quando o prompt não mudou.
   */
  async function desenharArquitetura(
    extras: { defects?: string[]; previous?: { architecture: string; findings: Finding[]; resolved?: Finding[] }; strategy?: "serialize"; historico?: string[] },
    papel: "writer" | "auditor" = "writer",
  ): Promise<Architecture> {
    let defeitos = extras.defects ?? [];
    const tentativas = papel === "writer" ? 3 : 2;
    for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
      const base = promptDoArquiteto({ ...extras, ...(defeitos.length > 0 ? { defects: defeitos } : {}) });
      const prompt = papel === "auditor"
        ? `${base}\n\n${repairBlock({ document: "architecture.md", findings: extras.previous?.findings ?? [], history: extras.historico ?? [], limits: ["Keep every component, contract and phase the findings do not name exactly as they are."] })}`
        : base;
      const guardada = memoria.arquiteturaEscrita(prompt);
      if (guardada !== null) announce("  arquitetura reaproveitada do cache: o prompt não mudou");
      const saida = guardada ?? (await track({ role: papel, stage: "authoring", subject: "architecture", attempt: tentativa, prompt }));

      const lida = parseArchitecture(saida, esqueletoDeOrigem!, { maxTasksPerPhase: MAX_TASKS_PER_PHASE, authority: autoridadeDeTeste() });
      if (!lida.ok) {
        defeitos = lida.defects.map((defeito) => `${defeito.problem} → ${defeito.hint}`);
        announce(`  a arquitetura veio com ${defeitos.length} defeito(s); pedindo de novo com eles nomeados`);
        await event("authoring", "architecture", "retry", defeitos.join("; "), tentativa);
        continue;
      }
      for (const conserto of lida.applied) announce(`    arquitetura: ${conserto}`);
      if (guardada === null) memoria.guardarArquitetura(prompt, saida);
      const impossiveis = await sondasImpossiveis(lida.architecture);
      if (impossiveis.length > 0) return await devolverPelasSondas(lida.architecture, impossiveis, extras, papel);
      return lida.architecture;
    }
    /*
     * O arquiteto não produz estrutura válida: o auditor assume (§121). O que
     * ele recebe é o mesmo prompt, os defeitos nomeados e o bloco de reparo; o
     * que ele devolve passa pelo mesmo parser e pela mesma auditoria — que, por
     * ter sido ele a escrever, é feita pelo verifier.
     */
    if (papel === "writer") {
      announce(`  o arquiteto devolveu estrutura inválida ${tentativas} vezes; o auditor assume o desenho, com os defeitos nomeados`);
      registrarEstrategia("architecture.md", `desenho pelo auditor depois de ${tentativas} estruturas inválidas do writer`);
      await event("authoring", "architecture", "retry", "estrutura inválida três vezes; o auditor assume", tentativas);
      arquiteturaReparada = true;
      return await desenharArquitetura({ ...extras, defects: defeitos, historico: [...(extras.historico ?? []), `o writer devolveu ${tentativas} estruturas inválidas: ${defeitos.join("; ")}`] }, "auditor");
    }
    throw new InitBlockedError(
      diagnostico("architecture.md", [`a arquitetura veio inválida ${tentativas} vezes pelo ${papel}, depois do writer: ${defeitos.join("; ")}`],
        "O esqueleto e as decisões continuam em disco; nada se perdeu. Verifique os modelos dos papéis writer e auditor e rode `capivara plan` de novo."),
      runId,
    );
  }

  /**
   * A sonda do runtime que nenhum build satisfaz, conferida antes de publicar.
   *
   * As sondas rodam com o Node do harness, e o build não troca de Node nem de
   * npm: a sonda que exige outra série (`principal===22` numa máquina com Node
   * 25) parava o build no preflight, depois de sessões inteiras de instalação
   * que não tinham como satisfazê-la. Aqui ela roda como o build a rodaria, sem
   * modelo nenhum. A arquitetura volta UMA vez com o achado; se insistir, o Core
   * troca a sonda pela que ele sabe ser verdadeira — o binário é o runtime em
   * que ele próprio roda, na versão instalada — e diz isso no relatório.
   */
  async function sondasImpossiveis(arquitetura: Architecture): Promise<string[]> {
    const falharam = await sondasDoRuntimeQueFalham(arquitetura.infrastructure.requirements, { cwd: options.projectRoot });
    if (falharam.length === 0) return [];
    const maquina = descreverAmbiente(await ambienteDoHarness());
    return falharam.map((sonda) => `a sonda ${comoSonda(sonda)} exige o que a máquina não tem: o harness roda ${maquina}`);
  }
  function comoSonda(sonda: PrerequisiteStatus): string {
    const comando = [sonda.binary, ...(sonda.checkArgs ?? [])].map((parte) => (/[\s"'`]/u.test(parte) ? JSON.stringify(parte) : parte)).join(" ");
    return `${sonda.technology} (\`${comando}\`)`;
  }
  async function devolverPelasSondas(
    arquitetura: Architecture,
    impossiveis: string[],
    extras: Parameters<typeof desenharArquitetura>[0],
    papel: "writer" | "auditor",
  ): Promise<Architecture> {
    if (sondasDevolvidas) return await trocarSondasDoRuntime(arquitetura, impossiveis);
    sondasDevolvidas = true;
    announce(`  ${impossiveis.length} sonda(s) da arquitetura exigem o que esta máquina não tem; devolvendo ao arquiteto, uma vez`);
    registrarEstrategia("architecture.md", "devolução ao arquiteto: sonda do runtime que esta máquina não satisfaz");
    await event("authoring", "architecture", "retry", impossiveis.join("; "));
    return await desenharArquitetura({ ...extras, defects: impossiveis }, papel);
  }

  /**
   * A segunda vez da sonda impossível: o Core a troca por `[binário, "--version"]`.
   *
   * Ele sabe dois fatos sem modelo nenhum — o binário é o runtime em que ele
   * próprio roda, e a versão é a instalada —, e a sonda que exige outra série
   * nenhum build satisfaz. Parar o plano por ela era cobrar do desenvolvedor o
   * que o Core já sabe. O que foi trocado, e as duas versões, vão ao relatório.
   */
  async function trocarSondasDoRuntime(arquitetura: Architecture, impossiveis: readonly string[]): Promise<Architecture> {
    const falharam = await sondasDoRuntimeQueFalham(arquitetura.infrastructure.requirements, { cwd: options.projectRoot });
    const maquina = descreverAmbiente(await ambienteDoHarness());
    const falhou = (requisito: EnvironmentRequirement): boolean =>
      falharam.some((sonda) => sonda.technology === requisito.technology && sonda.binary === requisito.binary && JSON.stringify(sonda.checkArgs ?? []) === JSON.stringify(requisito.checkArgs ?? []));
    for (const sonda of falharam) {
      avisosDoRelatorio.push({
        document: "architecture.md",
        remark: { where: "sondas de prontidão", observation: `a sonda ${comoSonda(sonda)} exige o que a máquina não tem: o harness roda ${maquina}; o arquiteto insistiu, e o Core a trocou por \`${sonda.binary} --version\`` },
      });
    }
    announce(`  a arquitetura insistiu em ${falharam.length} sonda(s) que esta máquina não satisfaz (o harness roda ${maquina}); o Core as trocou por ${falharam.map((sonda) => `\`${sonda.binary} --version\``).join(", ")} e seguiu`);
    registrarEstrategia("architecture.md", `sonda do runtime trocada pelo Core: ${falharam.map((sonda) => `${sonda.binary} --version`).join(", ")}`);
    await event("authoring", "architecture", "retry", `sonda trocada pelo Core: ${impossiveis.join("; ")}`);
    return {
      ...arquitetura,
      infrastructure: {
        ...arquitetura.infrastructure,
        requirements: arquitetura.infrastructure.requirements.map((requisito) => (falhou(requisito) ? { ...requisito, checkArgs: ["--version"] } : requisito)),
      },
    };
  }

  /**
   * A auditoria independente da arquitetura.
   *
   * Achado volta ao arquiteto como emenda — a arquitetura anterior mais os
   * achados — dentro de um orçamento PRÓPRIO de devoluções, o mesmo do auditor
   * do plano. Decisão de produto vai ao desenvolvedor na hora.
   *
   * O orçamento era compartilhado com as reorganizações pedidas pela auditoria
   * do plano, e foi isso que no `teste_openrouter3` (0.6.1) mandou ao
   * desenvolvedor um impasse "após 1 devoluções": duas reorganizações tinham
   * gasto o contador, e a primeira devolução da auditoria seguinte já não tinha
   * para onde ir. O que o auditor cobrava — "as fases 3, 4 e 5 editam arquivos
   * compartilhados sem ponto de extensão" — é um conflito técnico com mais de
   * uma solução válida, e nenhuma delas é do desenvolvedor.
   *
   * Agora: devoluções até o teto; esgotado, UMA mudança de estratégia
   * (resolver por ordem e dependência, sem mecanismo novo — a serialização que
   * o parser já aplica a quem declara o componente compartilhado); e se nem
   * assim convergir, o run para com o diagnóstico e tudo em disco. Nunca uma
   * pergunta técnica ao desenvolvedor, e nunca uma arquitetura reprovada
   * publicada como aprovada.
   */
  async function auditarArquitetura(desenhada: Architecture): Promise<Architecture> {
    let atual = desenhada;
    const history: AuditAttempt[] = [];
    let estrategiaTrocada = false;
    let reparos = 0;
    const maxReparos = 2;
    const writer = writerContext([]);

    for (let attempt = 1; ; attempt += 1) {
      const md = renderArchitecture(atual, esqueletoDeOrigem!);
      const papelDaAuditoria: "auditor" | "verifier" = arquiteturaReparada ? "verifier" : "auditor";
      const ultimaDevolucao = history.at(-1)?.verdict.findings ?? [];
      /*
       * O que as rodadas antes da última fecharam (§128). O arquiteto recebe
       * essa lista ("keep it fixed") e o auditor não recebia: no Parallel Lab
       * a validação dos formulários, pedida na rodada 1 e escrita na 2, sumiu
       * na reescrita da 3 — que tratava dos serviços — e as rodadas 3 e 4,
       * que só conheciam o achado anterior, aprovaram sem ela.
       */
      const daUltima = new Set(ultimaDevolucao.map(fingerprint));
      const anteriores = [...new Map(history.slice(0, -1).flatMap((tentativa) => tentativa.verdict.findings)
        .filter((finding) => !daUltima.has(fingerprint(finding)))
        .map((finding) => [fingerprint(finding), finding] as const)).values()];
      const promptDeAuditoria = architectureAuditPrompt({
        language: options.language,
        request: options.request.text,
        decisions: writer.decisions,
        skeleton: renderSkeleton(skeletonForPlanning(esqueletoDeOrigem!)),
        architecture: md,
        maxTasksPerPhase: MAX_TASKS_PER_PHASE,
        ...(ultimaDevolucao.length > 0 ? { previousFindings: ultimaDevolucao } : {}),
        ...(anteriores.length > 0 ? { earlierFindings: anteriores } : {}),
        tempoDosFluxos: tempoDosFluxos(atual, esqueletoDeOrigem!),
      });
      if (memoria.jaAprovada(promptDeAuditoria)) {
        announce("  arquitetura aprovada numa execução anterior, com a mesma auditoria; não vou repagar");
        return atual;
      }

      await event("audit", "architecture", "started", papelDaAuditoria === "verifier" ? "validação independente pelo verifier" : "", attempt);
      if (papelDaAuditoria === "verifier") announce("  validação independente da arquitetura reparada, pelo verifier");
      const verdict = await auditCall("architecture", attempt, () => promptDeAuditoria, papelDaAuditoria);
      const doAuditor = await perguntarDecisoesDoAuditor("architecture.md", verdict, attempt, writer);
      const findings = [...doAuditor, ...verdict.findings];

      if (findings.length === 0) {
        memoria.guardarAprovacao(promptDeAuditoria);
        remarks.push(...verdict.remarks.map((remark) => ({ document: "architecture.md", remark })));
        announce(`  arquitetura aprovada${papelDaAuditoria === "verifier" ? " pela validação independente" : ""}${verdict.remarks.length > 0 ? ` com ${verdict.remarks.length} ressalva(s)` : ""}`);
        arquiteturaReparada = false;
        await event("audit", "architecture", "complete", "aprovada", attempt);
        return atual;
      }

      history.push({ attempt, verdict: { ...verdict, findings }, contentSha: sha12(md) });
      const balanco = balancoDaRodada(history);
      announce(`  auditoria da arquitetura devolveu ${findings.length} achado(s)${history.length > 1 ? `; rodada: ${descreverBalanco(balanco)}` : ""}`);
      await event("audit", "architecture", "retry", findings.map((finding) => finding.problem).join("; "), attempt);

      /*
       * O teto conta devoluções sem progresso, e o dobro dele é o teto duro —
       * é `nextAuditAction`, o mesmo do plano (§120). O que o arquiteto já
       * fechou em rodadas anteriores vai junto, para não voltar.
       */
      const abertos = new Set(findings.map(fingerprint));
      const resolvidos = new Map<string, Finding>();
      for (const tentativa of history.slice(0, -1)) {
        for (const finding of tentativa.verdict.findings) if (!abertos.has(fingerprint(finding))) resolvidos.set(fingerprint(finding), finding);
      }
      const previous = { architecture: JSON.stringify(atual), findings, resolved: [...resolvidos.values()] };

      /*
       * Em modo de reparo toda emenda é do auditor e toda leitura é do
       * verifier, dentro do orçamento de reparos; fora dele, o arquiteto
       * emenda enquanto houver progresso e teto (§120), depois troca de
       * estratégia (§119), depois entrega ao auditor (§121).
       */
      if (arquiteturaReparada) {
        if (reparos < maxReparos) {
          reparos += 1;
          announce(`  o verifier devolveu a arquitetura reparada; o auditor repara de novo (${reparos}/${maxReparos})`);
          registrarEstrategia("architecture.md", `reparo ${reparos} pelo auditor sobre os achados do verifier`);
          await event("authoring", "architecture", "retry", `reparo ${reparos}/${maxReparos} pelo auditor`, attempt);
          atual = await desenharArquitetura({ previous, historico: writerDid(history) }, "auditor");
          continue;
        }
      } else {
        const acao = nextAuditAction({ document: "architecture.md", history, maxReturns: maxAuditReturns, maxMechanical: 1 });
        if (acao.action === "return-to-writer") {
          announce(`  refazendo a arquitetura com os ${findings.length} achado(s) juntos (devolução ${history.length}; teto ${maxAuditReturns} sem progresso)`);
          atual = await desenharArquitetura({ previous });
          continue;
        }

        if (!estrategiaTrocada) {
          estrategiaTrocada = true;
          announce("  a correção não convergiu no orçamento; trocando a estratégia: resolver por ordem e dependência entre fases, sem mecanismo novo");
          registrarEstrategia("architecture.md", `${history.length} devolução(ões) ao arquiteto; mudança de estratégia: serialização por dependência`);
          await event("authoring", "architecture", "retry", "mudança de estratégia: serialização por dependência", attempt);
          atual = await desenharArquitetura({ previous, strategy: "serialize" });
          continue;
        }

        if (reparos < maxReparos) {
          reparos += 1;
          arquiteturaReparada = true;
          announce(`  o arquiteto não fechou os achados nem com a estratégia trocada; o auditor assume o reparo (${reparos}/${maxReparos}) e o verifier valida, em sessão própria`);
          registrarEstrategia("architecture.md", `reparo ${reparos} pelo auditor depois da estratégia trocada; validação independente pelo verifier`);
          await event("authoring", "architecture", "retry", `reparo ${reparos}/${maxReparos} pelo auditor`, attempt);
          atual = await desenharArquitetura({ previous, historico: writerDid(history) }, "auditor");
          continue;
        }
      }

      /*
       * Nem com a estratégia trocada. Isto é o arquiteto e o auditor sem
       * convergir sobre um ponto técnico — não há decisão de produto aqui, e
       * perguntar ao desenvolvedor seria pedir que ele arbitre engenharia. O
       * run para com o diagnóstico; o esqueleto, as decisões e a última
       * arquitetura estão em disco, e a retomada custa só o que falta.
       */
      const insistentes = persistentFindings(history);
      await event("audit", "architecture", "blocked", "a auditoria da arquitetura não convergiu", attempt);
      throw new InitBlockedError(
        diagnostico("architecture.md", [
          `A auditoria de architecture.md não convergiu depois de ${history.length} devolução(ões): o arquiteto, a estratégia trocada e ${reparos} reparo(s) pelo auditor não fecharam o que o ${papelDaAuditoria} aponta.`,
          "",
          ...history.slice(1).map((tentativa, index) => `  rodada ${tentativa.attempt}: ${descreverBalanco(balancoDaRodada(history, index + 1))}`),
          "",
          "O que continua aberto:",
          ...insistentes.flatMap((finding) => [`  · ${finding.where}: ${finding.problem}`, `    correção pedida: ${finding.fix}`]),
          "",
          "Isto é um conflito técnico entre quem escreve e quem julga, não uma decisão de produto: nada aqui é seu para decidir.",
        ], "O esqueleto, as decisões e a última arquitetura estão em disco; `capivara plan` retoma daqui sem repagar o que já passou. Se o mesmo ponto voltar, troque o modelo de um dos papéis e rode de novo."),
        runId,
      );
    }
  }

  /**
   * A arquitetura refeita pela volta única do plano, lida UMA vez.
   *
   * Sem devolução, sem estratégia trocada, sem reparo: o que a auditoria
   * apontar descarta a refeita, e o plano segue com a arquitetura que já estava
   * aprovada e os bloqueios como pendência. Nunca uma arquitetura reprovada é
   * publicada como aprovada.
   */
  async function auditarArquiteturaUmaVez(refeita: Architecture): Promise<Architecture | null> {
    const prompt = architectureAuditPrompt({
      language: options.language,
      request: options.request.text,
      decisions: writerContext([]).decisions,
      skeleton: renderSkeleton(skeletonForPlanning(esqueletoDeOrigem!)),
      architecture: renderArchitecture(refeita, esqueletoDeOrigem!),
      maxTasksPerPhase: MAX_TASKS_PER_PHASE,
      tempoDosFluxos: tempoDosFluxos(refeita, esqueletoDeOrigem!),
    });
    if (memoria.jaAprovada(prompt)) return refeita;
    await event("audit", "architecture", "started", "a arquitetura refeita pela volta única do plano");
    const verdict = await auditCall("architecture", 1, () => prompt);
    const apontado = [...verdict.findings.map((finding) => `${finding.where}: ${finding.problem}`), ...(verdict.decisions ?? []).map((decisao) => `${decisao.where}: ${decisao.decision}`)];
    if (apontado.length > 0) {
      announce(`  a auditoria reprovou a arquitetura refeita (${apontado.length} achado(s)); ela é descartada, e o plano segue com a anterior`);
      await event("audit", "architecture", "blocked", `arquitetura refeita descartada: ${apontado.join("; ")}`);
      remarks.push({ document: "architecture.md", remark: { where: "volta única do plano", observation: `a arquitetura refeita foi descartada pela auditoria: ${apontado.join("; ")}` } });
      return null;
    }
    memoria.guardarAprovacao(prompt);
    remarks.push(...verdict.remarks.map((remark) => ({ document: "architecture.md", remark })));
    await event("audit", "architecture", "complete", "a arquitetura refeita foi aprovada");
    return refeita;
  }

  /** `architecture.md` e o estado dela em disco; idempotente. */
  async function publicarArquitetura(arquitetura: Architecture, autoridade: string): Promise<void> {
    arquiteturaMd = renderArchitecture(arquitetura, esqueletoDeOrigem!);
    await publish(options.projectRoot, [{ name: "architecture.md", content: arquiteturaMd }]);
    await writeArchitectureState(options.projectRoot, runId, {
      architecture: arquitetura,
      sourceSkeletonSha12: sha12(renderSkeleton(esqueletoDeOrigem!)),
      appliedSkeletonSha12: sha12(renderSkeleton(comArquitetura(arquitetura))),
      authoritySha12: autoridade,
    });
    await event("publish", "architecture", "complete", `${arquitetura.components.length} componente(s), ${arquitetura.phases.length} fase(s)`);
    announce(`  arquitetura: ${arquitetura.components.length} componente(s), ${arquitetura.phases.length} fase(s), ${arquitetura.infrastructure.requirements.length} sonda(s) de prontidão`);
  }

  /** O esqueleto publicado passa a carregar a divisão de fases e as sondas da arquitetura. */
  async function aplicarArquitetura(arquitetura: Architecture): Promise<Skeleton> {
    const esqueleto = comArquitetura(arquitetura);
    const origem = esqueletoDeOrigem!;
    const mesmaDivisao =
      origem.phases.length === esqueleto.phases.length &&
      origem.phases.every((fase, posicao) => JSON.stringify(fase) === JSON.stringify(esqueleto.phases[posicao]));
    if (!mesmaDivisao) announce(`  a arquitetura reorganizou as fases: ${origem.phases.length} do init → ${esqueleto.phases.length}`);
    await publish(options.projectRoot, [{ name: "skeleton.md", content: renderSkeleton(esqueleto) }]);
    await writeSkeletonState(options.projectRoot, runId, esqueleto);
    await event("publish", "skeleton", "complete", `${esqueleto.phases.length} fase(s) com a arquitetura aplicada`);
    return esqueleto;
  }

  /**
   * As fases escritas, cada uma da sua fatia — reaproveitadas do cache quando o
   * prompt não mudou. Serve à primeira escrita e à reescrita depois de uma
   * reorganização: a fase cujo prompt não mudou custa zero, e a que a
   * reorganização não tocou (`mantidas`, §128) também.
   */
  async function escreverFases(promptDeFase: (number: number) => string, mantidas: ReadonlyMap<number, string> = new Map()): Promise<string[]> {
    const esqueleto = skeletonAtual!;
    const fases = new Array<string>(esqueleto.phases.length).fill("");
    const fila = esqueleto.phases.map((fase, posicao) => ({ fase, posicao }));
    // O esqueleto sabe quantas tasks cada fase aloca; a tela passa a saber também.
    relatarFase({
      kind: "planned",
      phases: esqueleto.phases.map((fase) => ({ number: fase.number, title: fase.title, tasks: fase.taskCount })),
    });
    /*
     * Uma fase que falha não derruba as irmãs que estão terminando.
     *
     * Com `Promise.all`, a primeira rejeição saía daqui com as outras
     * trabalhadoras ainda no meio da escrita — e a fase que elas terminavam um
     * instante depois nunca chegava ao cache, porque ninguém esperava por ela.
     * Cada trabalhadora guarda o próprio erro; o primeiro sai só depois de
     * TODAS acabarem e de o cache ir ao disco. É isso que faz a retomada custar
     * só a fase que faltou.
     */
    const erros: unknown[] = [];
    await Promise.all(
      Array.from({ length: Math.min(maxParallelParts, fila.length) }, async () => {
        for (;;) {
          const proxima = fila.shift();
          if (!proxima) return;
          const { fase, posicao } = proxima;
          const marca = `phase-p${String(fase.number).padStart(2, "0")}`;
          try {

          /*
           * A fase avisa que começou, não só que terminou.
           *
           * Enquanto só havia `complete`, um `plan` que morresse escrevendo
           * fases não deixava evento nenhum sobre elas: o events.tsv ia direto
           * do PLAN READY para o nada. Quem fosse investigar não sabia sequer
           * quantas fases tinham sido tentadas.
           */
          await event("authoring", marca, "started");
          relatarFase({ kind: "authoring", number: fase.number, state: "corrente" });

          const promptDaFase = promptDeFase(fase.number);

          /*
           * Intocada pela reorganização (§128): o texto atual vale, guardado sob
           * o prompt novo para que a retomada encontre o mesmo.
           */
          const mantida = mantidas.get(fase.number);
          if (mantida !== undefined) {
            fases[posicao] = mantida;
            memoria.guardarFase(promptDaFase, mantida);
            relatarFase({ kind: "authoring", number: fase.number, state: "reused" });
            announce(`  fase ${fase.number} mantida: a reorganização não mudou o envelope, os componentes nem o tempo dela; a auditoria a relê se a fatia dela mudou`);
            await event("authoring", marca, "complete", "mantida: envelope, componentes e tempo iguais");
            continue;
          }

          /*
           * Já escrita por este mesmo prompt? Então ela não mudou, e a chamada
           * seria paga para receber o que já está em disco.
           */
          const guardada = memoria.faseEscrita(promptDaFase);
          if (guardada !== null) {
            fases[posicao] = guardada;
            relatarFase({ kind: "authoring", number: fase.number, state: "reused" });
            announce(`  fase ${fase.number} reaproveitada de uma execução anterior`);
            await event("authoring", marca, "complete", "reaproveitada: o prompt não mudou");
            continue;
          }

          /*
           * Fase sem task é resposta inválida, não resultado.
           *
           * O sinal sempre existiu — `extractTasks` devolve "não achei task
           * nenhuma" — e era anunciado e ignorado. No piloto 7, duas das três
           * fases foram publicadas vazias porque a CLI encerrou a volta sem
           * texto, e o log disse "fase 1 pronta" para as duas. Uma segunda
           * tentativa custa uma chamada. Descobrir no gate custa o run.
           */
          let tarefas: { tasks: string; applied: string[] } = { tasks: "", applied: [] };
          for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
            // A terceira é do auditor, com o bloco de reparo (§121): o escritor mostrou que não produz a fase.
            if (tentativa === 3) {
              announce(`  fase ${fase.number} sem task em duas tentativas do escritor; o auditor assume a escrita`);
              registrarEstrategia(marca, "escrita pelo auditor depois de duas respostas sem task do writer");
              await event("authoring", marca, "retry", "sem task duas vezes; o auditor assume", tentativa);
            }
            const saida = await track({
              role: tentativa === 3 ? "auditor" : "writer",
              stage: "authoring",
              subject: `phase-p${String(fase.number).padStart(2, "0")}`,
              attempt: tentativa,
              prompt: tentativa === 3
                ? `${promptDaFase}\n\n${repairBlock({ document: marca, findings: [], history: ["o writer devolveu a fase sem task nenhuma, duas vezes"] })}`
                : promptDaFase,
            });
            const semMortas = stripDeadDesignRefs(repairDeterministically(saida).content, designExiste);
            for (const conserto of semMortas.applied) announce(`    fase ${fase.number}: ${conserto}`);

            // O modelo escreveu as tasks; o envelope vem do esqueleto, montado em
            // código. Número, título, goal, dependências e cobertura deixam de ser
            // coisas que ele possa errar.
            tarefas = extractTasks(semMortas.content);
            for (const conserto of tarefas.applied) announce(`    fase ${fase.number}: ${conserto}`);

            if (contaTasks(tarefas.tasks) > 0) break;
            if (tentativa === 1) announce(`  fase ${fase.number} voltou sem task nenhuma; pedindo de novo`);
          }

          if (contaTasks(tarefas.tasks) === 0) {
            throw new InitBlockedError(
              diagnostico(marca, [`a fase ${fase.number} voltou sem nenhuma task em três tentativas: duas do writer e uma do auditor.`],
                "Nenhum dos dois papéis produziu conteúdo — verifique provider e modelo antes de rodar de novo. As fases já escritas e a arquitetura continuam em cache."),
              runId,
            );
          }

          fases[posicao] = assemblePhase(
            { number: fase.number, title: fase.title, goal: fase.goal, dependsOn: fase.dependsOn, covers: fase.covers, areas: fase.areas },
            tarefas.tasks,
          ).trim();
          memoria.guardarFase(promptDaFase, fases[posicao]!);
          relatarFase({ kind: "authoring", number: fase.number, state: "pronta" });
          announce(`  fase ${fase.number} pronta`);
          await event("authoring", marca, "complete");
          } catch (erro) {
            erros.push(erro);
            return;
          }
        }
      }),
    );

    /*
     * As fases vão ao disco ANTES da auditoria — e antes de qualquer erro sair.
     *
     * É a parte cara e é a que costuma matar o run: se o cache só fosse gravado
     * no fim, um impasse de auditoria levaria junto as horas de escrita — que foi
     * exatamente o que aconteceu duas vezes no `assitencia`.
     */
    await memoria.fechar();
    if (erros.length > 0) throw erros[0];
    return fases;
  }

  /**
   * O artefato de design existe em disco?
   *
   * Função declarada, não `const`: ela é usada na escrita das fases, que roda
   * antes deste ponto do arquivo, e `const` não é içado.
   */
  function designExiste(caminho: string): boolean {
    return existsSync(join(artifactPaths(options.projectRoot).init, caminho)) || existsSync(join(options.projectRoot, caminho));
  }

  /** O contexto do escritor para um documento, montado do que já foi decidido. */
  function writerContext(upstream: { name: string; content: string }[]): WriterContext {
    return {
      language: options.language,
      request: options.request.text,
      decisions: allAnswers.filter((answer) => answer.disposition === "ACCEPTED").map((answer) => answer.decision),
      assumptions: allAssumptions.map((assumption) => `${assumption.topic}: ${assumption.statement} (${assumption.basis})`),
      upstream,
    };
  }

  /** Um achado endereçado à arquitetura: pede reorganização de fases, não emenda de uma. */
  function ehDeArquitetura(finding: Finding): boolean {
    return /^\s*(?:architecture|arquitetura)\b/i.test(finding.where);
  }

  /**
   * O plano montado, com a forma de emendar o que a auditoria citar.
   *
   * Dois destinos. Um achado endereçado a `Architecture` refaz a arquitetura —
   * é a única forma de dividir, fundir ou reordenar fases — e as fases cujo
   * envelope e fatia não mudaram voltam do cache sem custo. Qualquer outro
   * achado emenda a fase que ele nomeia, da MESMA fatia que a escreveu.
   *
   * Sem isto a devolução não tinha o que reescrever: o plano voltava idêntico e o
   * ciclo virava impasse com zero devoluções.
   */
  function planoAutorado(fases: string[], promptDeFase: (number: number) => string): Authored {
    const autorado = (partes: string[]): Authored => ({
      content: montarPlano(partes, []),
      rewrite: async (findings, attempt, opcoes) => {
        const deArquitetura = findings.filter(ehDeArquitetura);
        const deFase = findings.filter((finding) => !ehDeArquitetura(finding));

        if (opcoes?.voltaUnica === true) {
          const novas = await reorganizar(findings, promptDeFase, partes, [], true);
          return novas === null ? autorado(partes) : autorado(novas);
        }

        if (deArquitetura.length > 0) {
          if (reorganizacoes < maxArchitectureReturns) {
            // `affectedPhases` de uma lista vazia são todas as fases: sem achado de fase, nenhuma está aberta.
            const novas = await reorganizar(deArquitetura, promptDeFase, partes, deFase.length > 0 ? affectedPhases(deFase, partes.length) : []);
            /*
             * Depois de uma reorganização os números de fase podem ter mudado, e
             * um achado de fase da divisão anterior não tem mais endereço. Eles
             * não são perdidos: a auditoria reconfere tudo o que não está
             * aprovado pelo texto, e o que ainda valer volta com endereço novo.
             */
            if (deFase.length > 0) announce(`  ${deFase.length} achado(s) de fase ficam para a próxima auditoria, sobre a divisão nova`);
            return autorado(novas);
          }
          /*
           * O envelope que a arquitetura não corrigiu não vai a voto (§126).
           *
           * "Seguem para a sua arbitragem" é o destino de um achado de
           * reorganização que pode ser uma escolha; o goal de uma fase que
           * contradiz a regra do planejamento não é. No Parallel Lab com Luna
           * ele foi arbitrado três vezes — "qual dos dois entendimentos vale?"
           * — e a resposta, gravada como decisão aceita, não tinha quem a
           * aplicasse. O run para dizendo onde o defeito nasceu.
           */
          const doEnvelope = deArquitetura.filter(veioDoEnvelope);
          if (doEnvelope.length > 0) {
            await event("audit", "project-phases.md", "blocked", "o envelope de fase herdado da arquitetura não convergiu", attempt);
            throw new InitBlockedError(
              diagnostico("project-phases.md", [
                `O que a auditoria do plano aponta está no envelope de fase, e o envelope é escrito por architecture.md, não por project-phases.md: a emenda e o reparo de uma fase só reescrevem as tasks dela.`,
                `A arquitetura foi refeita ${reorganizacoes} vez(es) — o orçamento de reorganizações — e o ponto voltou.`,
                "",
                "O que continua aberto, no documento de origem:",
                ...doEnvelope.flatMap((finding) => [`  · ${finding.where}: ${finding.problem}`, `    correção pedida: ${finding.fix}`]),
                "",
                ...(deFase.length > 0 ? ["", `E ${deFase.length} achado(s) de fase desta rodada, que esperavam a divisão nova, também seguem abertos.`] : []),
                "",
                "Isto é um defeito técnico herdado da arquitetura, não uma decisão de produto: nada aqui é seu para decidir.",
              ], "O esqueleto, a arquitetura e as fases estão em disco; `capivara plan` retoma daqui sem repagar o que já passou. Se o mesmo ponto voltar, troque o modelo do papel writer (o arquiteto) ou do auditor e rode de novo."),
              runId,
            );
          }
          announce(`  ${deArquitetura.length} achado(s) pedem reorganização, e o orçamento de ${maxArchitectureReturns} reorganização(ões) acabou; eles seguem para a sua arbitragem`);
          if (deFase.length === 0) return autorado(partes);
        }

        /*
         * O fallback de "todas as fases" é certo para uns achados e destrutivo
         * para outros.
         *
         * Para um achado de COERÊNCIA ele é a coisa certa: aquele auditor não
         * nomeia fase porque o defeito é ENTRE elas, e quem pode consertar são as
         * fases. Para uma decisão de LACUNA é o oposto — ela fala de um marcador
         * que vive numa fase só, e reescrever as outras doze muda o texto de
         * todas, muda o sha de cada uma, e derruba as aprovações já pagas. Medido
         * no `assistencia2`: a tentativa 3 aprovou 10 fases e a 4 reauditou 12.
         *
         * Então quem chama declara. O padrão continua conservador; quem sabe que
         * o achado é de UMA fase pede `somenteNomeadas` e, se ninguém souber dizer
         * qual, o harness não reescreve nada — e diz que não soube.
         */
        const alvos = affectedPhases(deFase, partes.length);
        const semReferencia = alvos.length === partes.length && !deFase.some((finding) => finding.phase !== undefined);
        if (opcoes?.somenteNomeadas === true && semReferencia) {
          announce("  não consegui localizar a fase destes achados; não vou reescrever o plano inteiro por isso");
          return autorado(partes);
        }
        announce(`  emendando ${alvos.length} de ${partes.length} fase(s)`);
        const proximas = [...partes];
        const esqueleto = skeletonAtual!;

        const fila = [...alvos];
        await Promise.all(
          Array.from({ length: Math.min(maxParallelParts, fila.length) }, async () => {
            for (;;) {
              const numero = fila.shift();
              if (numero === undefined) return;
              const fase = esqueleto.phases.find((entry) => entry.number === numero);
              if (!fase) continue;

              // A emenda também vê só as tasks: o envelope é do esqueleto, e
              // não há emenda de auditoria que o mude. Mandar a fase inteira era
              // devolver ao modelo a chance de estragar o que ele não escreveu.
              const anterior = extractTasks(proximas[numero - 1] ?? "").tasks;
              const destaFase = deFase.filter(finding => affectedPhases([finding], partes.length).includes(numero));
              const relacionadas = new Set(destaFase.flatMap(finding => affectedPhases([finding], partes.length)));
              const papel = opcoes?.papel ?? "writer";
              const promptDaEmenda = amendPhasePrompt({
                  language: options.language,
                  request: options.request.text,
                  current: anterior,
                  findings: destaFase,
                  relatedPhases: [...relacionadas].filter(number => number !== numero).map(number => partes[number - 1] ?? ""),
                  decisions: allAnswers.filter(answer => answer.disposition === "ACCEPTED").map(answer => answer.decision),
                  slice: sliceForPhase(esqueleto, numero),
                  ...(arquiteturaAtual ? { architecture: architectureSliceForPhase(arquiteturaAtual, numero) } : {}),
                  phaseNumber: numero,
                  grammar: tasksBlock(numero),
                });
              const saida = await track({
                role: papel,
                stage: "authoring",
                subject: `phase-p${String(numero).padStart(2, "0")}`,
                attempt,
                prompt: papel === "auditor"
                  ? `${promptDaEmenda}\n\n${repairBlock({ document: `phase-p${String(numero).padStart(2, "0")}`, findings: destaFase, history: opcoes?.historico ?? [] })}`
                  : promptDaEmenda,
              });

              const limpa = stripDeadDesignRefs(repairDeterministically(saida).content, designExiste);
              for (const conserto of limpa.applied) announce(`    fase ${numero}: ${conserto}`);

              const envelope = { number: fase.number, title: fase.title, goal: fase.goal, dependsOn: fase.dependsOn, covers: fase.covers, areas: fase.areas };
              const candidato = preserveUnaddressedTasks(
                partes[numero - 1] ?? "",
                assemblePhase(envelope, extractTasks(limpa.content).tasks).trim(),
                numero,
                destaFase,
              );

              /*
               * Emenda que destrói a fase não entra no documento.
               *
               * No `assitencia` o escritor, sem decisão para fechar um achado,
               * respondeu com uma CARTA — quatro perguntas de múltipla escolha
               * para o desenvolvedor — e uma única task sem critério nem trace.
               * O que sai da emenda vai direto para o documento. A fase de nove
               * tasks virou um toco, o contrato reprovou por I-08 e I-09, e as
               * três rodadas foram gastas assim, em cinco fases ao mesmo tempo.
               */
              const recusa = emendaInutil(candidato, proximas[numero - 1] ?? "");
              if (recusa === null) {
                proximas[numero - 1] = candidato;
                memoria.guardarFase(promptDeFase(numero), candidato);
                continue;
              }

              announce(`    fase ${numero}: emenda recusada (${recusa}); mantendo a versão anterior`);
              await event("authoring", `phase-p${String(numero).padStart(2, "0")}`, "retry", `emenda recusada: ${recusa}`, attempt);
            }
          }),
        );

        await memoria.fechar();
        return autorado(proximas);
      },
    });

    return autorado(fases);
  }

  /**
   * A reorganização: a arquitetura refeita com os achados, auditada, aplicada ao
   * esqueleto, e as fases reescritas — as que ela não tocou mantêm o texto
   * (§128). É o que permite dividir, fundir e reordenar fases no meio da
   * auditoria sem repagar o que já estava certo.
   */
  async function reorganizar(
    findings: readonly Finding[],
    promptDeFase: (number: number) => string,
    atuais: readonly string[],
    comAchadoAberto: readonly number[],
    /** A volta única do bloqueio que sobrou (`voltaUnica`): uma auditoria, e `null` quando a refeita é descartada. */
    unica: true,
  ): Promise<string[] | null>;
  async function reorganizar(
    findings: readonly Finding[],
    promptDeFase: (number: number) => string,
    atuais: readonly string[],
    /** As fases com achado de fase aberto nesta rodada: são reescritas, como antes — o achado não as segue. */
    comAchadoAberto?: readonly number[],
  ): Promise<string[]>;
  async function reorganizar(
    findings: readonly Finding[],
    promptDeFase: (number: number) => string,
    atuais: readonly string[],
    comAchadoAberto: readonly number[] = [],
    unica = false,
  ): Promise<string[] | null> {
    const arquiteturaAntes = arquiteturaAtual;
    const esqueletoAntes = skeletonAtual;
    if (unica) {
      announce(`  ${findings.length} bloqueio(s) sobraram depois da emenda; refazendo a arquitetura uma vez, com as citações, e auditando-a uma vez`);
      await event("authoring", "architecture", "retry", `volta única do plano: ${findings.map((finding) => finding.problem).join("; ")}`);
    } else {
      reorganizacoes += 1;
      announce(`  ${findings.length} achado(s) pedem reorganização das fases; refazendo a arquitetura (${reorganizacoes}/${maxArchitectureReturns})`);
      await event("authoring", "architecture", "retry", findings.map((finding) => finding.problem).join("; "), reorganizacoes);
    }
    relatarFase({ kind: "documento", etapa: "reorganização das fases" });

    const anterior = JSON.stringify(arquiteturaAtual);
    let refeita = await desenharArquitetura({ previous: { architecture: anterior, findings: [...findings] } });
    /*
     * Na volta única, a mesma arquitetura de volta não tem o que auditar nem o
     * que reescrever: ela é descartada sem chamada nenhuma, e o bloqueio segue
     * para o plano como pendência.
     */
    if (unica && JSON.stringify(refeita) === anterior) {
      announce("  o arquiteto devolveu a mesma arquitetura; nada a auditar, o plano segue como estava");
      return null;
    }
    /*
     * A mesma arquitetura de volta é a emenda que não mudou o texto — e sem
     * isto ela seguia para a arbitragem do desenvolvedor, como as Q-91 e Q-92
     * do `teste_openrouter3`, sobre quem integra o quê. Antes de perguntar a
     * quem não decide isso, a estratégia muda: resolver por ordem e dependência.
     */
    if (JSON.stringify(refeita) === anterior) {
      announce("  o arquiteto devolveu a mesma arquitetura; trocando a estratégia: resolver por ordem e dependência entre fases, sem mecanismo novo");
      await event("authoring", "architecture", "retry", "mudança de estratégia: serialização por dependência", reorganizacoes);
      refeita = await desenharArquitetura({ previous: { architecture: anterior, findings: [...findings] }, strategy: "serialize" });
    }
    const auditada = unica ? await auditarArquiteturaUmaVez(refeita) : await auditarArquitetura(refeita);
    if (auditada === null) return null;
    const autoridade = shaDaAutoridade(allAnswers.filter((answer) => answer.disposition === "ACCEPTED").map((answer) => answer.decision));
    await publicarArquitetura(auditada, autoridade);
    skeletonAtual = await aplicarArquitetura(auditada);
    arquiteturaAtual = auditada;
    /*
     * A fase que a reorganização não tocou mantém o texto que tem — com as
     * emendas que já recebeu (§128). "Não tocou" é o envelope, os componentes
     * dela e o tempo dos fluxos que ela cobre (§127): o build percorre o
     * workflow ao fim da mesma fase, contra o mesmo caminho. O resto da fatia
     * mudou, e por isso a auditoria a relê: a aprovação dela é chaveada pela
     * fatia, e nada aprovado contra a arquitetura anterior vale aqui.
     */
    /*
     * A fase com achado aberto nesta rodada não é mantida. Os achados de fase
     * que chegam junto com uma reorganização "ficam para a próxima auditoria",
     * e a próxima auditoria de uma fase aprovada e intacta não acontece: a
     * revisão da primeira versão mostrou a decisão do desenvolvedor, levantada
     * pelo auditor da fase 4 na mesma rodada, sumindo do plano publicado.
     * Reescrita, a fase recebe a decisão no prompt — como recebia antes.
     */
    const mantidas = new Map<number, string>();
    if (arquiteturaAntes && esqueletoAntes) {
      for (const numero of fasesIntactas(arquiteturaAntes, auditada, atuais)) {
        if (comAchadoAberto.includes(numero)) continue;
        if (tempoDaFase(arquiteturaAntes, esqueletoAntes, numero) !== tempoDaFase(auditada, skeletonAtual, numero)) continue;
        const texto = atuais[numero - 1] ?? "";
        if (texto.trim() !== "") mantidas.set(numero, texto);
      }
    }
    return await escreverFases(promptDeFase, mantidas);
  }

  /**
   * As fontes de cobertura: o esqueleto, que é quem declarou o produto.
   *
   * Sem esqueleto não há o que cobrir — e é o caso de quem ainda não rodou o
   * `init`, onde as listas vazias fazem a checagem passar por não ter assunto.
   */
  /**
   * Os achados de cobertura, cada um endereçado à fase que o ESQUELETO diz ser a
   * dona do item.
   *
   * Eles saíam com `where: "Traces"` e sem fase, e `affectedPhases` fazia o que
   * faz com achado sem endereço: mandava para todas. Medido no `assistencia2`: "o
   * workflow 7 não é coberto por nenhuma task" chegou à fase 11 (Estoque), que
   * não tem o workflow 7 na fatia e não pode cobri-lo. Ela fez a única coisa legal
   * que o prompt da emenda permite — escreveu `[NEEDS DECISION] Indicar a task
   * que implementa workflow 7` —, e esse marcador, que nenhum desenvolvedor pode
   * responder porque a resposta verdadeira é "isto não é da fase 11", atravessou
   * a auditoria inteira e reprovou o plano no gate. Todo o resto estava aprovado.
   *
   * O harness SABE a resposta: o workflow 7 está no `covers` da fase 6. É o
   * princípio do §77.7 — o harness diz o que sabe em vez de deixar adivinhar pela
   * prosa — e ele tinha ficado de fora justamente da conferência que o harness faz
   * sozinho.
   *
   * O QUE falta continua sendo decidido por `checkCoverage`, com as mesmas
   * mensagens; o que muda é só PARA ONDE vai. Um item em mais de uma fase vira um
   * achado para cada uma — qualquer uma delas que o rastreie satisfaz a checagem.
   */
  function achadosDeCobertura(documento: PhasesDocument): Finding[] {
    const fontes = coberturaAtual();
    const fasesDoEsqueleto = skeletonAtual?.phases ?? [];
    const cobreEste = (item: string): number[] =>
      fasesDoEsqueleto
        .filter((fase) => fase.covers.some((coberto) => coberto.trim().toLowerCase() === item.toLowerCase()))
        .map((fase) => fase.number);

    const itens: { erros: ContractError[]; donos: number[] }[] = [
      ...fontes.storyIds.map((id) => ({ erros: checkStories(documento, [id]), donos: cobreEste(id) })),
      ...fontes.entities.map((nome) => ({ erros: checkEntities(documento, [nome]), donos: cobreEste(nome) })),
      ...fontes.workflows.map((workflow) => ({
        erros: checkWorkflows(documento, [workflow]),
        // O esqueleto escreve `workflow 7` ou só `7`; `workflowsForPhase` aceita os dois.
        donos: [...new Set([...cobreEste(`workflow ${workflow.number}`), ...cobreEste(workflow.number)])],
      })),
    ];

    return itens.flatMap(({ erros, donos }) =>
      erros.flatMap((erro) =>
        donos.length === 0
          ? [{ where: "Traces", problem: erro.message, fix: erro.hint, mechanical: true }]
          : donos.map((fase) => ({
              where: `Phase ${fase} · Traces`,
              problem: erro.message,
              fix: `${erro.hint}. O esqueleto põe este item na fase ${fase}: é nela que a task que o rastreia precisa existir`,
              phase: fase,
              mechanical: true,
            })),
      ),
    );
  }

  /**
   * O que autoriza o plano a nomear uma ferramenta ou um arquivo de teste
   * (I-16): o pedido e as decisões que o DESENVOLVEDOR tomou na entrevista.
   *
   * As decisões levantadas pelo auditor, pelo impasse e pelo ensaio ficam de
   * fora de propósito: as leituras delas são escritas por um modelo, e foi
   * exatamente uma delas — "manter a automação com Vitest e Playwright" — que
   * no `teste_openrouter3` virou "decisão confirmada" e passou a exigir, nas
   * auditorias seguintes, a prescrição que a regra proíbe.
   */
  function autoridadeDeTeste(): string[] {
    const topico = (questionId: string): string => allQuestions.find((question) => question.id === questionId)?.topic ?? "";
    const doDesenvolvedor = allAnswers.filter(
      (answer) =>
        answer.disposition === "ACCEPTED" &&
        !/#(?:auditoria|standoff|ensaio)#/u.test(answer.questionId) &&
        !/^(?:auditoria|ensaio|impasse)\b/u.test(topico(answer.questionId)),
    );
    /*
     * E as dependências que a infraestrutura aprovada declara (§129): o plano
     * escolhe todas, as de teste também, e a task da fundação que as declara no
     * manifesto cumpre a escolha — não a faz. A arquitetura sob leitura não se
     * autoriza: ela só entra aqui depois de aprovada.
     */
    const daInfraestrutura = arquiteturaAtual === null
      ? []
      : Object.values(arquiteturaAtual.infrastructure)
        .flatMap((grupo) => (Array.isArray(grupo) ? grupo : []))
        .map((item) => (typeof item === "object" && item !== null && "name" in item ? String((item as { name: unknown }).name) : ""))
        .filter((nome) => nome.trim() !== "");
    return [options.request.text, ...doDesenvolvedor.map((answer) => answer.decision), ...daInfraestrutura];
  }

  /**
   * O plano não devolve por teste (§129).
   *
   * O achado cuja correção prescrevia trabalho de teste voltava ao escritor
   * com a correção da regra (§122) — e a correção da regra, até a §128, era
   * "mova o requisito para um critério". No Parallel Lab com a 0.7.2 a rodada
   * 2 teve nove achados e seis eram de teste: três tasks de teste a tirar, e a
   * fase 3 reprovada duas vezes por NÃO trazer "o módulo tem testes
   * automatizados próprios". A triagem manteve os seis, citando a regra. O
   * desenvolvedor decidiu: o que o pedido diz sobre testes é executado pelo
   * build, e nenhuma leitura do plan devolve, pergunta ou pede teste.
   *
   * O texto que esta auditoria leu já passou pela I-16, que conta o teste
   * dentro do plano antes de qualquer modelo. Um achado SOBRE teste que pede
   * para tirar o teste que está no texto — a prosa que a I-16 não conta —
   * cumpre a regra e fica, com a correção da regra: tirar, nunca mover para
   * outro lugar do plano. O que pede teste, ou reprova pela falta dele, sai
   * inteiro, com as ressalvas e as decisões do mesmo assunto — a ressalva de
   * hoje é o "achados anteriores" do prompt de amanhã. O achado de outro
   * assunto cuja correção sugere um teste fica, com a correção trocada.
   * Quando nada mais sobra, a devolução não tem motivo: aprovada.
   */
  async function semPedidoDeTeste(subject: string, verdict: AuditVerdict, attempt: number): Promise<AuditVerdict> {
    const filtrado = tirarPedidoDeTeste(verdict, autoridadeDeTeste());
    const tirados = filtrado.descartados.length;
    if (tirados > 0) {
      announce(`  ${tirados} apontamento(s) de ${subject} pediam ou julgavam teste (${filtrado.descartados.join("; ")}); o plano não devolve por teste — o build executa o que o pedido diz sobre testes`);
      await event("audit", subject, "complete", `${tirados} apontamento(s) sobre teste descartado(s) (§129)`, attempt);
    }
    if (filtrado.corrigidos > 0) announce(`  ${filtrado.corrigidos} achado(s) de ${subject} traziam teste na correção; a correção fica só no produto, sem teste no lugar`);
    return filtrado.verdict;
  }

  /**
   * A independência que existe é dita (§122): quando o papel que valida e o
   * que reparou rodam no mesmo provider e modelo, a separação é só de sessão.
   */
  function anunciarIndependencia(valida: string, reparou: string): void {
    const papeis = options.roles ?? {};
    const a = papeis[valida];
    const b = papeis[reparou];
    if (!a || !b) return;
    if (a.provider === b.provider && a.model === b.model) {
      announce(`  a independência entre ${valida} e ${reparou} é só de sessão: os dois rodam em ${a.provider}/${a.model}`);
    }
  }

  /**
   * As estratégias tentadas por documento (§121): o diagnóstico de um bloqueio
   * diz o que ficou aberto e o que foi tentado, nunca só "tentativas esgotadas".
   */
  function registrarEstrategia(document: string, estrategia: string): void {
    const lista = estrategias.get(document) ?? [];
    lista.push(estrategia);
    estrategias.set(document, lista);
  }
  function diagnostico(document: string, problema: string[], retomada: string): string {
    const tentadas = estrategias.get(document) ?? [];
    return [
      ...problema,
      "",
      "Estratégias tentadas, nesta ordem:",
      ...(tentadas.length > 0 ? tentadas.map((estrategia, index) => `  ${index + 1}. ${estrategia}`) : ["  (nenhuma recuperação se aplicava)"]),
      "",
      retomada,
    ].join("\n");
  }

  function coberturaAtual(): CoverageSources {
    return skeletonAtual ? coverageFromSkeleton(skeletonAtual) : { storyIds: [], entities: [], workflows: [] };
  }

  /**
   * Junta perguntas e respostas ao handoff do documento, sem perder o que já havia.
   *
   * Os ids ficam locais ao documento, que é como a retomada os lê; o escopo por
   * etapa é acrescentado só na agregação em memória.
   */
  async function persistAnswers(document: string, questions: readonly Question[], answers: readonly Answer[]): Promise<void> {
    const anterior = await readHandoff(options.projectRoot, runId, document);
    const conhecidas = new Set((anterior?.questions ?? []).map((question) => question.id));

    await writeHandoff(options.projectRoot, {
      contract: "capivara-handoff/v1",
      runId,
      language: options.language,
      document,
      round: anterior?.round ?? 1,
      questions: [...(anterior?.questions ?? []), ...questions.filter((question) => !conhecidas.has(question.id))],
      answers: [...(anterior?.answers ?? []), ...answers],
      assumptions: anterior?.assumptions ?? [],
      updatedAt: now().toISOString(),
    });
  }

  /**
   * O que já foi perguntado neste run, com as palavras do desenvolvedor.
   *
   * Na cadeia em prosa isto era filtrado por documento, porque cada documento
   * tinha a sua entrevista. Aqui há uma só, e o que a rodada de gaps não pode
   * fazer é reabrir o que ela fechou: no piloto 3 a rodada recomendou o
   * contrário do que o desenvolvedor tinha acabado de decidir.
   */
  function perguntadas(): AskedQuestion[] {
    return allAnswers.map((answer) => {
      const pergunta = allQuestions.find((entry) => entry.id === answer.questionId);
      return {
        decision: pergunta?.decision ?? answer.questionId,
        disposition: answer.disposition,
        answer: answer.raw,
      };
    });
  }

  /**
   * A entrevista do `plan`: o que só a escrita da fase descobriu que falta.
   *
   * A entrevista do `init` pergunta sobre o produto, antes de existir plano. Ela
   * não alcança o que só aparece ao detalhar uma fase — e sem este caminho de
   * volta um `[NEEDS DECISION]` viraria bloqueio no fim do run, com o
   * desenvolvedor descobrindo tarde algo que responderia em dez segundos.
   */
  /**
   * A INSISTÊNCIA: nenhuma decisão material termina o run sem ter sido perguntada.
   *
   * Isto era `reabrirDecisoes`, e só rodava dentro do laço de auditoria — ou seja,
   * só no `plan`, e só quando o auditor esbarrava em algo. O `init` terminava em
   * NOT READY com "nenhuma decisão material segue em aberto ✗" e uma lista de
   * decisões que ninguém tinha reperguntado nem uma vez, com o desenvolvedor
   * sentado no terminal.
   *
   * Agora é chamada em todos os pontos onde uma decisão aberta ainda pode mudar
   * algo: depois da entrevista do esqueleto, antes de detalhar as fases, dentro da
   * auditoria e antes do gate. Uma vez por decisão no run — o que não se repete é
   * a pergunta, não a insistência.
   *
   * E a pergunta agora TEM COMO SER RESPONDIDA por quem não sabe a resposta:
   * `perguntaInsistente` acrescenta delegar e tirar do escopo às opções originais.
   * É isso que faz o laço terminar sem abandonar nada — antes, reperguntar o que
   * já não tinha resposta era só uma forma mais lenta de chegar ao mesmo NOT READY.
   */
  async function insistirNasDecisoes(
    document: string,
    attempt: number,
    /**
     * De onde se está insistindo.
     *
     * A marca é o par decisão+lugar, e não a decisão sozinha. Uma decisão é
     * perguntada uma vez por MOMENTO em que ela volta a fazer diferença — antes do
     * esqueleto, antes das fases, quando o auditor esbarra nela, e antes do gate.
     * Marcá-la só pelo id fazia a primeira insistência calar todas as outras: o
     * desenvolvedor deixava em aberto no começo do `plan`, o auditor devolvia a
     * fase por causa dela dezesseis fases depois, e ninguém era perguntado — o
     * mesmo defeito que a insistência existe para corrigir, um nível acima.
     *
     * O número de perguntas por decisão continua finito, porque os lugares são
     * quatro e cada um pergunta uma vez.
     */
    motivo: string,
    writer?: WriterContext,
  ): Promise<Finding[]> {
    const abertas = unresolved({
      round: maxInterviewRounds,
      questions: allQuestions,
      answers: allAnswers,
      assumptions: [],
      maxRounds: maxInterviewRounds,
    }).filter((item) => !insistidas.has(`${motivo}::${item.questionId}`));

    if (abertas.length === 0) return [];

    announce(`  ${abertas.length} decisão(ões) seguem em aberto (${motivo}); não vou fechar o run sem perguntar de novo`);
    const decididas: Finding[] = [];

    for (const [indice, item] of abertas.entries()) {
      insistidas.add(`${motivo}::${item.questionId}`);
      const original = allQuestions.find((entry) => entry.id === item.questionId);
      if (!original) continue;

      const pergunta = perguntaInsistente(original, item.statement);
      const raw = await perguntar(pergunta, indice + 1, abertas.length);
      let resposta = await settle(document, pergunta, raw, attempt, indice + 1, abertas.length);

      /*
       * A terceira apresentação diz o que fecha.
       *
       * `settle` já repergunta uma vez quando a resposta não fecha a decisão. Se
       * depois disso ela continuar aberta, o que falta não é insistir de novo com
       * as mesmas palavras: é dizer que existe um número que encerra a pergunta.
       */
      if (resposta.disposition !== "ACCEPTED") {
        announce("  esta decisão não pode ficar aberta: escolha um número — as duas últimas opções fecham a pergunta sem você precisar da resposta.");
        resposta = await settle(document, pergunta, await perguntar(pergunta, indice + 1, abertas.length), attempt, indice + 1, abertas.length);
      }

      resposta = aplicarInsistencia(pergunta, resposta);
      allAnswers.push({ ...resposta, questionId: item.questionId });
      await persistAnswers(document, [original], [{ ...resposta, questionId: original.id }]);

      if (resposta.disposition !== "ACCEPTED") continue;
      decididas.push({
        where: original.topic,
        problem: `a decisão "${original.decision}" estava em aberto`,
        fix: `o desenvolvedor decidiu, e esta decisão é a autoridade: ${resposta.decision}`,
      });
    }

    if (decididas.length > 0) {
      // O escritor passa a ver as decisões novas na próxima chamada dele.
      if (writer) {
        writer.decisions = allAnswers.filter((answer) => answer.disposition === "ACCEPTED").map((answer) => answer.decision);
      }
      announce(`  ${decididas.length} decisão(ões) fechada(s); elas passam a valer como autoridade`);
    }
    return decididas;
  }

  /**
   * Uma pergunta respondida, gravada e contabilizada.
   *
   * Os três caminhos que perguntam ao desenvolvedor — lacuna, insistência e
   * decisão do auditor — faziam isto com o mesmo código copiado, e a cópia já
   * divergiu uma vez. Aqui é um lugar só: pergunta, classifica, grava no handoff,
   * atualiza o contexto do escritor.
   */
  async function perguntarEGravar(
    document: string,
    pergunta: Question,
    indice: number,
    total: number,
    attempt: number,
    escopo: string,
    writer?: WriterContext,
  ): Promise<Answer> {
    const raw = await perguntar(pergunta, indice, total);
    const resposta = await settle(document, pergunta, raw, attempt, indice, total);

    const id = escopo === "" ? pergunta.id : scoped(document, pergunta.id, escopo);
    allQuestions.push({ ...pergunta, id });
    allAnswers.push({ ...resposta, questionId: id });
    await persistAnswers(document, [pergunta], [resposta]);

    if (writer) {
      writer.decisions = allAnswers.filter((answer) => answer.disposition === "ACCEPTED").map((answer) => answer.decision);
    }
    return resposta;
  }

  /**
   * A decisão que o desenvolvedor delegou, ou tirou do escopo.
   *
   * Devolve o texto que fica valendo, já no formato que o escritor e o auditor
   * leem — e registra a suposição quando foi delegação, porque delegar não é
   * decidir e o relatório precisa dizer isso.
   */
  function aplicarInsistencia(pergunta: Question, resposta: Answer): Answer {
    if (resposta.disposition !== "ACCEPTED") return resposta;

    const leitura = leituraInsistente(pergunta, resposta.decision);
    if (leitura.tipo === "decidida") return resposta;

    if (leitura.tipo === "delegada") {
      const suposicao = suposicaoDelegada(pergunta, leitura.decisao);
      if (!allAssumptions.some((entry) => entry.statement === suposicao.statement)) allAssumptions.push(suposicao);
      announce(`    ${pergunta.topic}: decidido pelo harness a seu pedido; está no relatório como suposição`);
    } else {
      announce(`    ${pergunta.topic}: fora do escopo; nenhuma fase implementa isto`);
    }

    return { ...resposta, decision: leitura.decisao };
  }

  /**
   * As decisões que o AUDITOR devolveu ao desenvolvedor.
   *
   * O caminho até quem decide existia e era caro: o levantamento só abre quando o
   * MESMO achado volta pela segunda vez, e o impasse só quando o teto estoura.
   * Entre a primeira leitura do auditor e a primeira pergunta havia sempre um
   * ciclo inteiro — escrever, auditar, reescrever, auditar — para chegar a uma
   * pergunta de dez segundos que ele já sabia fazer na primeira passada.
   *
   * Uma vez por decisão no run: o auditor é sem memória e levantaria a mesma de
   * novo, e reperguntar o que já foi decidido é como a autoridade do
   * desenvolvedor vira sugestão.
   */
  async function perguntarDecisoesDoAuditor(
    document: string,
    verdict: AuditVerdict,
    attempt: number,
    writer: WriterContext,
  ): Promise<Finding[]> {
    const novas = (verdict.decisions ?? []).filter(
      (decisao) => !decisoesDoAuditor.has(`${decisao.where}::${decisao.decision}`.toLowerCase()),
    );
    if (novas.length === 0) return [];

    const decididas: Finding[] = [];

    /*
     * Uma regra do harness não é decisão do desenvolvedor.
     *
     * No `teste_openrouter3` o auditor da fase 5 viu a contradição certa — a
     * task prescrevia "automação com Vitest e Playwright" e a regra do
     * planejamento proíbe prescrever teste — e a devolveu como CAPIVARA_DECISION
     * com duas leituras: manter a prescrição ou cumprir a regra. A primeira
     * virou "recomendada" por ter sido escrita primeiro, o desenvolvedor a
     * confirmou, e a partir daí toda auditoria exigiu a prescrição como decisão
     * confirmada. O auditor não tem autoridade para tornar opcional uma regra
     * obrigatória, e o desenvolvedor não é perguntado se quer suspendê-la: a
     * decisão vira o achado mecânico que ela já era, endereçado a quem escreve.
     * Desde a §129, a que só PEDE teste ("a fase deve ter os testes próprios do
     * módulo?") não é do plano e sai, sem pergunta e sem correção.
     *
     * A detecção é a mesma checagem determinística do contrato (I-16), sobre o
     * texto da decisão e das leituras, com a mesma autoridade: o que o pedido e
     * a entrevista nomeiam não é prescrição.
     */
    const autoridade = autoridadeDeTeste();
    const perguntaveis: typeof novas = [];
    for (const decisao of novas) {
      const termos = testPrescriptions([decisao.decision, ...decisao.options].join("\n"), autoridade);
      if (termos.length === 0) {
        /*
         * Uma escolha de engenharia não é decisão do desenvolvedor (§122).
         *
         * No `minimax` o auditor perguntou como o `rotas.ts` obtém a
         * instância `Database` e se o módulo escreve `router.get('/')` ou
         * `router.get('/tarefas')` — todas as leituras em forma de código, o
         * mesmo produto em qualquer uma. O plano decide: o achado leva as
         * leituras do auditor ao escritor, que escolhe a compatível com a
         * arquitetura e alinha as fases.
         */
        if (autoridadeDaDecisao(decisao) === "engenharia") {
          decisoesDoAuditor.add(`${decisao.where}::${decisao.decision}`.toLowerCase());
          announce(`  o auditor levantou como decisão uma escolha de engenharia (${decisao.where}); o plano decide, não você — vira correção ao escritor`);
          await event("audit", document, "retry", `decisão de engenharia devolvida ao escritor: ${decisao.where}`, attempt);
          decididas.push(decisaoDeEngenhariaComoFinding(decisao));
          continue;
        }
        perguntaveis.push(decisao);
        continue;
      }
      decisoesDoAuditor.add(`${decisao.where}::${decisao.decision}`.toLowerCase());
      // A decisão que só pede teste não é do plano (§129): sai, sem pergunta e sem correção.
      if (testToolPrescriptions([decisao.decision, ...decisao.options].join("\n"), autoridade).length === 0) {
        announce(`  o auditor levantou como decisão um pedido de teste (${decisao.where}); não há o que decidir no plano — o build executa o que o pedido diz sobre testes`);
        continue;
      }
      announce(`  o auditor levantou como decisão uma regra do planejamento (${decisao.where}: prescrição de teste); não há o que decidir — vira correção`);
      decididas.push({
        where: enderecoDaDecisao(decisao),
        mechanical: true,
        problem: `I-16: o auditor apontou prescrição de teste em ${decisao.where} (${termos.join(", ")}) e a levantou como decisão; a regra não é opcional`,
        fix: testPrescriptionHint(termos),
      });
    }
    if (perguntaveis.length === 0) return decididas;

    announce(`  o auditor levantou ${perguntaveis.length} decisão(ões) que ninguém na mesa pode tomar; perguntando a você`);

    for (const [indice, decisao] of perguntaveis.entries()) {
      decisoesDoAuditor.add(`${decisao.where}::${decisao.decision}`.toLowerCase());
      const pergunta = perguntaDoAuditor(decisao, decisoesDoAuditor.size);
      const resposta = await perguntarEGravar(document, pergunta, indice + 1, perguntaveis.length, attempt, "auditoria", writer);
      if (resposta.disposition !== "ACCEPTED") continue;
      decididas.push(decisaoDoAuditorComoFinding(decisao, resposta.decision));
    }

    return decididas;
  }

  /**
   * Em que fase vive este marcador.
   *
   * A decisão de uma lacuna volta ao escritor como achado, e um achado sem fase
   * manda a emenda para o lugar errado — ou, quando nenhum achado tem fase, para
   * TODAS elas, derrubando as aprovações já pagas. O harness sabe a resposta: basta
   * ver de qual fase é o texto que contém o marcador.
   */
  function faseDoMarcador(documento: string, marcador: string): number | undefined {
    /*
     * A primeira versão disto não funcionava NUNCA, e o defeito é exemplar.
     *
     * Ela tentava `parsePhases(documento)` para achar a fase que contém o
     * marcador — e o parser recusa qualquer documento COM marcador, que é
     * justamente o único caso em que esta função é chamada (I-13). Caía no ramo
     * das fases já limpas, cujo texto não contém o marcador, e devolvia
     * `undefined` em todas as vezes. Sem fase, `affectedPhases` usa o fallback de
     * "todas", a emenda reescreve as treze, o sha de cada uma muda e TODA
     * aprovação cai. Medido no `assistencia2`: a tentativa 3 aprovou 10 fases e a
     * tentativa 4 reauditou 12.
     *
     * A estrutura vem do documento sem marcadores; a POSIÇÃO vem do documento
     * cru. O cabeçalho de cada fase é usado como texto literal — não há regex de
     * fase aqui, ela continua sendo do contrato —, e vale a última fase que
     * começa antes do marcador.
     */
    const lido = parsePhases(stripAllMarkers(documento).content);
    if (!lido.ok) return undefined;

    const ondeEstaOMarcador = documento.indexOf(marcador);
    if (ondeEstaOMarcador < 0) return undefined;

    let escolhida: number | undefined;
    for (const fase of lido.document.phases) {
      const cabecalho = fase.markdown.split("\n")[0] ?? "";
      const inicio = cabecalho === "" ? -1 : documento.indexOf(cabecalho);
      if (inicio >= 0 && inicio < ondeEstaOMarcador) escolhida = fase.number;
    }
    return escolhida;
  }

  /**
   * Em que fase está esta linha do documento montado.
   *
   * O heading de cada fase é texto literal do contrato (`phaseHeading`), não
   * regex: vale a última fase cujo heading começa antes do fim da linha.
   */
  function faseDaLinha(documento: string, linha: number, total: number): number | undefined {
    if (linha <= 0 || total <= 0) return undefined;
    const fim = documento.split("\n").slice(0, linha).join("\n").length;
    let escolhida: number | undefined;
    for (let numero = 1; numero <= total; numero += 1) {
      const inicio = documento.indexOf(phaseHeading(numero));
      if (inicio >= 0 && inicio <= fim) escolhida = numero;
    }
    return escolhida;
  }

  /**
   * O achado mecânico com ENDEREÇO de task (§124).
   *
   * `Phase N · linha L` localizava a fase e nada mais: a emenda chegava sem
   * `P<n>.T<m>`, `preserveUnaddressedTasks` devolvia a reescrita inteira e as
   * tasks vizinhas perdiam os bytes — e a aprovação — sem nenhum achado
   * pedir. Com o endereço, só a task em conflito muda; as outras voltam
   * byte a byte, que é o que a emenda promete.
   */
  function achadoMecanico(documento: PhasesDocument, texto: string, erro: ContractError, total: number): Finding {
    const fase = faseDaLinha(texto, erro.line, total);
    const task = fase === undefined ? undefined : documento.phases.find((phase) => phase.number === fase)?.tasks.find((candidata) => candidata.line === erro.line);
    const endereco = fase === undefined ? `linha ${erro.line}` : task === undefined ? `Phase ${fase} · linha ${erro.line}` : `P${fase}.T${task.index} · linha ${erro.line}`;
    return {
      where: endereco,
      mechanical: true,
      problem: `${erro.code}: ${erro.message}`,
      fix: erro.hint,
      ...(fase === undefined ? {} : { phase: fase }),
    };
  }

  /** Marca como fechados os marcadores cuja pergunta já tem resposta aceita. */
  function registrarLacunasFechadas(): void {
    const aceitas = new Set(
      allAnswers.filter((answer) => answer.disposition === "ACCEPTED").map((answer) => answer.questionId),
    );
    for (const [questionId, marcador] of marcadorDaPergunta) {
      if (aceitas.has(questionId)) lacunasDecididas.add(marcador.toLowerCase());
    }
  }

  async function closeGaps(document: string, initial: Authored, writer: WriterContext): Promise<Authored> {
    let authored = initial;
    const asked = lacunasPerguntadas;

    /*
     * Enquanto houver marcador não perguntado, pergunta-se.
     *
     * O teto era de seis rodadas de cinco perguntas: trinta decisões, e tudo o
     * que passasse disso virava `[NEEDS DECISION]` no plano e NOT READY no gate.
     * Num produto de dezesseis fases isso não é hipótese — o `assitencia`
     * produziu quatorze marcadores de uma vez.
     *
     * O laço termina porque cada marcador entra em `asked` ANTES de ser
     * perguntado: um marcador é perguntado uma vez, e a lista de marcadores
     * distintos é finita. Uma reescrita que cria marcador novo faz o laço seguir
     * — e isso é o comportamento certo, não um risco: marcador novo é decisão
     * nova, e ela também precisa ser ouvida.
     *
     * `maxGapQuestions` continua existindo e vale por RODADA: ele não fecha mais
     * nenhuma porta, só decide quantas perguntas vão juntas na mesma tela.
     *
     * A condição de saída é NÃO HAVER MARCADOR — e não "não haver marcador novo",
     * que era o buraco da primeira versão disto. Um marcador perguntado,
     * respondido e que o escritor não apagou ficava invisível: `asked` guarda o
     * texto, o filtro o tirava da fila, a função devolvia o documento com ele
     * dentro, e o `temDecisaoPendente` da auditoria chamava de novo para receber a
     * mesma resposta calada. No `assistencia2` foram onze marcadores sobrevivendo
     * a duas rodadas, e eles levaram junto a auditoria por fase inteira.
     *
     * Então cada volta faz três coisas, nesta ordem: apaga o que já foi decidido,
     * pergunta o que nunca foi perguntado, e insiste no que foi perguntado e
     * ficou em aberto. Só quando nada disso tem o que fazer é que se devolve o
     * documento.
     *
     * A parada de segurança abaixo não é um teto de entrevista disfarçado. Ela
     * existe porque um escritor que inventasse um marcador NOVO a cada reescrita
     * faria o laço perguntar para sempre — e perguntar para sempre é pior que o
     * gate recusar, porque não termina. O número é grande de propósito: o maior
     * run real produziu quatorze marcadores, e nenhum projeto honesto chega perto
     * disto. Se chegar, o problema não é a entrevista.
     */
    const PARADA_DE_SEGURANCA = 200;
    for (let round = 1; ; round += 1) {
      if (asked.size >= PARADA_DE_SEGURANCA) {
        announce(
          `  ${asked.size} decisões pendentes já foram perguntadas neste documento e o escritor continua abrindo novas; ` +
            "isto não é falta de entrevista, é o plano não convergindo — o gate vai dizer o que sobrou",
        );
        await event("interview", document, "blocked", `parada de segurança em ${asked.size} lacunas`, round);
        return authored;
      }

      // Marcadores idênticos são UMA decisão, não uma por ocorrência: no piloto 1
      // o mesmo marcador apareceu 27 vezes e virou 27 perguntas iguais.
      const presentes = [
        ...new Set(
          [...authored.content.matchAll(/\[NEEDS DECISION\]\s*(.+)/g)]
            .map((match) => (match[1] ?? "").trim())
            .filter((marker) => marker !== ""),
        ),
      ];
      if (presentes.length === 0) return authored;

      /*
       * Primeiro: apagar o que JÁ foi decidido e o escritor não apagou.
       *
       * Mecânico, e por isso feito aqui e não pedido a ninguém: a pendência
       * deixou de existir, a decisão está no relatório e nas fontes do escritor.
       */
      const jaDecididos = presentes.filter((marker) => lacunasDecididas.has(marker.toLowerCase()));
      if (jaDecididos.length > 0) {
        const limpo = stripResolvedMarkers(authored.content, jaDecididos);
        if (limpo.applied.length > 0) {
          for (const fix of limpo.applied) announce(`    ${fix}`);
          authored = { content: limpo.content, rewrite: authored.rewrite };
          continue;
        }
      }

      /*
       * O marcador que pede uma decisão de engenharia volta ao escritor (§122).
       *
       * Ele escreve "[NEEDS DECISION] o `rotas.ts` exporta `prefixo` ou a
       * fundação deriva do diretório?" e isso é dele mesmo: o plano decide
       * assinatura, exportação e registro, lendo a arquitetura. Uma vez; se o
       * marcador voltar, a pendência é preservada e o desenvolvedor a lê —
       * na dúvida, ninguém inventa a decisão por ele.
       */
      const deEngenharia = presentes.filter(
        (marker) => !asked.has(marker.toLowerCase()) && !marcadoresDevolvidos.has(marker.toLowerCase()) && sinaisDeEngenharia(marker).length > 0,
      );
      if (deEngenharia.length > 0) {
        for (const marker of deEngenharia) marcadoresDevolvidos.add(marker.toLowerCase());
        announce(`  ${deEngenharia.length} marcador(es) pedem decisão de engenharia; o plano decide, não você — devolvendo ao escritor`);
        await event("interview", document, "retry", `${deEngenharia.length} marcador(es) de engenharia devolvidos ao escritor`, round);
        authored = await authored.rewrite(
          deEngenharia.map((marker) => ({
            where: document,
            problem: `o marcador "[NEEDS DECISION] ${marker}" pede uma decisão de engenharia, que é do plano, não do desenvolvedor`,
            fix: `decida: escolha a leitura compatível com a arquitetura e com o contrato da fase que o fixa, aplique-a e remova o marcador\n${NOTA_DE_ENGENHARIA}`,
          })),
          round,
        );
        continue;
      }

      const markers = presentes.filter((marker) => !asked.has(marker.toLowerCase())).slice(0, maxGapQuestions);

      /*
       * Marcador perguntado que continua aberto é decisão que o desenvolvedor não
       * fechou — e isso tem um caminho próprio, com as duas saídas que fecham
       * qualquer pergunta. Sem isto, o laço não tinha mais o que fazer e devolvia
       * o documento marcado, que é como onze marcadores chegaram à auditoria.
       */
      if (markers.length === 0) {
        const fechadas = await insistirNasDecisoes(document, round, "marcador pendente no plano", writer);
        registrarLacunasFechadas();
        const resolvidosAgora = presentes.filter((marker) => lacunasDecididas.has(marker.toLowerCase()));
        if (fechadas.length === 0 && resolvidosAgora.length === 0) {
          announce(
            `  ${presentes.length} marcador(es) seguem no plano e ninguém os fechou; eles param a prontidão, e o relatório diz quais`,
          );
          await event("interview", document, "blocked", `${presentes.length} marcador(es) sem decisão`, round);
          return authored;
        }
        authored = await authored.rewrite(fechadas, round);
        continue;
      }

      for (const marker of markers) asked.add(marker.toLowerCase());

      announce(`  ${markers.length} decisão(ões) pendente(s) nas fases; reabrindo a entrevista`);
      await event("interview", document, "retry", `${markers.length} gap(s) descobertos na escrita`, round);

      const base = gapPrompt(document, writer, markers, perguntadas());
      let batch = parseQuestionBatch(
        await track({ role: "writer", stage: "interview", subject: `${document}:gaps`, attempt: round, prompt: base }),
      );

      /*
       * Lote malformado repete UMA vez, com os defeitos nomeados — e nunca sai
       * calado.
       *
       * Aqui estava um `return authored` mudo: se o levantamento das perguntas
       * voltasse torto, a rodada inteira era abandonada sem uma linha na tela, e
       * os marcadores seguiam para a auditoria como I-13 — um achado que o
       * escritor não pode fechar, porque quem resolve a decisão é o
       * desenvolvedor. No `assitencia` isso custou o run: quatorze marcadores
       * chegaram ao auditor e as três devoluções foram gastas neles.
       */
      if (!batch.ok) {
        announce(`  o levantamento das perguntas de lacuna veio malformado; pedindo de novo com os defeitos nomeados`);
        batch = parseQuestionBatch(
          await track({
            role: "writer",
            stage: "interview",
            subject: `${document}:gaps`,
            attempt: round,
            prompt: [
              base,
              "",
              "## Your previous answer was rejected before it reached the developer",
              ...batch.defects.map((defeito) => `- ${defeito.questionId}: ${defeito.problem} — ${defeito.hint}`),
              "",
              "Emit the whole batch again, complete. One question per open decision above.",
            ].join("\n"),
          }),
        );
      }

      /*
       * Lote recusado ainda pode ter pergunta boa dentro, e na rodada de lacunas
       * cada pergunta é uma decisão específica. No `assitencia`, oito perguntas
       * perfeitas foram jogadas fora porque três vieram tortas — e as oito
       * decisões ficaram sem ser feitas.
       */
      if (!batch.ok && batch.questions.length > 0) {
        announce(
          `  ${batch.defects.length} pergunta(s) vieram malformadas e ficaram de fora; sigo com as ${batch.questions.length} que estão boas`,
        );
      }

      /*
       * Sem pergunta do escritor, a pergunta é do harness.
       *
       * Aqui havia um `return authored`: os marcadores seguiam para o gate como
       * decisões que ninguém ouviu. No `assitencia` isso publicou NOT READY com
       * "3 gap(s) sem pergunta" — e as três eram respondíveis em uma linha cada.
       *
       * O escritor é quem sabe as alternativas, então ele é sempre tentado
       * primeiro. Quando o lote dele não vem, o harness faz a pergunta que sabe
       * fazer: o marcador inteiro na tela, e as duas saídas que fecham qualquer
       * decisão — delegar ou tirar do escopo.
       */
      const perguntas =
        batch.questions.length > 0
          ? batch.questions
          : markers.map((marker, posicao) => perguntaDeLacuna(marker, asked.size * 10 + posicao));

      if (batch.questions.length === 0) {
        announce(`  ninguém conseguiu transformar ${markers.length} decisão(ões) pendente(s) em pergunta; vou perguntar do jeito que sei`);
        await event("interview", document, "retry", `${markers.length} gap(s) perguntados pelo harness`, round);
      }

      const answered: Answer[] = [];
      let index = 0;
      for (const question of perguntas) {
        index += 1;
        const raw = await perguntar(question, index, perguntas.length);
        const resposta = await settle(document, question, raw, round, index, perguntas.length);
        answered.push(aplicarInsistencia(question, resposta));
      }

      // Escopo próprio: as perguntas de gap reusam Q-01, Q-02… e sobrescreveriam
      // as respostas da entrevista do esqueleto.
      const escopo = `gap${round}`;
      allQuestions.push(...perguntas.map((question) => ({ ...question, id: scoped(document, question.id, escopo) })));
      allAnswers.push(...answered.map((answer) => ({ ...answer, questionId: scoped(document, answer.questionId, escopo) })));

      /*
       * Qual pergunta veio de qual marcador.
       *
       * É o que permite, depois, apagar o marcador certo — e reconhecer que uma
       * decisão fechada pela INSISTÊNCIA, rodadas mais tarde, fechou aquele
       * marcador. Sem esse vínculo, a resposta existia e o marcador ficava.
       */
      perguntas.forEach((question, posicao) => {
        const marcador = markers[posicao];
        if (marcador !== undefined) marcadorDaPergunta.set(scoped(document, question.id, escopo), marcador);
      });

      // Decisão tomada aqui precisa sobreviver ao processo: sem isto, o run
      // seguinte pergunta a mesma coisa porque a retomada não a encontra.
      /*
       * Com o id ESCOPADO, e não o local.
       *
       * Cada rodada de lacuna recomeça em `Q-01`, e `persistAnswers` descarta a
       * pergunta cujo id já existe no handoff — mas guarda a resposta. No
       * `assistencia2` a resposta da rodada 2 ("uma tarefa única para clientes e
       * equipamentos") ficou pendurada na pergunta da rodada 1 ("Vencimento da
       * recorrência"): o relatório mostrou a decisão sob o tópico errado, e a
       * retomada do §76.4 entregou ao escritor um par pergunta-resposta sem
       * sentido. Os outros cinco chamadores já gravam ids únicos; este era o único.
       */
      await persistAnswers(
        document,
        perguntas.map((question) => ({ ...question, id: scoped(document, question.id, escopo) })),
        answered.map((answer) => ({ ...answer, questionId: scoped(document, answer.questionId, escopo) })),
      );

      const accepted = answered.filter((answer) => answer.disposition === "ACCEPTED");
      /*
       * Ninguém fechou nada nesta rodada: não se reescreve, e TAMBÉM não se
       * desiste. Os marcadores desta rodada já foram perguntados, e os próximos
       * — se houver — são de outras decisões, que merecem a vez delas.
       */
      if (accepted.length === 0) {
        announce("  nenhuma das decisões desta rodada foi fechada; sigo com as que faltam");
        continue;
      }

      writer.decisions = allAnswers.filter((answer) => answer.disposition === "ACCEPTED").map((answer) => answer.decision);

      registrarLacunasFechadas();
      const resolvidos = accepted
        .map((answer) => markers[perguntas.findIndex((entry) => entry.id === answer.questionId)] ?? "")
        .filter((marker) => marker !== "");

      authored = await authored.rewrite(
        accepted.map((answer) => {
          const posicao = perguntas.findIndex((entry) => entry.id === answer.questionId);
          const question = perguntas[posicao];
          const marcador = markers[posicao];
          const fase = marcador === undefined ? undefined : faseDoMarcador(authored.content, marcador);
          return {
            where: question?.topic ?? document,
            problem: `a decisão "${question?.decision ?? answer.questionId}" estava marcada como pendente`,
            fix: `o desenvolvedor decidiu: ${answer.decision}. Escreva isso e remova o marcador [NEEDS DECISION] correspondente`,
            ...(fase !== undefined ? { phase: fase } : {}),
          };
        }),
        round,
        // A decisão de uma lacuna vive numa fase só. Sem saber qual, é melhor não
        // reescrever nada do que reescrever o plano inteiro e derrubar aprovações.
        { somenteNomeadas: true },
      );

      // O escritor deveria ter apagado o marcador; quando não apaga, o marcador
      // bloquearia o gate por uma decisão que já existe. Isso é mecânico.
      const limpo = stripResolvedMarkers(authored.content, resolvidos);
      if (limpo.applied.length > 0) {
        for (const fix of limpo.applied) announce(`    ${fix}`);
        authored = { content: limpo.content, rewrite: authored.rewrite };
      }
    }
  }

  /**
   * A conferência mecânica do plano, antes de qualquer modelo.
   *
   * Contável é conferido em código: referência de design morta, cobertura,
   * prescrição de teste (I-16), escrita concorrente (I-18), tetos de tamanho e o
   * contrato. Cada defeito volta à fase em que está; nenhum gasta auditor.
   */
  function autoconferencia(content: string): AuditVerdict | null {
    const parsed = parsePhases(content);

    /*
     * Referência de design morta tem o mesmo destino da cobertura: conferida
     * só no gate, custa o run; conferida aqui, custa uma devolução.
     */
    if (parsed.ok) {
      const mortas = checkDesignRefs(parsed.document, artifactPaths(options.projectRoot).design, (caminho) =>
        existsSync(caminho),
      );
      if (mortas.length > 0) {
        return {
          status: "REJECTED",
          findings: mortas.map((erro) => ({ where: "Design ref", problem: erro.message, fix: erro.hint })),
          remarks: [],
          reason: "há referência de design que não existe em disco",
          mechanical: true,
        };
      }
    }

    /*
     * Cobertura é mecânica e era conferida SÓ no gate final. O piloto 3 gastou
     * três horas para terminar em NOT READY porque nenhuma task citava
     * `workflow <n>` — o modelo traduziu o rótulo junto com a prosa. Conferida
     * aqui, a mesma falha vira uma devolução dentro do ciclo que já existe.
     */
    if (parsed.ok) {
      const semCobertura = checkCoverage(parsed.document, coberturaAtual());
      if (semCobertura.length > 0) {
        return {
          status: "REJECTED",
          findings: achadosDeCobertura(parsed.document),
          remarks: [],
          reason: "há item do esqueleto que nenhuma task rastreia",
          mechanical: true,
        };
      }
    }

    /*
     * Prescrição de teste é contável (I-16) e era descoberta pelo auditor —
     * que, no `teste_openrouter3`, a transformou numa pergunta ao
     * desenvolvedor sobre se a regra valia. Conferida aqui, vira uma emenda
     * mecânica na task certa, sem gastar auditor nem pedir licença para
     * cumprir a regra. O que o pedido e a entrevista autorizam não conta.
     */
    if (parsed.ok) {
      const prescritos = checkTestPrescription(parsed.document, autoridadeDeTeste());
      if (prescritos.length > 0) {
        const total = skeletonAtual?.phases.length ?? 0;
        return {
          status: "REJECTED",
          findings: prescritos.map((erro) => achadoMecanico(parsed.document, content, erro, total)),
          remarks: [],
          reason: "há task que prescreve teste, e como provar o produto é decisão do build",
          mechanical: true,
        };
      }
    }

    /*
     * Propriedade de escrita (I-18, §124): fases sem dependência entre si
     * com obrigação de escrita no mesmo arquivo. É a metade irmã, no nível
     * das fases, da serialização por componente que a arquitetura faz
     * (§119). No `haiku` o auditor de coerência apontou três rodadas
     * seguidas que as fases 3 a 6 mandavam acrescentar em `modulos.ts` e
     * `navegacao.ts` as entradas que a fundação já entregava, e a triagem
     * descartou três vezes porque "existe uma implementação que evita o
     * conflito". Contável, conferido aqui: vira emenda mecânica na fase que
     * escreve, com o dono do arquivo nomeado, sem auditor, sem triagem e sem
     * pergunta ao desenvolvedor — e sem inventar dependência, que é da
     * arquitetura.
     */
    if (parsed.ok) {
      const conflitos = checkWriteOwnership(parsed.document, { components: arquiteturaAtual?.components ?? [] });
      if (conflitos.length > 0) {
        const total = skeletonAtual?.phases.length ?? 0;
        return {
          status: "REJECTED",
          findings: conflitos.map((erro) => achadoMecanico(parsed.document, content, erro, total)),
          remarks: [],
          reason: "há fases sem ordem entre si com obrigação de escrita no mesmo arquivo, e o build as executa ao mesmo tempo",
          mechanical: true,
        };
      }
    }

    /*
     * Task inchada é o defeito de origem: o piloto 3 saiu com 4,3 critérios por
     * task contra 2,1 a 2,5 dos três planos que construíram. Cortado aqui, o
     * teto por fase vira consequência — 15 tasks de até 4 critérios fecham em 60.
     */
    if (parsed.ok) {
      const inchadas = parsed.document.phases.flatMap((phase) =>
        phase.tasks
          .filter((task) => task.acceptanceCriteria.length > MAX_CRITERIA_PER_TASK)
          .map((task) => ({ phase: phase.number, task, tasksNaFase: phase.tasks.length })),
      );
      if (inchadas.length > 0) {
        return {
          status: "REJECTED",
          findings: inchadas.map(({ phase, task, tasksNaFase }) => ({
            where: `Phase ${phase} · ${task.title}`,
            mechanical: true,
            problem: `a task declara ${task.acceptanceCriteria.length} critérios de aceite`,
            /*
             * Os dois tetos, sempre juntos.
             *
             * Este texto mandava só dividir, e o do tamanho da fase mandava só
             * consolidar. No `assitencia` isso virou um pêndulo com nome e
             * horário: 00:01 "a task declara 5 critérios" → divide → 00:26 "a
             * fase declara 16 tasks" → consolida → 00:23 "a task declara 5
             * critérios". Cada correção obedecia a um teto e quebrava o outro,
             * porque cada uma só sabia do seu.
             */
            /*
             * Consolidar antes de dividir (etapa 3 da redução): dividir uma task de
             * três critérios em duas mantém os três e só acrescenta uma task. O
             * teto existe para haver menos obrigação a conferir pelo mesmo produto.
             */
            fix:
              `uma task tem no máximo ${MAX_CRITERIA_PER_TASK} critérios: junte num só os critérios que provam o mesmo comportamento` +
              ` e tire o que repete o esqueleto ou outra task; só se sobrarem mais de ${MAX_CRITERIA_PER_TASK} comportamentos distintos,` +
              ` divida a task. Nenhuma condição do produto pode desaparecer.` +
              ` E a fase inteira não pode passar de ${MAX_TASKS_PER_PHASE} tasks — ela tem ${tasksNaFase} agora: se a divisão` +
              ` estourar esse teto, consolide outras tasks desta fase NA MESMA REESCRITA, até a fase caber nos dois limites` +
              ` ao mesmo tempo. Uma correção que respeita um teto e quebra o outro volta para cá`,
          })),
          remarks: [],
          reason: "há task fazendo mais de uma coisa",
          mechanical: true,
        };
      }
    }

    // Dimensionamento é contável, então é contado aqui e não descoberto pelo
    // auditor três devoluções depois: uma fase é uma sessão de agente.
    if (parsed.ok) {
      const criterios = (phase: (typeof parsed.document.phases)[number]): number =>
        phase.tasks.reduce((total, task) => total + task.acceptanceCriteria.length, 0);

      const grandes = parsed.document.phases.filter(
        (phase) => phase.tasks.length > MAX_TASKS_PER_PHASE || criterios(phase) > MAX_CRITERIA_PER_PHASE,
      );
      if (grandes.length > 0) {
        return {
          status: "REJECTED",
          findings: grandes.map((phase) => ({
            where: `Phase ${phase.number}`,
            mechanical: true,
            problem:
              phase.tasks.length > MAX_TASKS_PER_PHASE
                ? `a fase declara ${phase.tasks.length} tasks e uma fase é uma sessão de agente`
                : `a fase declara ${criterios(phase)} critérios de aceite em ${phase.tasks.length} tasks, e uma fase é uma sessão de agente`,
            fix:
              phase.tasks.length > MAX_TASKS_PER_PHASE
                ? /*
                   * Consolidar, nunca dividir.
                   *
                   * Este texto dizia "divida em mais fases de topo" — e quem o
                   * recebe escreve UMA fase, cujo número, título e cobertura
                   * vêm do esqueleto e são montados em código. Criar fase não
                   * é uma jogada que ele tenha. No `assitencia` a fase 18
                   * voltou cinco vezes fechando tudo o que era possível
                   * fechar, e o run parou num impasse sobre a única correção
                   * que ninguém ali podia fazer.
                   *
                   * A instrução certa já existia na linha de baixo, para os
                   * critérios, escrita depois de a mesma lição ser aprendida.
                   * Ficou ali sozinha.
                   */
                  `consolide as tasks desta fase até ela caber em ${MAX_TASKS_PER_PHASE}: duas tasks que entregam a mesma` +
                  ` capacidade viram uma. Nada verificável pode desaparecer — se depois de consolidar ainda não couber, diga` +
                  ` isso em vez de apagar trabalho. Reescreva apenas esta fase: criar fases novas é decisão do esqueleto, não` +
                  ` desta reescrita. E nenhuma task pode ficar com mais de ${MAX_CRITERIA_PER_TASK} critérios: a consolidação` +
                  ` que empurra critério para cima do teto volta para cá pelo outro lado`
                : `consolide critérios redundantes desta fase até ela caber em ${MAX_CRITERIA_PER_PHASE}: dois critérios que` +
                  ` verificam a mesma condição com palavras diferentes viram um só. Nenhuma condição verificável pode desaparecer —` +
                  ` se depois de consolidar ainda não couber, diga isso em vez de apagar critério. Reescreva apenas esta fase:` +
                  ` criar fases novas é decisão do plano, não desta reescrita`,
          })),
          remarks: [],
          reason: "há fase acima do que cabe numa sessão",
          mechanical: true,
        };
      }
    }

    if (!parsed.ok && !isRepairable(parsed.errors)) {
      /*
       * Decisão pendente não é achado do escritor.
       *
       * `I-13` diz que sobrou um `[NEEDS DECISION]`, e a correção que ele pede
       * é "resolva a decisão na entrevista" — coisa que quem reescreve a fase
       * não pode fazer: quem decide é o desenvolvedor, na rodada de lacunas.
       * Mandá-lo assim mesmo é o §49 de novo, e no `assitencia` foram quatorze
       * marcadores consumindo as três devoluções inteiras.
       *
       * O marcador continua bloqueando: a prontidão tem um gate só para ele, e
       * ele diz ao DESENVOLVEDOR o que ficou em aberto, que é quem pode fechar.
       */
      const doEscritor = substanceDefects(parsed.errors).filter((error) => error.code !== "I-13");
      const pendentes = parsed.errors.filter((error) => error.code === "I-13").length;
      if (pendentes > 0) {
        announce(`  ${pendentes} decisão(ões) seguem marcadas como pendentes; elas param a prontidão, não o escritor`);
      }

      if (doEscritor.length > 0) {
        /*
         * Cada defeito de contrato vai à FASE em que está.
         *
         * Com `where: linha N` e sem fase, `affectedPhases` mandava a emenda para
         * todas — e reescrever todas derruba as aprovações já pagas (HANDOFF). O
         * harness sabe a resposta: a última fase cujo heading precede a linha.
         */
        const total = skeletonAtual?.phases.length ?? 0;
        return {
          status: "REJECTED",
          findings: doEscritor.map((error) => {
            const fase = faseDaLinha(content, error.line, total);
            return {
              where: fase === undefined ? `linha ${error.line}` : `Phase ${fase} · linha ${error.line}`,
              mechanical: true,
              problem: `${error.code}: ${error.message}`,
              fix: error.hint,
              ...(fase === undefined ? {} : { phase: fase }),
            };
          }),
          remarks: [],
          reason: "o plano não passa no contrato",
          mechanical: true,
        };
      }
    }
    return null;
  }

  /**
   * A auditoria do plano inteiro, numa chamada (etapa 2 da redução).
   *
   * Era uma chamada por fase, mais a coerência, mais a triagem de materialidade
   * — N+2 chamadas por rodada, três rodadas, impasse, arbitragem. Agora o auditor
   * lê o plano inteiro uma vez contra as fontes, e o Core decide o que bloqueia
   * (`admitir`): só a contradição com as duas passagens citadas e existentes, a
   * interface citada dos dois lados e o pacote fora de
   * `infrastructure.dependencies`. O resto é observação do relatório.
   *
   * Uma segunda chance de formato, só quando a primeira veio ilegível: o que a
   * leitura tolerante não entende duas vezes é auditoria que não aconteceu, e
   * o plano não é publicado por ela.
   */
  async function auditarPlanoInteiro(content: string, writer: WriterContext, attempt: number): Promise<{ bloqueios: Finding[]; observacoes: Remark[]; lugares: Lugar[] }> {
    const lido = parsePhases(stripAllMarkers(content).content);
    const fases = lido.ok ? lido.document.phases : [];
    const upstream = [
      ...(skeletonAtual ? [{ name: "skeleton.md", content: renderSkeleton(skeletonForPlanning(skeletonAtual)) }] : []),
      ...(arquiteturaMd !== "" ? [{ name: "architecture.md", content: arquiteturaMd }] : []),
      ...(arquiteturaAtual && skeletonAtual && tempoDosFluxos(arquiteturaAtual, skeletonAtual).length > 0
        ? [{ name: DOCUMENTO_DO_TEMPO, content: tempoDosFluxos(arquiteturaAtual, skeletonAtual).join("\n") }]
        : []),
    ];
    const prompt = planAuditPrompt({ language: options.language, request: options.request.text, decisions: writer.decisions, upstream, content, totalPhases: fases.length });
    if (memoria.jaAprovada(prompt)) {
      announce("  plano aprovado numa execução anterior, com a mesma auditoria; não vou repagar");
      for (const fase of fases) relatarFase({ kind: "audit", number: fase.number, state: "aprovada" });
      return { bloqueios: [], observacoes: [], lugares: [] };
    }
    for (const fase of fases) relatarFase({ kind: "audit", number: fase.number, state: "corrente" });
    await event("audit", "project-phases.md", "started", "", attempt);
    let saida = await track({ role: "auditor", stage: "audit", subject: "project-phases.md", attempt, prompt });
    let resposta = parseAudit(saida);
    /*
     * Ilegível uma vez: UMA chamada com o protocolo repetido, só neste caminho.
     * Uma auditoria que aprova sem escrever o motivo não pode parar o run; uma
     * que ninguém consegue ler duas vezes para, como antes. Nunca se aprova o
     * que não se leu.
     */
    if (!resposta.ok) {
      announce(`  a auditoria do plano veio ilegível (${resposta.defects.join("; ")}); pedindo de novo, uma vez, com o protocolo repetido`);
      await event("audit", "project-phases.md", "retry", `auditoria ilegível: ${resposta.defects.join("; ")}`, attempt);
      saida = await track({ role: "auditor", stage: "audit", subject: "project-phases.md", attempt, prompt: auditRetryPrompt(prompt, saida, resposta.defects) });
      resposta = parseAudit(saida);
    }
    if (resposta.ok) for (const nota of resposta.applied) announce(`  ${nota}`);
    if (!resposta.ok) {
      await event("audit", "project-phases.md", "blocked", `auditoria ilegível: ${resposta.defects.join("; ")}`, attempt);
      throw new InitBlockedError(
        diagnostico("project-phases.md", [
          `a auditoria do plano veio ilegível duas vezes: ${resposta.defects.join("; ")}`,
          "",
          "O que veio, do começo:",
          `  ${saida.trim().slice(0, 300).replace(/\n/g, "\n  ") || "(nada)"}`,
        ], "Uma resposta ilegível não aprova o plano. Nada do que já foi escrito se perdeu; `capivara plan` retoma daqui e audita de novo."),
        runId,
      );
    }
    const veredicto = await semPedidoDeTeste("project-phases.md", resposta.verdict, attempt);
    const lugares: Lugar[] = [
      ...fases.map((fase) => ({ nome: `Phase ${fase.number}`, texto: fase.markdown })),
      ...upstream.map((documento) => ({ nome: documento.name, texto: documento.content })),
      { nome: "pedido", texto: options.request.text },
      { nome: "decisões", texto: writer.decisions.join("\n") },
    ];
    const dependencias = arquiteturaAtual?.infrastructure.dependencies.map((dependencia) => dependencia.name) ?? [];
    const bloqueios: Finding[] = [];
    const observacoes: Remark[] = [...veredicto.remarks];
    for (const finding of veredicto.findings) {
      const admissao = admitir(finding, lugares, dependencias);
      if (admissao.bloqueia) bloqueios.push(finding);
      else observacoes.push({ where: finding.where, observation: `${finding.problem} — não bloqueia: ${admissao.motivo}` });
    }
    // O auditor não cria decisão de produto: o que ele levantar como decisão vai ao relatório.
    for (const decisao of veredicto.decisions ?? []) observacoes.push({ where: decisao.where, observation: `ponto que o auditor levantou como decisão: ${decisao.decision}` });
    const devolvidas = new Set(bloqueios.length > 0 ? affectedPhases(bloqueios, fases.length) : []);
    for (const fase of fases) relatarFase(devolvidas.has(fase.number) ? { kind: "audit", number: fase.number, state: "devolvida", findings: bloqueios.length } : { kind: "audit", number: fase.number, state: "aprovada" });
    if (bloqueios.length === 0) memoria.guardarAprovacao(prompt);
    await event("audit", "project-phases.md", "complete", bloqueios.length === 0 ? "aprovado" : `${bloqueios.length} bloqueio(s)`, attempt);
    announce(`  auditoria do plano: ${bloqueios.length} bloqueio(s); ${observacoes.length} observação(ões) para o relatório`);
    return { bloqueios, observacoes, lugares };
  }

  /**
   * Da conferência mecânica à publicação: uma auditoria e, se ela bloquear,
   * uma emenda e mais uma auditoria. O que continuar bloqueando vai UMA vez à
   * arquitetura, qualquer que seja o campo — o escritor da fase copia o
   * contrato do componente, e nenhuma emenda de fase alcança a origem —, e o
   * plano refeito é auditado uma vez. O que ainda sobrar vira pergunta ao
   * desenvolvedor, com as passagens e a correção do auditor como leitura
   * recomendada; a resposta é aplicada como decisão, e as fases afetadas são
   * reescritas uma vez. O plano só é publicado limpo: o Core confere que as
   * passagens em conflito não coexistem mais, e se coexistem o `plan` para.
   */
  async function auditarPlano(initial: Authored, writer: WriterContext): Promise<{ content: string; remarks: Remark[] }> {
    let authored = initial;
    const observacoes = new Map<string, Remark>();
    let auditorias = 0;
    let mecanicas = 0;
    let voltouAArquitetura = false;
    for (let attempt = 1; ; attempt += 1) {
      const mecanico = autoconferencia(authored.content);
      if (mecanico !== null) {
        if (mecanicas >= maxMechanicalRounds) {
          await event("audit", "project-phases.md", "blocked", "a conferência mecânica não fechou", attempt);
          throw new InitBlockedError(
            diagnostico("project-phases.md", [
              `a conferência mecânica do plano não fechou em ${maxMechanicalRounds} emenda(s): ${mecanico.reason}`,
              ...mecanico.findings.flatMap((finding) => [`  · ${finding.where}: ${finding.problem}`, `    correção pedida: ${finding.fix}`]),
            ], "O esqueleto, a arquitetura e as fases estão em disco; `capivara plan` retoma daqui."),
            runId,
          );
        }
        mecanicas += 1;
        announce(`  conferência mecânica: ${mecanico.findings.length} defeito(s) — ${mecanico.reason}; emendando`);
        await event("audit", "project-phases.md", "retry", mecanico.reason, attempt);
        authored = await authored.rewrite(mecanico.findings, attempt + 1);
        if (temDecisaoPendente(authored.content)) authored = await closeGaps("project-phases.md", authored, writer);
        continue;
      }

      auditorias += 1;
      const { bloqueios, observacoes: destaLeitura, lugares } = await auditarPlanoInteiro(authored.content, writer, attempt);
      for (const observacao of destaLeitura) observacoes.set(`${observacao.where}\n${observacao.observation}`, observacao);
      if (bloqueios.length === 0) return { content: authored.content, remarks: [...observacoes.values()] };

      if (auditorias >= 2) {
        if (!voltouAArquitetura) {
          voltouAArquitetura = true;
          announce(`  a auditoria do plano bloqueou de novo depois da emenda: ${bloqueios.length} bloqueio(s) vão uma vez à arquitetura, com as citações`);
          await event("audit", "project-phases.md", "retry", `${bloqueios.length} bloqueio(s) depois da emenda: volta única à arquitetura`, attempt);
          const antes = authored.content;
          authored = await authored.rewrite(bloqueios.map((finding) => paraAArquitetura(finding, lugares)), attempt + 1, { voltaUnica: true });
          if (authored.content !== antes) {
            if (temDecisaoPendente(authored.content)) authored = await closeGaps("project-phases.md", authored, writer);
            continue;
          }
        }
        authored = await decidirAsContradicoes(authored, bloqueios, lugares, attempt, writer);
        const persistem = contradicoesQuePersistem(authored.content, bloqueios, lugares);
        if (persistem.length > 0) {
          await event("audit", "project-phases.md", "blocked", `${persistem.length} contradição(ões) persistem depois da decisão`, attempt);
          throw new InitBlockedError(
            diagnostico("project-phases.md", [
              `As passagens em conflito continuam no plano depois da decisão: ${persistem.length} contradição(ões), conferida(s) pelo Core nos documentos.`,
              "",
              ...persistem.flatMap((finding) => [`  · [${finding.classe ?? "?"}] ${finding.where}: ${finding.problem}`, `    passagens: ${passagensConferidas(finding, lugares)}`]),
            ], "A decisão está gravada. O escritor não a aplicou, ou a passagem que ela recusa está num documento que o plan não reescreve (o esqueleto ou a arquitetura): corrija a fonte e rode `capivara plan` de novo, ou troque o modelo do escritor."),
            runId,
          );
        }
        announce(`  ${bloqueios.length} contradição(ões) decidida(s); o plano é publicado sem elas`);
        await event("audit", "project-phases.md", "complete", `${bloqueios.length} contradição(ões) decidida(s) pelo desenvolvedor`, attempt);
        return { content: authored.content, remarks: [...observacoes.values()] };
      }
      /*
       * O envelope da fase — goal, covers, dependsOn — é escrito pela
       * arquitetura, e nenhuma emenda de fase o alcança (§126). Com uma emenda
       * só, o achado sobre ele vai à origem já na primeira vez.
       */
      const total = skeletonAtual?.phases.length ?? 0;
      const destino = bloqueios.map((finding) => (alvoNoEnvelope(finding) ? achadoNaOrigem(finding, total) : finding));
      const doEnvelope = destino.filter((finding, indice) => finding !== bloqueios[indice]).length;
      if (doEnvelope > 0) announce(`  ${doEnvelope} bloqueio(s) apontam o envelope de fase, que é escrito por architecture.md: a correção vai à arquitetura`);
      announce(`  emendando o plano com ${bloqueios.length} bloqueio(s); depois, a última auditoria`);
      await event("audit", "project-phases.md", "retry", bloqueios.map((finding) => finding.problem).join("; "), attempt);
      authored = await authored.rewrite(destino, attempt + 1);
      if (temDecisaoPendente(authored.content)) authored = await closeGaps("project-phases.md", authored, writer);
    }
  }

  /** As passagens do achado que o Core conferiu, com onde cada uma está: «A» (Phase 1), «B» (architecture.md). */
  function passagensConferidas(finding: Finding, lugares: readonly Lugar[]): string {
    return citacoesConferidas(finding, lugares).map((conferida) => `«${conferida.citacao}» (${conferida.lugares.join(", ")})`).join(" × ");
  }

  /** O bloqueio, endereçado a quem escreve a arquitetura, com as citações e o lugar de cada uma. */
  function paraAArquitetura(finding: Finding, lugares: readonly Lugar[]): Finding {
    const passagens = passagensConferidas(finding, lugares);
    return {
      where: `Architecture · ${finding.where}`,
      problem: `${finding.problem}${passagens !== "" ? ` — passagens conferidas pelo Core: ${passagens}` : ""}`,
      fix: `${finding.fix}. A fase copia o que a arquitetura lhe dá; corrija na arquitetura a origem do conflito — o contrato, o componente ou a fase a que ele pertence`,
      ...(finding.phase !== undefined ? { phase: finding.phase } : {}),
      ...(finding.classe !== undefined ? { classe: finding.classe } : {}),
    };
  }

  /** O número da fase de um lugar da auditoria ("Phase 3"), ou `undefined` quando o lugar é um documento. */
  function faseDoLugar(nome: string, fases: readonly { number: number }[]): number | undefined {
    return fases.find((fase) => `Phase ${fase.number}` === nome)?.number;
  }

  /**
   * Cada bloqueio que sobrou, perguntado ao desenvolvedor, e a resposta aplicada
   * como decisão às fases afetadas — as em que as passagens estão, e as que o
   * endereço nomeia —, numa reescrita só. Sem resposta no prazo, vale a leitura
   * recomendada: a correção do auditor.
   */
  async function decidirAsContradicoes(authored: Authored, bloqueios: readonly Finding[], lugares: readonly Lugar[], attempt: number, writer: WriterContext): Promise<Authored> {
    announce(`  ${bloqueios.length} bloqueio(s) sobraram depois da volta à arquitetura; perguntando a você, com as passagens e a correção do auditor como leitura recomendada`);
    await event("audit", "project-phases.md", "retry", `${bloqueios.length} contradição(ões) para o desenvolvedor decidir`, attempt);
    const lido = parsePhases(stripAllMarkers(authored.content).content);
    const fases = lido.ok ? lido.document.phases : [];
    const decididas: Finding[] = [];
    for (const [indice, finding] of bloqueios.entries()) {
      const conferidas = citacoesConferidas(finding, lugares);
      const resposta = await perguntarEGravar("project-phases.md", perguntaDaContradicao(finding, conferidas, indice + 1), indice + 1, bloqueios.length, attempt, "contradicao", writer);
      if (resposta.disposition !== "ACCEPTED") continue;
      const nomeadas = new Set<number>([
        ...conferidas.flatMap((conferida) => conferida.lugares.map((nome) => faseDoLugar(nome, fases)).filter((numero): numero is number => numero !== undefined)),
        ...(finding.phase !== undefined ? [finding.phase] : []),
      ]);
      const alvos = nomeadas.size > 0 ? [...nomeadas] : affectedPhases([finding], fases.length);
      for (const fase of alvos) decididas.push(contradicaoDecididaComoFinding(finding, resposta.decision, fase));
    }
    if (decididas.length === 0) return authored;
    let reescrito = await authored.rewrite(decididas, attempt + 1, { somenteNomeadas: true });
    if (temDecisaoPendente(reescrito.content)) reescrito = await closeGaps("project-phases.md", reescrito, writer);
    return reescrito;
  }

  /**
   * A conferência do Core, sem modelo, depois da decisão: o bloqueio que ainda
   * passa na admissibilidade — as passagens citadas coexistindo nas fases de
   * agora e nos documentos — persiste. Os documentos são os da auditoria; as
   * fases, as reescritas.
   */
  function contradicoesQuePersistem(content: string, bloqueios: readonly Finding[], lugares: readonly Lugar[]): Finding[] {
    const lido = parsePhases(stripAllMarkers(content).content);
    const fases = lido.ok ? lido.document.phases : [];
    const agora: Lugar[] = [
      ...fases.map((fase) => ({ nome: `Phase ${fase.number}`, texto: fase.markdown })),
      // Só os documentos: as fases da auditoria (as de antes) dão lugar às de agora.
      ...lugares.filter((lugar) => !lugar.nome.startsWith("Phase ")),
    ];
    const dependencias = arquiteturaAtual?.infrastructure.dependencies.map((dependencia) => dependencia.name) ?? [];
    return bloqueios.filter((finding) => admitir(finding, agora, dependencias).bloqueia);
  }

  return await concluir();

  /**
   * O fecho, comum aos dois caminhos.
   *
   * Os portões são os mesmos: o que decide se a documentação serve é o loop
   * conseguir executá-la, e isso não muda com a forma como ela foi produzida.
   */
  async function concluir(): Promise<InitOutcome> {
    /*
     * A última rede antes do gate.
     *
     * Chegar até aqui com decisão aberta é raro — a entrevista, as lacunas e a
     * auditoria já insistiram —, mas quando acontecia o run terminava em NOT READY
     * por uma pergunta que ninguém tinha feito. O gate continua podendo recusar; o
     * que ele não pode é recusar por silêncio nosso.
     */
    await insistirNasDecisoes("project-phases.md", maxInterviewRounds + 2, "antes do gate");

    const parsedPhases = parsePhases(plano);
    const coverage = coberturaAtual();

    const readiness = evaluateReadiness({
      plan: plano,
      architecture: arquiteturaMd,
      testAuthority: autoridadeDeTeste(),
      // O plano é carimbado com o que ele leu: o esqueleto e a arquitetura.
      stampInputs: skeletonAtual
        ? [
            { name: "skeleton.md", content: renderSkeleton(skeletonAtual) },
            ...(arquiteturaMd !== "" ? [{ name: "architecture.md", content: arquiteturaMd }] : []),
          ]
        : [],
      coverage,
      approved: planoAprovado,
      unresolvedQuestions: needsDecisionMarkers({
        round: maxInterviewRounds,
        questions: allQuestions,
        answers: allAnswers,
        assumptions: [],
        maxRounds: maxInterviewRounds,
      }),
      designRoot: artifactPaths(options.projectRoot).design,
      // Perguntar ao disco, não responder "sim" por padrão: o gate existe para
      // conferir, e um verificador que sempre aprova não está conferindo nada.
      designExists: (caminho) => existsSync(caminho),
    });

    const tasks = parsedPhases.ok ? parsedPhases.document.phases.reduce((total, phase) => total + phase.tasks.length, 0) : 0;
    if (readiness.ready && skeletonAtual) {
      await publish(options.projectRoot, [{
        name: "environment.json",
        content: renderEnvironmentPlan(skeletonAtual, plano, {
          ...(arquiteturaMd !== "" ? { architectureSha12: sha12(arquiteturaMd) } : {}),
          ...(arquiteturaAtual ? { infrastructure: arquiteturaAtual.infrastructure } : {}),
        }),
      }]);
    }

    const report: InitReport = {
      ready: readiness.ready,
      published: [...INIT_ARTIFACTS, ...(readiness.ready ? ["environment.json"] : [])].map((name) => `${artifactPaths(options.projectRoot).init}/${name}`),
      phases: parsedPhases.ok ? parsedPhases.document.phases.length : 0,
      tasks,
      mvpCutPhase: parsedPhases.ok ? parsedPhases.document.phases.length : 0,
      coverage: { stories: coverage.storyIds.length, entities: coverage.entities.length, workflows: coverage.workflows.length },
      checkpoint: buildCheckpoint({ round: maxInterviewRounds, questions: allQuestions, answers: allAnswers, assumptions: allAssumptions, maxRounds: maxInterviewRounds }),
      remarks: [...remarks, ...avisosDoRelatorio],
      costs: [...costs.values()],
      readiness,
    };

    await writeRunState(options.projectRoot, { ...state, stage: readiness.ready ? "ready" : "publish", status: readiness.ready ? "complete" : "blocked" }, now);
    await event(readiness.ready ? "ready" : "publish", "-", readiness.ready ? "complete" : "blocked", readiness.ready ? "RALPH READY" : "NOT READY");


    /*
     * O que a entrevista fechou volta para a base, como rascunho. Falhar aqui
     * não invalida o run: o documento está publicado e o registro é conveniência.
     */
    if (options.onMemorias) {
      const decisoes = decisoesComoMemorias(allAnswers, allQuestions, runId);
      if (decisoes.length > 0) {
        announce(`  ${decisoes.length} decisão(ões) da entrevista enviada(s) à base como rascunho`);
        await options.onMemorias(decisoes).catch((erro: unknown) => {
          announce(`  não consegui registrar as decisões: ${erro instanceof Error ? erro.message : String(erro)}`);
        });
      }
    }

    await memoria.fechar();
    return { runId, readiness, report, rendered: renderReport(report) };
  }
}

export { sha12 };
