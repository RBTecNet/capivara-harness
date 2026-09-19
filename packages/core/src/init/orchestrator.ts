/**
 * A máquina de estados do `init` e do `plan`.
 *
 * `init`: entrevista → esqueleto → PLAN READY. Uma chamada olha o produto
 * inteiro, e é a única que olha.
 * `plan`: uma fase por chamada, cada uma vendo só a sua fatia → lacunas →
 * auditoria → ensaio → RALPH READY. O plano é montado em código, nunca escrito
 * de uma vez.
 *
 * Toda dependência externa entra por parâmetro — a chamada ao modelo e a
 * pergunta ao desenvolvedor. Isso é o que permite exercitar o init inteiro, do
 * pedido ao gate, sem tocar em provider real.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assemblePhasesDocument, buildStamp, checkCoverage, checkDesignRefs, assemblePhase, checkRewriteDrift, coverageFromSkeleton, extractTasks, parsePhaseFragment, parseSkeleton, renderSkeleton, sliceForPhase, normalizePhasePart, parsePhases, sha12 } from "../contract/index.js";
import type { CoverageSources, Skeleton, StampInput } from "../contract/index.js";
import { DEFAULT_MAX_RETURNS, nextAuditAction, parseAudit, renderStandoff } from "../audit/index.js";
import type { AuditAttempt, AuditVerdict, Finding, Remark } from "../audit/index.js";
import { tasksBlock } from "../contract/templates.js";
import { MAX_CRITERIA_PER_PHASE, MAX_CRITERIA_PER_TASK, MAX_TASKS_PER_PHASE, isRepairable, publish, repairDeterministically, stripDeadDesignRefs, stripResolvedMarkers, substanceDefects } from "../authoring/index.js";
import { buildAnswer, buildCheckpoint, classifyLocally, isNonAnswer, needsDecisionMarkers, parseClassification, parseQuestionBatch, planRound, readHandoff, unresolved, writeHandoff } from "../interview/index.js";
import type { Answer, Assumption, Question } from "../interview/index.js";
import { amendPhasePrompt, assessRehearsal, auditorPrompt, coherencePrompt, languageBlock, enumerateCriteria, phaseAuditPrompt, phaseFromSlicePrompt, skeletonPrompt, gapPrompt, interviewPrompt, parseRehearsal, rehearsalPrompt } from "../prompts/index.js";
import type { AskedQuestion, CriterionRef, RehearsalResult, WriterContext } from "../prompts/index.js";
import { appendEvent, artifactPaths, createRunState, ensureArtifactTree, readEvents, runIdFor, runPaths, writeRunState } from "../state/index.js";
import type { RunStage } from "../state/index.js";
import { detectRateLimit, planWait } from "../loop/ratelimit.js";
import { inspectProject, summarizeInventory } from "./inventory.js";
import { INIT_ARTIFACTS, evaluateReadiness } from "./readiness.js";
import { evaluatePlanReadiness, renderPlanReadiness } from "./plan-readiness.js";
import { readSkeletonState, writeSkeletonState } from "./skeleton-state.js";
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
  stdout: string;
  exitCode: number;
  /** Tokens da chamada, quando a CLI os reporta. Ausente é "não medido". */
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number };
}>;
export type AskDeveloper = (question: Question, index: number, total: number) => Promise<string>;
export type DecideStandoff = (rendered: string) => Promise<string>;

export interface InitOptions {
  projectRoot: string;
  request: DeveloperRequest;
  language: string;
  call: AgentCaller;
  ask: AskDeveloper;
  decideStandoff?: DecideStandoff;
  announce?: (message: string) => void;
  maxAuditReturns?: number;
  maxInterviewRounds?: number;
  /** Rodadas para fechar gaps que o escritor descobre ao escrever. */
  maxGapRounds?: number;
  /** Teto de perguntas por rodada de gap: ninguém responde a uma enxurrada. */
  maxGapQuestions?: number;
  /** Reescritas do plano motivadas pelo ensaio do verificador. */
  maxRehearsalRounds?: number;
  /** Ignora o que este run já publicou e recomeça do zero. */
  fresh?: boolean;
  /** Fases escritas ao mesmo tempo. Elas são independentes; o teto é de cortesia. */
  maxParallelParts?: number;
  /** Rodadas para fechar defeito mecânico, separadas do teto do auditor. */
  maxMechanicalRounds?: number;
  /**
   * Onde o run começa e termina.
   *
   * `init` produz o esqueleto e para em PLAN READY; `plan` lê o esqueleto de
   * disco e detalha as fases até RALPH READY. `both` faz os dois de uma vez, que
   * é como os testes exercitam o ciclo de ponta a ponta.
   */
  stage?: "init" | "plan" | "both";
  /** Critérios por chamada do ensaio. Lote grande volta sem julgamento. */
  maxCriteriaPerRehearsalBatch?: number;
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

function scoped(document: string, questionId: string, stage = "interview"): string {
  return `${document}#${stage}#${questionId}`;
}

/** Um documento escrito, com a forma de reescrevê-lo quando o auditor devolve. */
interface Authored {
  content: string;
  rewrite: (findings: Finding[], attempt: number) => Promise<Authored>;
}

/**
 * De quais fases os findings falam.
 *
 * Um finding costuma citar "Phase 3" ou "Phase 1.5". Quando nenhum identifica
 * uma fase, o conservador é reescrever todas: melhor pagar a mais do que
 * publicar um plano com um defeito que ninguém atribuiu.
 */
function affectedPhases(findings: readonly Finding[], total: number): number[] {
  const named = new Set<number>();
  for (const finding of findings) {
    for (const match of `${finding.where} ${finding.problem}`.matchAll(/\b(?:phase|fase)\s*(\d+)/gi)) {
      const phase = Number(match[1]);
      if (phase >= 1 && phase <= total) named.add(phase);
    }
  }
  return named.size > 0 ? [...named].sort((left, right) => left - right) : Array.from({ length: total }, (_, index) => index + 1);
}

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
  const maxGapRounds = options.maxGapRounds ?? 2;
  const maxGapQuestions = options.maxGapQuestions ?? 5;
  const maxRehearsalRounds = options.maxRehearsalRounds ?? 1;
  const maxParallelParts = Math.max(1, options.maxParallelParts ?? 3);
  const maxCriteriosPorLote = Math.max(1, options.maxCriteriaPerRehearsalBatch ?? 20);
  const maxMechanicalRounds = Math.max(1, options.maxMechanicalRounds ?? 3);
  const esperar = options.sleep ?? ((seconds: number) => new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000)));
  const providerDoPapel = (role: AgentCall["role"]): string => options.providers?.[role] ?? "default";

  const runId = runIdFor("init", options.request.sha12);
  const paths = runPaths(options.projectRoot, runId);
  await ensureArtifactTree(options.projectRoot);
  const state = createRunState({ runId, command: "init", language: options.language, now });
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
  const track = async (call: AgentCall): Promise<string> => {
    let esperas = 0;

    for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
      const startedAt = Date.now();
      const response = await options.call(call);
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

      if (response.exitCode === 0) return response.stdout;

      const estouro = response.exitCode === 124;
      if (estouro && tentativa === 1) {
        announce(`  a chamada de ${call.role} em ${call.subject} estourou o tempo; tentando uma segunda vez`);
        await event(call.stage, call.subject, "retry", "timeout do provider", call.attempt);
        continue;
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
          : `o papel ${call.role} falhou com código ${response.exitCode} em ${call.subject}`,
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
  const inventoryText = summarizeInventory(inventory);
  announce(inventory.empty ? "Projeto vazio: greenfield." : `Inventário: ${inventory.files.length} arquivo(s).`);

  /** O plano executável publicado por este run. */
  let plano = "";
  let planoAprovado = false;
  const allAnswers: Answer[] = [];
  const allQuestions: Question[] = [];
  /** Suposições que o escritor registrou em vez de perguntar; o relatório as mostra. */
  const allAssumptions: Assumption[] = [];
  const remarks: { document: string; remark: Remark }[] = [];
  /** Ausente até o ensaio rodar; o gate trata ausência como reprovação. */
  let rehearsal: { blocked: string[] } | undefined;
  /** Presente apenas no caminho por esqueleto; é dele que sai a cobertura. */
  let skeletonAtual: Skeleton | null = null;

  /*
   * Um caminho só: uma leitura do produto inteiro, depois cada fase vendo a sua
   * fatia.
   *
   * A cadeia de quatro documentos em prosa foi removida. Ela existia para um
   * leitor que não existe — o desenvolvedor não lê documentação, verifica se a
   * aplicação funciona — e custava oito vezes mais para entregar um plano três
   * vezes maior. O critério de aceite é um só: o loop consegue executar.
   */
  return await buildFromSkeleton();

  async function interview(document: string, upstream: { name: string; content: string }[]) {
    const questions: Question[] = [];
    const answers: Answer[] = [];

    /*
     * O handoff é gravado ao fim de cada rodada, e é ele que impede reperguntar.
     * Semeado aqui, o `planRound` vê as respostas que já existem e só pede o que
     * falta; o levantamento novo chega e é deduplicado por id contra estas.
     */
    const retomado = options.fresh === true ? null : await readHandoff(options.projectRoot, runId, document);
    if (retomado && retomado.answers.length > 0) {
      questions.push(...retomado.questions);
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
      const base = interviewPrompt(document, writer, inventoryText, previous);
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

      if (!batch.ok) {
        throw new InitBlockedError(
          `o levantamento de perguntas de ${document} veio malformado duas vezes: ` +
            batch.defects.map((defect) => `${defect.questionId}: ${defect.problem}`).join("; "),
          runId,
        );
      }

      for (const question of batch.questions) if (!questions.some((entry) => entry.id === question.id)) questions.push(question);
      for (const assumption of batch.assumptions) {
        if (!allAssumptions.some((entry) => entry.statement === assumption.statement)) allAssumptions.push(assumption);
      }
      if (batch.assumptions.length > 0) {
        announce(`  ${batch.assumptions.length} suposição(ões) registrada(s) em vez de perguntar; estão no relatório`);
      }

      const plan = planRound({ round, questions, answers, assumptions: [], maxRounds: maxInterviewRounds });
      if (plan.converged || plan.ask.length === 0) break;

      let index = 0;
      for (const question of plan.ask) {
        index += 1;
        const raw = await options.ask(question, index, plan.ask.length);
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
      const segunda = await options.ask(question, index, total);
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
  /** O contexto comum das duas perguntas da auditoria do plano. */
  function auditBase(writer: WriterContext, upstream: { name: string; content: string }[]) {
    return {
      language: options.language,
      document: "project-phases.md",
      executable: true,
      request: options.request.text,
      decisions: writer.decisions,
      dispositions: allAnswers.map((answer) => `${answer.questionId} ${answer.disposition}`),
      upstream,
      upstreamRemarks: remarks.map((entry) => ({
        document: entry.document,
        where: entry.remark.where,
        observation: entry.remark.observation,
      })),
      content: "",
    };
  }

  /**
   * Auditoria do plano: uma chamada por fase, em paralelo, mais uma de coerência.
   *
   * As chamadas por fase são independentes — cada uma julga uma fase contra as
   * decisões — então correm juntas. A de coerência lê o índice de critérios em
   * vez do texto corrido: o mesmo conteúdo, organizado para que a contradição
   * fique lado a lado em vez de a trinta páginas de distância.
   */
  async function auditPlanInParts(
    content: string,
    writer: WriterContext,
    upstream: { name: string; content: string }[],
    attempt: number,
  ): Promise<AuditVerdict> {
    const parsed = parsePhases(content);
    if (!parsed.ok) throw new InitBlockedError("o plano não passa no parser na hora de auditar", runId);

    const fases = parsed.document.phases;
    const base = auditBase(writer, upstream);

    const digest = enumerateCriteria(parsed.document)
      .map((criterion) => `${criterion.address} [${criterion.taskTitle}] ${criterion.text}`)
      .join("\n");

    /*
     * A coerência entra na MESMA fila das fases, não depois delas. Ela não
     * depende de nenhuma e serializá-la custou 318s numa medição — cinco minutos
     * de relógio em troca de nada.
     */
    /*
     * Cada auditoria recebe exatamente o que a sua pergunta exige.
     *
     * A de uma fase recebe a MESMA fatia que escreveu a fase: fidelidade só é
     * julgável contra o que foi pedido, e pedir a fase sem o pedido é pedir ao
     * auditor que adivinhe. A de coerência recebe o esqueleto inteiro, porque a
     * pergunta dela é global por natureza — e ela é uma chamada, não N.
     */
    const fatia = (numero: number): { name: string; content: string }[] =>
      skeletonAtual ? [{ name: "fatia do esqueleto", content: sliceForPhase(skeletonAtual, numero) }] : upstream;

    const tarefas: (() => Promise<AuditVerdict>)[] = [
      ...fases.map((fase) => () =>
        auditCall(`project-phases.md#P${fase.number}`, attempt, () =>
          phaseAuditPrompt({
            ...base,
            upstream: fatia(fase.number),
            phaseMarkdown: fase.markdown,
            phaseNumber: fase.number,
            totalPhases: fases.length,
          }),
        ),
      ),
      () =>
        auditCall("project-phases.md#coerência", attempt, () =>
          coherencePrompt({
            ...base,
            upstream: skeletonAtual ? [{ name: "skeleton.md", content: renderSkeleton(skeletonAtual) }] : upstream,
            digest,
            totalPhases: fases.length,
          }),
        ),
    ];

    const veredictos: AuditVerdict[] = [];
    const fila = [...tarefas];
    await Promise.all(
      Array.from({ length: Math.min(maxParallelParts + 1, fila.length) }, async () => {
        for (;;) {
          const tarefa = fila.shift();
          if (!tarefa) return;
          veredictos.push(await tarefa());
        }
      }),
    );

    const findings = veredictos.flatMap((veredicto) => veredicto.findings);
    const remarksDoPlano = veredictos.flatMap((veredicto) => veredicto.remarks);

    announce(`  auditoria em ${fases.length} fase(s) + coerência: ${findings.length} finding(s)`);

    return findings.length > 0
      ? { status: "REJECTED", findings, remarks: remarksDoPlano, reason: veredictos.find((v) => v.reason)?.reason ?? "há defeito no plano" }
      : { status: "APPROVED", findings: [], remarks: remarksDoPlano, reason: "" };
  }

  /** Uma chamada de auditoria, com a repetição por saída inválida que já existia. */
  async function auditCall(subject: string, attempt: number, prompt: () => string): Promise<AuditVerdict> {
    for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
      const parsed = parseAudit(await track({ role: "auditor", stage: "audit", subject, attempt, prompt: prompt() }));
      if (parsed.ok) return parsed.verdict;
      if (tentativa === 2) {
        throw new InitBlockedError(`o auditor de ${subject} devolveu saída inválida duas vezes: ${parsed.defects.join("; ")}`, runId);
      }
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
      }

      announce(`— esqueleto lido: ${guardado.phases.length} fases, ${guardado.rules.length} regra(s) transversal(is)`);
      return await detalharFases(guardado);
    }

    await event("interview", "skeleton", "started");
    const entrevista = await interview("skeleton", []);
    allAnswers.push(...entrevista.answers.map((answer) => ({ ...answer, questionId: scoped("skeleton", answer.questionId) })));
    allQuestions.push(...entrevista.questions.map((question) => ({ ...question, id: scoped("skeleton", question.id) })));

    const decisoes = allAnswers.filter((answer) => answer.disposition === "ACCEPTED").map((answer) => answer.decision);
    const suposicoes = allAssumptions.map((assumption) => `${assumption.topic}: ${assumption.statement} (${assumption.basis})`);

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
    for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
      const saida = await track({
        role: "writer",
        stage: "authoring",
        subject: "skeleton",
        attempt: tentativa,
        prompt: skeletonPrompt({
          language: options.language,
          request: options.request.text,
          decisions: decisoes,
          assumptions: suposicoes,
          inventory: inventoryText,
          maxTasksPerPhase: MAX_TASKS_PER_PHASE,
          maxCriteriaPerTask: MAX_CRITERIA_PER_TASK,
          ...(defeitos.length > 0 ? { defects: defeitos } : {}),
        }),
      });

      const lido = parseSkeleton(saida, { maxTasksPerPhase: MAX_TASKS_PER_PHASE });
      if (!lido.ok) {
        defeitos = lido.defects.map((defeito) => `${defeito.problem} → ${defeito.hint}`);
        announce(`  o esqueleto veio com ${defeitos.length} defeito(s) de forma; pedindo de novo com eles nomeados`);
        continue;
      }

      /*
       * O gate é a autoridade sobre o que é um esqueleto executável, então o
       * laço consulta O MESMO gate em vez de reimplementar a regra — é a tese do
       * contrato único aplicada aqui dentro.
       *
       * Fora as decisões em aberto, que são da entrevista e não do escritor: ele
       * não tem como fechá-las reescrevendo.
       */
      const portao = evaluatePlanReadiness({ skeleton: lido.skeleton, unresolvedQuestions: [] });
      const executaveis = portao.checks.filter(
        (check) => !check.passed && check.id !== "esqueleto" && check.id !== "decisoes",
      );

      esqueleto = lido.skeleton;
      if (executaveis.length === 0) break;

      defeitos = executaveis.map((check) => `${check.title} — ${check.detail}`);
      announce(`  o esqueleto não passa no gate em ${executaveis.length} ponto(s); pedindo de novo com eles nomeados`);
    }

    if (!esqueleto) {
      throw new InitBlockedError(`o esqueleto veio inválido duas vezes: ${defeitos.join("; ")}`, runId);
    }

    await publish(options.projectRoot, [{ name: "skeleton.md", content: renderSkeleton(esqueleto) }]);
    await event("publish", "skeleton", "complete", `${esqueleto.phases.length} fase(s), ${esqueleto.entities.length} entidade(s)`);
    announce(`  esqueleto: ${esqueleto.phases.length} fases, ${esqueleto.entities.length} entidades, ${esqueleto.rules.length} regra(s) transversal(is)`);

    await writeSkeletonState(options.projectRoot, runId, esqueleto);
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

      return { runId, readiness: relatorio.readiness, report: relatorio, rendered: renderPlanReadiness(planReadiness) };
    }

    return await detalharFases(esqueleto);
  }

  /**
   * O segundo estágio: cada fase ganha tasks, critérios e testes.
   *
   * Cada uma vê só a sua fatia — a stack, o que ela cobre, e as regras
   * transversais. O que precisava ser acordado entre elas já foi, no esqueleto.
   */
  async function detalharFases(esqueleto: Skeleton): Promise<InitOutcome> {
    // Cada fase vê a sua fatia, e só ela. É a troca que corta a reconstrução do
    // projeto inteiro em toda chamada.
    const fases = new Array<string>(esqueleto.phases.length).fill("");
    const fila = esqueleto.phases.map((fase, posicao) => ({ fase, posicao }));
    await Promise.all(
      Array.from({ length: Math.min(maxParallelParts, fila.length) }, async () => {
        for (;;) {
          const proxima = fila.shift();
          if (!proxima) return;
          const { fase, posicao } = proxima;
          const saida = await track({
            role: "writer",
            stage: "authoring",
            subject: `phase-p${String(fase.number).padStart(2, "0")}`,
            attempt: 1,
            prompt: phaseFromSlicePrompt({
              language: options.language,
              slice: sliceForPhase(esqueleto, fase.number),
              phaseNumber: fase.number,
              totalPhases: esqueleto.phases.length,
              // O molde de uma TASK. O envelope da fase é montado em código, do
              // esqueleto: pedi-lo ao modelo só criava mais uma coisa a errar.
              grammar: tasksBlock(fase.number),
              maxCriteriaPerTask: MAX_CRITERIA_PER_TASK,
            }),
          });
          const semMortas = stripDeadDesignRefs(repairDeterministically(saida).content, designExiste);
          for (const conserto of semMortas.applied) announce(`    fase ${fase.number}: ${conserto}`);

          // O modelo escreveu as tasks; o envelope vem do esqueleto, montado em
          // código. Número, título, goal, dependências e cobertura deixam de ser
          // coisas que ele possa errar.
          const tarefas = extractTasks(semMortas.content);
          for (const conserto of tarefas.applied) announce(`    fase ${fase.number}: ${conserto}`);
          fases[posicao] = assemblePhase(
            { number: fase.number, title: fase.title, goal: fase.goal, dependsOn: fase.dependsOn, covers: fase.covers },
            tarefas.tasks,
          ).trim();
          announce(`  fase ${fase.number} pronta`);
          await event("authoring", `phase-p${String(fase.number).padStart(2, "0")}`, "complete");
        }
      }),
    );

    const documento = assemblePhasesDocument({
      projectName: esqueleto.projectName,
      stamp: buildStamp([{ name: "skeleton.md", content: renderSkeleton(esqueleto) }]),
      overview: `${esqueleto.phases.length} fases, fundação primeiro. O MVP fecha na fase ${esqueleto.mvpCutPhase}.`,
      phases: fases,
      openQuestions: unresolved({
        round: maxInterviewRounds,
        questions: allQuestions,
        answers: allAnswers,
        assumptions: [],
        maxRounds: maxInterviewRounds,
      }).map((item) => `${item.topic}: ${item.statement}`),
    });

    plano = documento;
    skeletonAtual = esqueleto;

    const writerDoPlano = writerContext([]);
    const semGaps = await closeGaps("project-phases.md", planoAutorado(esqueleto, fases), writerDoPlano);
    plano = semGaps.content;

    const verdict = await auditLoop("project-phases.md", semGaps, writerDoPlano, []);
    plano = verdict.content;
    planoAprovado = true;
    remarks.push(...verdict.remarks.map((remark) => ({ document: "project-phases.md", remark })));

    const final = await rehearse(verdict.authored, writerDoPlano, []);
    plano = final.content;

    await publish(options.projectRoot, [{ name: "project-phases.md", content: final.content }]);
    await event("publish", "project-phases.md", "complete");

    return await concluir();
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

  /**
   * O plano montado, com a forma de emendar a fase que a auditoria citar.
   *
   * Sem isto a devolução não tinha o que reescrever: o plano voltava idêntico e o
   * ciclo virava impasse com zero devoluções. A emenda nasce da MESMA fatia que
   * escreveu a fase — é o que mantém a fase corrigida coerente com o que ela
   * podia ver quando nasceu.
   */
  function planoAutorado(esqueleto: Skeleton, fases: string[]): Authored {
    const montar = (partes: string[]): string =>
      assemblePhasesDocument({
        projectName: esqueleto.projectName,
        stamp: buildStamp([{ name: "skeleton.md", content: renderSkeleton(esqueleto) }]),
        overview: `${esqueleto.phases.length} fases, fundação primeiro. O MVP fecha na fase ${esqueleto.mvpCutPhase}.`,
        phases: partes,
        openQuestions: [],
      });

    const autorado = (partes: string[]): Authored => ({
      content: montar(partes),
      rewrite: async (findings, attempt) => {
        const alvos = affectedPhases(findings, partes.length);
        announce(`  emendando ${alvos.length} de ${partes.length} fase(s)`);
        const proximas = [...partes];

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
              const saida = await track({
                role: "writer",
                stage: "authoring",
                subject: `phase-p${String(numero).padStart(2, "0")}`,
                attempt,
                prompt: amendPhasePrompt({ language: options.language, current: anterior, findings }),
              });

              const limpa = stripDeadDesignRefs(repairDeterministically(saida).content, designExiste);
              for (const conserto of limpa.applied) announce(`    fase ${numero}: ${conserto}`);
              proximas[numero - 1] = assemblePhase(
                { number: fase.number, title: fase.title, goal: fase.goal, dependsOn: fase.dependsOn, covers: fase.covers },
                extractTasks(limpa.content).tasks,
              ).trim();
            }
          }),
        );

        return autorado(proximas);
      },
    });

    return autorado(fases);
  }

  /**
   * As fontes de cobertura: o esqueleto, que é quem declarou o produto.
   *
   * Sem esqueleto não há o que cobrir — e é o caso de quem ainda não rodou o
   * `init`, onde as listas vazias fazem a checagem passar por não ter assunto.
   */
  function coberturaAtual(): CoverageSources {
    return skeletonAtual ? coverageFromSkeleton(skeletonAtual) : { storyIds: [], entities: [], workflows: [] };
  }

  /**
   * A decisão que fecha um impasse é uma decisão, não um recado.
   *
   * O piloto 3 pagou por isso duas vezes. Na primeira madrugada, a regra precisa
   * sobre espaços em `cartoes.titulo` foi escrita pelo desenvolvedor, aplicada ao
   * plano daquele momento e publicada. No run seguinte o plano foi reescrito, a
   * decisão não existia em lugar nenhum além de uma linha de log, e o auditor
   * levantou exatamente a mesma ambiguidade — três devoluções e um segundo
   * impasse sobre a mesma coisa.
   *
   * Ela passa a valer como resposta ACEITA: entra nas decisões que alimentam
   * todo escritor daqui para frente e é gravada no handoff, que é o que a
   * retomada lê.
   */
  async function recordDeveloperDecision(document: string, findings: readonly Finding[], decision: string): Promise<void> {
    const anteriores = allAnswers.filter((answer) => answer.questionId.includes("#standoff#")).length;
    const id = `SD-${String(anteriores + 1).padStart(2, "0")}`;
    const pergunta: Question = {
      id,
      topic: "impasse de auditoria",
      evidence: findings.map((finding) => `${finding.where}: ${finding.problem}`).join(" · "),
      decision: `O auditor e o escritor não convergiram em ${document}. O que vale?`,
      why: "a decisão do desenvolvedor é autoridade acima do auditor e vale para os documentos seguintes",
      options: [],
      recommended: "",
      recommendationBasis: "",
    };

    allQuestions.push({ ...pergunta, id: scoped(document, id, "standoff") });
    allAnswers.push({
      questionId: scoped(document, id, "standoff"),
      raw: decision,
      disposition: "ACCEPTED",
      decision,
      open: "",
      round: 1,
      answeredAt: now().toISOString(),
    });

    // No handoff os ids são locais ao documento: é assim que a retomada os lê.
    await persistAnswers(document, [pergunta], [
      { questionId: id, raw: decision, disposition: "ACCEPTED", decision, open: "", round: 1, answeredAt: now().toISOString() },
    ]);

    announce("  decisão registrada: vale para este documento e para os seguintes");
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
  async function closeGaps(document: string, initial: Authored, writer: WriterContext): Promise<Authored> {
    let authored = initial;
    // Um marcador já perguntado não volta. Reperguntar o que a pessoa acabou de
    // responder é a forma mais rápida de fazê-la desistir da entrevista.
    const asked = new Set<string>();

    for (let round = 1; round <= maxGapRounds; round += 1) {
      // Marcadores idênticos são UMA decisão, não uma por ocorrência: no piloto 1
      // o mesmo marcador apareceu 27 vezes e virou 27 perguntas iguais.
      const markers = [
        ...new Set(
          [...authored.content.matchAll(/\[NEEDS DECISION\]\s*(.+)/g)]
            .map((match) => (match[1] ?? "").trim())
            .filter((marker) => marker !== "" && !asked.has(marker.toLowerCase())),
        ),
      ].slice(0, maxGapQuestions);
      if (markers.length === 0) return authored;
      for (const marker of markers) asked.add(marker.toLowerCase());

      announce(`  ${markers.length} decisão(ões) pendente(s) nas fases; reabrindo a entrevista`);
      await event("interview", document, "retry", `${markers.length} gap(s) descobertos na escrita`, round);

      const batch = parseQuestionBatch(
        await track({
          role: "writer",
          stage: "interview",
          subject: `${document}:gaps`,
          attempt: round,
          prompt: gapPrompt(document, writer, markers, perguntadas()),
        }),
      );
      if (!batch.ok || batch.questions.length === 0) return authored;

      const answered: Answer[] = [];
      let index = 0;
      for (const question of batch.questions) {
        index += 1;
        const raw = await options.ask(question, index, batch.questions.length);
        answered.push(await settle(document, question, raw, round, index, batch.questions.length));
      }

      // Escopo próprio: as perguntas de gap reusam Q-01, Q-02… e sobrescreveriam
      // as respostas da entrevista do esqueleto.
      const escopo = `gap${round}`;
      allQuestions.push(...batch.questions.map((question) => ({ ...question, id: scoped(document, question.id, escopo) })));
      allAnswers.push(...answered.map((answer) => ({ ...answer, questionId: scoped(document, answer.questionId, escopo) })));

      // Decisão tomada aqui precisa sobreviver ao processo: sem isto, o run
      // seguinte pergunta a mesma coisa porque a retomada não a encontra.
      await persistAnswers(document, batch.questions, answered);

      const accepted = answered.filter((answer) => answer.disposition === "ACCEPTED");
      if (accepted.length === 0) return authored;

      writer.decisions = allAnswers.filter((answer) => answer.disposition === "ACCEPTED").map((answer) => answer.decision);

      const resolvidos = accepted
        .map((answer) => markers[batch.questions.findIndex((entry) => entry.id === answer.questionId)] ?? "")
        .filter((marker) => marker !== "");

      authored = await authored.rewrite(
        accepted.map((answer) => {
          const question = batch.questions.find((entry) => entry.id === answer.questionId);
          return {
            where: question?.topic ?? document,
            problem: `a decisão "${question?.decision ?? answer.questionId}" estava marcada como pendente`,
            fix: `o desenvolvedor decidiu: ${answer.decision}. Escreva isso e remova o marcador [NEEDS DECISION] correspondente`,
          };
        }),
        round,
      );

      // O escritor deveria ter apagado o marcador; quando não apaga, o marcador
      // bloquearia o gate por uma decisão que já existe. Isso é mecânico.
      const limpo = stripResolvedMarkers(authored.content, resolvidos);
      if (limpo.applied.length > 0) {
        for (const fix of limpo.applied) announce(`    ${fix}`);
        authored = { content: limpo.content, rewrite: authored.rewrite };
      }
    }

    return authored;
  }

  /**
   * O ensaio do verificador.
   *
   * O auditor pergunta se o documento está bem escrito; o ensaio pergunta se o
   * critério pode ser provado por alguém. São perguntas diferentes, feitas por
   * papéis com regras da dúvida opostas, e foi entre elas que o piloto 2 escapou:
   * plano aprovado, critério impossível, três ciclos de correção queimados sobre
   * código que estava certo.
   *
   * Reprovou, volta ao escritor como finding, igual a qualquer devolução de
   * auditoria. Sobreviveu à última rodada, bloqueia o RALPH READY com o endereço
   * na tela — porque o preço de barrar um plano bom é o desenvolvedor reler uma
   * linha, e o de liberar um plano impossível é o build inteiro.
   */
  async function rehearse(
    initial: Authored,
    writer: WriterContext,
    upstream: { name: string; content: string }[],
  ): Promise<{ content: string }> {
    let authored = initial;

    for (let round = 1; round <= maxRehearsalRounds + 1; round += 1) {
      const parsed = parsePhases(authored.content);
      if (!parsed.ok) {
        // Plano que não passa no parser já é reprovado pelo gate do contrato, e
        // ensaiar critério que ninguém conseguiu ler não acrescenta nada.
        rehearsal = { blocked: [] };
        return { content: authored.content };
      }

      const criteria = enumerateCriteria(parsed.document);
      if (criteria.length === 0) {
        rehearsal = { blocked: [] };
        return { content: authored.content };
      }

      await event("verify", "project-phases.md", "started", `${criteria.length} critério(s)`, round);
      const assessment = await judgeAll(criteria, writer, upstream, round);

      const blocked = [
        ...assessment.blocking.map(
          ({ criterion, ruling, reason }) =>
            `${criterion.address} · ${criterion.taskTitle} — ${ruling}: ${reason || criterion.text}`,
        ),
        /*
         * Silêncio não aprova — mas também não acusa o critério. Quando um lote
         * volta sem julgamento, o defeito está no ensaio, não no plano, e a
         * mensagem precisa dizer isso para ninguém sair reescrevendo texto bom.
         */
        ...assessment.unrehearsed.map(
          (criterion) =>
            `${criterion.address} · ${criterion.taskTitle} — NÃO ENSAIADO: o ensaio não conseguiu julgar este critério` +
            ` (falha do ensaio, não do plano; rode de novo para ensaiar só o que faltou)`,
        ),
      ];

      if (blocked.length === 0) {
        announce(`  ensaio do verificador: ${criteria.length} critério(s), todos observáveis`);
        await event("verify", "project-phases.md", "complete", `${criteria.length} critério(s) observáveis`, round);
        rehearsal = { blocked: [] };
        return { content: authored.content };
      }

      // Sem finding não há o que reescrever: critério não julgado é falha do
      // ensaio, não do plano, e mandar o escritor mexer no que ninguém acusou só
      // troca um documento bom por outro.
      if (round > maxRehearsalRounds || assessment.blocking.length === 0) {
        announce(`  ensaio do verificador reprovou ${blocked.length} critério(s); o plano segue publicado e o gate bloqueia`);
        await event("verify", "project-phases.md", "blocked", blocked.join(" | "), round);
        rehearsal = { blocked };
        return { content: authored.content };
      }

      announce(`  ensaio do verificador reprovou ${assessment.blocking.length} critério(s); reescrevendo o plano`);
      await event("verify", "project-phases.md", "retry", blocked.join(" | "), round);

      authored = await authored.rewrite(
        assessment.blocking.map(({ criterion, ruling, reason }) => ({
          where: `Phase ${criterion.phase}`,
          problem:
            ruling === "UNSATISFIABLE"
              ? `o critério ${criterion.address}, na task "${criterion.taskTitle}", afirma a presença do que as decisões confirmadas negam: ${reason}. Nenhuma implementação correta consegue prová-lo, e o verificador vai reprovar a fase por ela estar certa`
              : `o critério ${criterion.address}, na task "${criterion.taskTitle}", não nomeia nada que alguém possa observar no código: ${reason}. Dois verificadores honestos leriam o mesmo código e discordariam`,
          fix:
            ruling === "UNSATISFIABLE"
              ? `reescreva esse critério para afirmar o que é verdade segundo as decisões — inclusive a ausência, quando for o caso. Mexa só nele; o resto da fase está aprovado. O critério atual é: "${criterion.text}"`
              : `troque esse critério por uma condição observável: um arquivo, um comando e sua saída, um teste nomeado, um campo presente. Mexa só nele; o resto da fase está aprovado. O critério atual é: "${criterion.text}"`,
        })),
        maxAuditReturns + round + 1,
      );
    }

    return { content: authored.content };
  }

  /**
   * O ensaio vai em lotes pequenos.
   *
   * Primeiro tentei um lote por fase, e o piloto 3 mostrou que ainda era grande:
   * a fase 1 tinha 51 critérios e voltou inteira sem julgamento, duas vezes, num
   * run em que as outras seis passaram. Pedir cinquenta linhas exatas é pedir
   * para o modelo derivar no meio — e derivar, aqui, conta como bloqueio.
   *
   * O corte é por TAMANHO, respeitando a fronteira da fase quando ela cabe. Uma
   * fase grande vira dois ou três lotes; nenhuma resposta precisa carregar mais
   * do que cabe com folga.
   */
  async function judgeAll(
    criteria: CriterionRef[],
    writer: WriterContext,
    upstream: { name: string; content: string }[],
    round: number,
  ): Promise<{ blocking: RehearsalResult["blocking"]; unrehearsed: CriterionRef[] }> {
    const lotes = agruparCriterios(criteria);
    announce(`  ensaiando ${criteria.length} critério(s) em ${lotes.length} lote(s), até ${maxParallelParts} por vez`);

    const resultados: { blocking: RehearsalResult["blocking"]; unrehearsed: CriterionRef[] }[] = [];
    const fila = [...lotes];
    const trabalhadores = Array.from({ length: Math.min(maxParallelParts, fila.length) }, async () => {
      for (;;) {
        const proximo = fila.shift();
        if (!proximo) return;
        resultados.push(await judge(proximo, writer, upstream, round));
      }
    });
    await Promise.all(trabalhadores);

    return {
      blocking: resultados.flatMap((resultado) => resultado.blocking),
      unrehearsed: resultados.flatMap((resultado) => resultado.unrehearsed),
    };
  }

  /** Lotes de no máximo `maxCriteriosPorLote`, sem misturar fases. */
  function agruparCriterios(criteria: CriterionRef[]): CriterionRef[][] {
    const porFase = new Map<number, CriterionRef[]>();
    for (const criterion of criteria) {
      const lote = porFase.get(criterion.phase) ?? [];
      lote.push(criterion);
      porFase.set(criterion.phase, lote);
    }

    const lotes: CriterionRef[][] = [];
    for (const [, daFase] of [...porFase.entries()].sort(([esquerda], [direita]) => esquerda - direita)) {
      for (let inicio = 0; inicio < daFase.length; inicio += maxCriteriosPorLote) {
        lotes.push(daFase.slice(inicio, inicio + maxCriteriosPorLote));
      }
    }
    return lotes;
  }

  /**
   * Uma passada do ensaio, com uma segunda chance para o que ficou sem linha.
   *
   * Omissão é erro de formatação, não veredito: vale relembrar os endereços
   * antes de tratar silêncio como reprovação.
   */
  async function judge(
    criteria: CriterionRef[],
    writer: WriterContext,
    upstream: { name: string; content: string }[],
    round: number,
  ) {
    const prompt = rehearsalPrompt({
      language: options.language,
      request: options.request.text,
      decisions: writer.decisions,
      upstream,
      criteria,
    });

    const verdicts = parseRehearsal(
      await track({ role: "verifier", stage: "verify", subject: "project-phases.md", attempt: round, prompt }),
    );
    let assessment = assessRehearsal(criteria, verdicts);
    if (assessment.unrehearsed.length === 0) return assessment;

    const corrective = [
      prompt,
      "",
      "## The previous answer left criteria unjudged",
      "Emit one line for EACH address below, in this order, and nothing else.",
      ...assessment.unrehearsed.map((criterion) => `${criterion.address} ${criterion.text}`),
    ].join("\n");

    const completed = parseRehearsal(
      await track({ role: "verifier", stage: "verify", subject: "project-phases.md", attempt: round, prompt: corrective }),
    );
    assessment = assessRehearsal(criteria, [...verdicts, ...completed]);
    return assessment;
  }

  async function auditLoop(
    document: string,
    initial: Authored,
    writer: WriterContext,
    upstream: { name: string; content: string }[],
  ): Promise<{ content: string; remarks: Remark[]; authored: Authored }> {
    let authored = initial;
    const history: AuditAttempt[] = [];
    // Uma vez que o desenvolvedor decidiu, ele decidiu. Voltar a perguntar a cada
    // nova devolução do auditor transforma a autoridade dele em sugestão, e foi
    // o que o piloto 1 fez: o mesmo documento pediu decisão três vezes.
    let developerRuled = false;

    /*
     * O laço precisa caber os DOIS orçamentos.
     *
     * Quando o defeito mecânico ganhou contagem própria, o teto do laço continuou
     * sendo o do auditor: três devoluções mecânicas mais uma do auditor já
     * estouravam a volta e o run morria com "o ciclo não convergiu" — sem impasse,
     * sem pergunta, sem documento. Foi assim que a medição de 95 minutos terminou.
     */
    for (let attempt = 1; attempt <= maxAuditReturns + maxMechanicalRounds + 1; attempt += 1) {
      const content = authored.content;
      const verdict = await auditOnce(document, content, writer, upstream, attempt);
      history.push({ attempt, verdict, writerSummary: `tentativa ${attempt}: escreveu ${document}` });

      const action = nextAuditAction({ document, history, maxReturns: maxAuditReturns, maxMechanical: maxMechanicalRounds });
      if (action.action === "publish") return { content, remarks: verdict.remarks, authored };

      if (action.action === "ask-developer" && developerRuled) {
        // Findings que sobrevivem à decisão do desenvolvedor não bloqueiam: eles
        // viram ressalva no relatório, onde ficam visíveis sem travar o run.
        announce(`  publicando ${document} sob a decisão do desenvolvedor; ${verdict.findings.length} finding(s) viram ressalva`);
        await event("audit", document, "complete", "publicado sob decisão do desenvolvedor", attempt);
        return {
          content,
          authored,
          remarks: [
            ...verdict.remarks,
            ...verdict.findings.map((finding) => ({
              where: finding.where,
              observation: `${finding.problem} (mantido por decisão do desenvolvedor)`,
            })),
          ],
        };
      }

      if (action.action === "ask-developer") {
        const rendered = renderStandoff(action.standoff);
        await event("audit", document, "blocked", "teto de devoluções esgotado", attempt);
        if (!options.decideStandoff) throw new InitBlockedError(rendered, runId);

        const decision = (await options.decideStandoff(rendered)).trim();
        const normalized = decision.toLowerCase();

        if (normalized.startsWith("publicar")) return { content, remarks: verdict.remarks, authored };
        if (normalized.startsWith("abortar")) {
          throw new InitBlockedError(`${rendered}\n\nDecisão do desenvolvedor: abortar`, runId);
        }

        /*
         * Não-resposta não é decisão.
         *
         * O que vem daqui é gravado como autoridade ACIMA do auditor, então
         * "não sei", "tanto faz" e "use as recomendações" não podem entrar por
         * esse caminho: num impasse não há recomendação — há o que o auditor
         * exige e o que o escritor escreveu, que não convergiram.
         *
         * O piloto 5 mostrou o estrago: "use as recomendações" virou "decisão do
         * desenvolvedor" e silenciou um finding que dizia, com razão, que a fase
         * tinha inventado escopo que ninguém pediu. O run publica do mesmo jeito
         * — parar aqui custaria o run inteiro por uma pergunta sem dono — mas a
         * ressalva sai dizendo que NINGUÉM decidiu, que é a verdade.
         */
        if (isNonAnswer(decision)) {
          announce(`  ninguém decidiu o impasse; publicando com ${verdict.findings.length} ressalva(s) em aberto`);
          await event("audit", document, "complete", "publicado sem decisão do desenvolvedor", attempt);
          return {
            content,
            authored,
            remarks: [
              ...verdict.remarks,
              ...verdict.findings.map((finding) => ({
                where: finding.where,
                observation: `${finding.problem} (o auditor insistiu e ninguém decidiu: segue em aberto)`,
              })),
            ],
          };
        }

        // A resposta do desenvolvedor É a decisão: ela volta ao escritor como
        // autoridade, acima do auditor. Perguntar "o que vale?" e descartar a
        // resposta é pior do que não ter perguntado.
        developerRuled = true;
        await recordDeveloperDecision(document, action.standoff.auditorInsists, decision);
        await event("audit", document, "retry", `decisão do desenvolvedor: ${decision}`, attempt);
        announce(`  decisão aplicada; reescrevendo ${document}`);
        authored = await authored.rewrite(
          [
            {
              where: document,
              problem: `o auditor e o escritor não convergiram em ${action.standoff.returns} devoluções`,
              fix: `o desenvolvedor decidiu e esta decisão é a autoridade, acima do auditor: ${decision}`,
            },
            ...action.standoff.auditorInsists,
          ],
          attempt + 1,
        );
        continue;
      }

      await event("audit", document, "retry", action.findings.map((finding) => finding.problem).join("; "), attempt);
      announce(`  auditor devolveu ${document} (${action.findings.length} finding)`);

      authored = await authored.rewrite(action.findings, action.attempt);
    }

    throw new InitBlockedError(`o ciclo de auditoria de ${document} não convergiu`, runId);
  }

  async function auditOnce(
    document: string,
    content: string,
    writer: WriterContext,
    upstream: { name: string; content: string }[],
    attempt: number,
  ): Promise<AuditVerdict> {
    // Self-check mecânico antes do auditor: erro de forma não custa modelo.
    if (document === "project-phases.md") {
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
            findings: semCobertura.map((erro) => ({
              where: "Traces",
              problem: erro.message,
              fix: erro.hint,
            })),
            remarks: [],
            reason: "há item do esqueleto que nenhuma task rastreia",
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
            .map((task) => ({ phase: phase.number, task })),
        );
        if (inchadas.length > 0) {
          return {
            status: "REJECTED",
            findings: inchadas.map(({ phase, task }) => ({
              where: `Phase ${phase} · ${task.title}`,
              problem: `a task declara ${task.acceptanceCriteria.length} critérios de aceite`,
              fix:
                `uma task com mais de ${MAX_CRITERIA_PER_TASK} critérios está fazendo mais de uma coisa: divida-a em tasks` +
                ` que façam uma coisa cada, com dois ou três critérios. Nenhuma condição verificável pode desaparecer no corte`,
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
              problem:
                phase.tasks.length > MAX_TASKS_PER_PHASE
                  ? `a fase declara ${phase.tasks.length} tasks e uma fase é uma sessão de agente`
                  : `a fase declara ${criterios(phase)} critérios de aceite em ${phase.tasks.length} tasks, e uma fase é uma sessão de agente`,
              fix:
                phase.tasks.length > MAX_TASKS_PER_PHASE
                  ? `divida em mais fases de topo até nenhuma passar de ${MAX_TASKS_PER_PHASE} tasks, preservando a ordem de dependências`
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
        return {
          status: "REJECTED",
          findings: substanceDefects(parsed.errors).map((error) => ({
            where: `linha ${error.line}`,
            problem: `${error.code}: ${error.message}`,
            fix: error.hint,
          })),
          remarks: [],
          reason: "o plano não passa no contrato",
        };
      }
    }

    /*
     * O plano é auditado em duas perguntas, não numa só.
     *
     * Medido no piloto 3: auditoria e reescritas foram 41 dos 65 minutos, e a
     * primeira leitura do plano de 68 KB levou seis minutos sozinha. A pergunta
     * local — esta fase está fiel, seus critérios são observáveis — só precisa da
     * fase, então vira N chamadas paralelas e uma devolução custa uma fase
     * relida. A pergunta global continua vendo tudo, porque contradição entre
     * fases é o defeito que ninguém mais pega.
     */
    if (document === "project-phases.md" && parsePhases(content).ok) {
      return await auditPlanInParts(content, writer, upstream, attempt);
    }

    for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
      const output = await track({
        role: "auditor",
        stage: "audit",
        subject: document,
        attempt,
        prompt: auditorPrompt({
          language: options.language,
          document,
          executable: document === "project-phases.md",
          request: options.request.text,
          decisions: writer.decisions,
          dispositions: allAnswers.map((answer) => `${answer.questionId} ${answer.disposition}`),
          upstream,
          // Ressalva que atravessa a cadeia sem ser resolvida vira defeito que o
          // loop paga: no piloto 2, "a ausência de dependências não é
          // explicitada" custou três ciclos e parou o run três fases depois.
          upstreamRemarks: remarks.map((entry) => ({
            document: entry.document,
            where: entry.remark.where,
            observation: entry.remark.observation,
          })),
          content,
        }),
      });
      const parsed = parseAudit(output);
      // Saída inválida repete SÓ o auditor, sobre a mesma evidência.
      if (parsed.ok) return parsed.verdict;
      if (tentativa === 2) {
        throw new InitBlockedError(`o auditor de ${document} devolveu saída inválida duas vezes: ${parsed.defects.join("; ")}`, runId);
      }
    }
    throw new InitBlockedError("inalcançável", runId);
  }

  return await concluir();

  /**
   * O fecho, comum aos dois caminhos.
   *
   * Os portões são os mesmos: o que decide se a documentação serve é o loop
   * conseguir executá-la, e isso não muda com a forma como ela foi produzida.
   */
  async function concluir(): Promise<InitOutcome> {
    const parsedPhases = parsePhases(plano);
    const coverage = coberturaAtual();

    const readiness = evaluateReadiness({
      plan: plano,
      // O plano é carimbado com o que ele leu, e o que ele leu é o esqueleto:
      // é o único upstream que existe no ciclo.
      stampInputs: skeletonAtual ? [{ name: "skeleton.md", content: renderSkeleton(skeletonAtual) }] : [],
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
      rehearsal,
    });

    const tasks = parsedPhases.ok ? parsedPhases.document.phases.reduce((total, phase) => total + phase.tasks.length, 0) : 0;

    const report: InitReport = {
      ready: readiness.ready,
      published: INIT_ARTIFACTS.map((name) => `${artifactPaths(options.projectRoot).init}/${name}`),
      phases: parsedPhases.ok ? parsedPhases.document.phases.length : 0,
      tasks,
      mvpCutPhase: parsedPhases.ok ? parsedPhases.document.phases.length : 0,
      coverage: { stories: coverage.storyIds.length, entities: coverage.entities.length, workflows: coverage.workflows.length },
      checkpoint: buildCheckpoint({ round: maxInterviewRounds, questions: allQuestions, answers: allAnswers, assumptions: allAssumptions, maxRounds: maxInterviewRounds }),
      remarks,
      costs: [...costs.values()],
      readiness,
    };

    await writeRunState(options.projectRoot, { ...state, stage: readiness.ready ? "ready" : "publish", status: readiness.ready ? "complete" : "blocked" }, now);
    await event(readiness.ready ? "ready" : "publish", "-", readiness.ready ? "complete" : "blocked", readiness.ready ? "RALPH READY" : "NOT READY");


    return { runId, readiness, report, rendered: renderReport(report) };
  }
}

export { sha12 };
