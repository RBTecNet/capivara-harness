/**
 * A máquina de estados do `capivara init`.
 *
 * Para cada documento da cadeia: entrevista → escrita → self-check mecânico →
 * auditoria → publicação. O plano executável é a exceção: ele é escrito em
 * partes, uma fase por chamada, e montado em código.
 *
 * Toda dependência externa entra por parâmetro — a chamada ao modelo e a
 * pergunta ao desenvolvedor. Isso é o que permite exercitar o init inteiro, do
 * pedido ao gate, sem tocar em provider real.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assemblePhasesDocument, buildStamp, extractEntities, extractStoryIds, extractWorkflows, normalizePhasePart, parsePhases, sha12 } from "../contract/index.js";
import type { StampInput } from "../contract/index.js";
import { DEFAULT_MAX_RETURNS, nextAuditAction, parseAudit, renderStandoff } from "../audit/index.js";
import type { AuditAttempt, AuditVerdict, Finding, Remark } from "../audit/index.js";
import { MAX_TASKS_PER_PHASE, allocateParts, isRepairable, parseLedger, publish, repairDeterministically, stage, stripResolvedMarkers, substanceDefects } from "../authoring/index.js";
import { buildAnswer, buildCheckpoint, classifyLocally, needsDecisionMarkers, parseClassification, parseQuestionBatch, planRound, readHandoff, unresolved, writeHandoff } from "../interview/index.js";
import type { Answer, Question } from "../interview/index.js";
import { assessRehearsal, auditorPrompt, languageBlock, enumerateCriteria, gapPrompt, interviewPrompt, ledgerPrompt, parseRehearsal, phasePartPrompt, rehearsalPrompt, rewriteInstruction, writerPrompt } from "../prompts/index.js";
import type { AskedQuestion, CriterionRef, DocumentName, WriterContext } from "../prompts/index.js";
import { appendEvent, artifactPaths, createRunState, ensureArtifactTree, readEvents, runIdFor, runPaths, writeRunState } from "../state/index.js";
import type { RunStage } from "../state/index.js";
import { inspectProject, summarizeInventory } from "./inventory.js";
import { DOCUMENT_CHAIN, evaluateReadiness } from "./readiness.js";
import type { ChainDocument, Readiness } from "./readiness.js";
import type { DeveloperRequest } from "./request.js";
import { checkDocumentShape } from "./selfcheck.js";
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
  /** Ignora o que este run já publicou e recomeça a cadeia do zero. */
  fresh?: boolean;
  /** Fases escritas ao mesmo tempo. Elas são independentes; o teto é de cortesia. */
  maxParallelParts?: number;
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

  const published: Partial<Record<ChainDocument, string>> = {};
  const approved: ChainDocument[] = [];
  const allAnswers: Answer[] = [];
  const allQuestions: Question[] = [];
  const remarks: { document: string; remark: Remark }[] = [];
  /** Ausente até o ensaio rodar; o gate trata ausência como reprovação. */
  let rehearsal: { blocked: string[] } | undefined;

  /*
   * O que ESTE run já publicou não se repete.
   *
   * O piloto 3 perdeu vinte e três respostas dadas à mão porque uma chamada
   * estourou o tempo no terceiro documento: os dois primeiros já estavam
   * publicados em disco, as respostas do terceiro já estavam no handoff, e mesmo
   * assim a única saída era recomeçar do zero. Perguntar duas vezes a mesma coisa
   * é a forma mais rápida de perder quem responde.
   *
   * O reaproveitamento é estreito de propósito: só vale para o mesmo run — e o id
   * do run é o hash do pedido, então mudar o pedido muda o run e nada é herdado.
   */
  const jaPublicados = new Set<string>(
    options.fresh === true
      ? []
      : (await readEvents(paths.events))
          .filter((entry) => entry.stage === "publish" && entry.status === "complete")
          .map((entry) => entry.subject),
  );

  for (const document of DOCUMENT_CHAIN) {
    if (jaPublicados.has(document)) {
      const conteudo = await readFile(join(artifactPaths(options.projectRoot).init, document), "utf8").catch(() => "");
      const handoff = await readHandoff(options.projectRoot, runId, document);
      if (conteudo.trim() !== "") {
        published[document] = conteudo;
        approved.push(document);
        // As decisões precisam descer a cadeia: um documento reaproveitado sem
        // as respostas que o geraram deixaria os seguintes sem contexto.
        if (handoff) {
          allAnswers.push(...handoff.answers.map((answer) => ({ ...answer, questionId: scoped(document, answer.questionId) })));
          allQuestions.push(...handoff.questions.map((question) => ({ ...question, id: scoped(document, question.id) })));
        }
        announce(`— ${document} (reaproveitado deste run; --fresh recomeça do zero)`);
        continue;
      }
    }

    announce(`— ${document}`);
    await event("interview", document, "started");

    const upstream = DOCUMENT_CHAIN.filter((name) => name !== document && published[name] !== undefined)
      .filter((name) => DOCUMENT_CHAIN.indexOf(name) < DOCUMENT_CHAIN.indexOf(document))
      .map((name) => ({ name, content: published[name] ?? "" }));

    const answers = await interview(document, upstream);
    allAnswers.push(...answers.answers.map((answer) => ({ ...answer, questionId: scoped(document, answer.questionId) })));
    allQuestions.push(...answers.questions.map((question) => ({ ...question, id: scoped(document, question.id) })));

    const writer: WriterContext = {
      language: options.language,
      request: options.request.text,
      decisions: allAnswers.filter((answer) => answer.disposition === "ACCEPTED").map((answer) => answer.decision),
      assumptions: [],
      upstream,
      ...(stampFor(document, published) !== null ? { stamp: stampFor(document, published) as string } : {}),
    };

    await event("authoring", document, "started");
    const authored = document === "project-phases.md" ? await writePhases(writer) : await writeSimple(document, writer);

    const closed = await closeGaps(document, authored, writer);

    await event("audit", document, "started");
    const verdict = await auditLoop(document, closed, writer, upstream);
    remarks.push(...verdict.remarks.map((remark) => ({ document, remark })));

    // O plano aprovado ainda não é um plano implementável: quem decide isso é
    // quem vai julgar cada task no build, e ele é chamado aqui.
    const final =
      document === "project-phases.md" ? await rehearse(verdict.authored, writer, upstream) : { content: verdict.content };

    published[document] = final.content;
    approved.push(document);

    await publish(options.projectRoot, [{ name: document, content: final.content }]);
    await event("publish", document, "complete");
    announce(`  publicado: ${document}`);
  }

  async function interview(document: ChainDocument, upstream: { name: string; content: string }[]) {
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
    }

    for (let round = 1; round <= maxInterviewRounds; round += 1) {
      const writer: WriterContext = {
        language: options.language,
        request: options.request.text,
        decisions: allAnswers.filter((answer) => answer.disposition === "ACCEPTED").map((answer) => answer.decision),
        assumptions: [],
        upstream,
      };
      // Já respondido inclui os documentos anteriores da cadeia. Sem isso, cada
      // documento reabre a mesma decisão: no piloto 1 a stack foi perguntada
      // quatro vezes, com quatro nomes diferentes.
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
    document: ChainDocument,
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

  async function classifyWithModel(document: ChainDocument, question: Question, raw: string, round: number) {
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

  async function writeSimple(document: ChainDocument, writer: WriterContext): Promise<Authored> {
    const output = await track({
      role: "writer",
      stage: "authoring",
      subject: document,
      attempt: 1,
      prompt: writerPrompt(document as Exclude<DocumentName, "project-phases.md">, writer),
    });
    const repaired = repairDeterministically(output, writer.stamp);
    const defects = checkDocumentShape(document, repaired.content);
    if (defects.length > 0) {
      const retry = await track({
        role: "writer",
        stage: "self-check",
        subject: document,
        attempt: 2,
        prompt: [
          writerPrompt(document as Exclude<DocumentName, "project-phases.md">, writer),
          "",
          "## The previous attempt failed the mechanical self-check",
          ...defects.map((defect) => `- ${defect.problem}\n  what to do: ${defect.hint}`),
        ].join("\n"),
      });
      return simple(document, writer, repairDeterministically(retry, writer.stamp).content);
    }
    return simple(document, writer, repaired.content);
  }

  function simple(document: ChainDocument, writer: WriterContext, content: string): Authored {
    return {
      content,
      rewrite: async (findings, attempt) => {
        const rewritten = await track({
          role: "writer",
          stage: "authoring",
          subject: document,
          attempt,
          prompt: [
            writerPrompt(document as Exclude<DocumentName, "project-phases.md">, writer),
            "",
            rewriteInstruction(findings),
            "",
            "## The version you must fix",
            content,
          ].join("\n"),
        });
        return simple(document, writer, repairDeterministically(rewritten, writer.stamp).content);
      },
    };
  }

  async function writePhases(writer: WriterContext): Promise<Authored> {
    const ledgerOutput = await track({ role: "writer", stage: "authoring", subject: "ledger", attempt: 1, prompt: ledgerPrompt(writer) });
    const ledger = parseLedger(ledgerOutput);
    if (!ledger.ok) {
      throw new InitBlockedError(`o ledger de coordenação veio inválido: ${ledger.defects.map((defect) => defect.problem).join("; ")}`, runId);
    }

    /*
     * As fases são escritas em paralelo porque são independentes por construção.
     * O ledger aloca todas ANTES de a primeira ser escrita, e nenhuma parte lê o
     * texto de outra: a coordenação entre elas já está decidida no ledger, que é
     * exatamente o motivo de ele existir.
     *
     * No piloto 3 isso custou 29 minutos de fila para sete fases que ninguém
     * estava esperando. A ordem do documento é preservada pelo índice, não pelo
     * relógio — quem termina primeiro não fura a fila do texto final.
     */
    const parts = allocateParts(ledger.ledger);
    const phases: string[] = new Array<string>(parts.length).fill("");

    const escreverParte = async (part: (typeof parts)[number], posicao: number): Promise<void> => {
      const entry = ledger.ledger.phases.find((phase) => phase.number === part.phaseNumber);
      const output = await track({
        role: "writer",
        stage: "authoring",
        subject: part.id,
        attempt: 1,
        prompt: phasePartPrompt({ ...writer, phaseNumber: part.phaseNumber, ledgerEntry: JSON.stringify(entry) }),
      });
      const normalized = normalizePhasePart(repairDeterministically(output).content, {
        phaseNumber: part.phaseNumber,
        dependsOn: entry?.dependsOn || "none",
      });
      for (const fix of normalized.applied) announce(`    ${part.id}: ${fix}`);
      phases[posicao] = normalized.markdown.trim();
      announce(`  ${part.id} pronta`);
      await event("authoring", part.id, "complete");
    };

    announce(`  escrevendo ${parts.length} fase(s), até ${maxParallelParts} por vez`);
    const fila = parts.map((part, posicao) => ({ part, posicao }));
    const trabalhadores = Array.from({ length: Math.min(maxParallelParts, fila.length) }, async () => {
      for (;;) {
        const proxima = fila.shift();
        if (!proxima) return;
        await escreverParte(proxima.part, proxima.posicao);
      }
    });
    await Promise.all(trabalhadores);

    // As decisões em aberto entram como prosa em `## Open Questions`, NUNCA com
    // o marcador [NEEDS DECISION]: o invariante I-13 recusa esse marcador no
    // documento, e injetá-lo aqui produziria um plano que o próprio contrato
    // rejeita. Quem bloqueia a prontidão é o gate, que recebe os mesmos itens.
    const openQuestions = unresolved({
      round: maxInterviewRounds,
      questions: allQuestions,
      answers: allAnswers,
      assumptions: [],
      maxRounds: maxInterviewRounds,
    }).map((item) => `${item.topic}: ${item.statement}`);

    const overview = `${ledger.ledger.phases.length} fases, fundação primeiro. O MVP fecha na fase ${ledger.ledger.mvpCutPhase}.`;

    /**
     * A reescrita do plano NUNCA pode passar pelo prompt de parte sem remontar.
     *
     * O piloto 1 provou por quê: o prompt de parte manda escrever uma fase e
     * proibir o cabeçalho, então a resposta do modelo substituiu o documento
     * inteiro por uma fase só, sem título — e o parser reprovou o que o auditor
     * tinha acabado de aprovar. Aqui a devolução reescreve APENAS as fases que
     * os findings nomeiam, e o documento é remontado em código, como sempre.
     */
    const build = (current: string[]): Authored => ({
      content: assemblePhasesDocument({ projectName: projectName(published), stamp: writer.stamp ?? "", overview, phases: current, openQuestions }),
      rewrite: async (findings, attempt) => {
        const targeted = affectedPhases(findings, parts.length);
        announce(`  reescrevendo ${targeted.length} de ${parts.length} fase(s)`);
        const next = [...current];
        for (const phaseNumber of targeted) {
          const part = parts.find((entry) => entry.phaseNumber === phaseNumber);
          if (!part) continue;
          const entry = ledger.ledger.phases.find((phase) => phase.number === phaseNumber);
          const output = await track({
            role: "writer",
            stage: "authoring",
            subject: part.id,
            attempt,
            prompt: [
              phasePartPrompt({ ...writer, phaseNumber, ledgerEntry: JSON.stringify(entry) }),
              "",
              rewriteInstruction(findings),
              "",
              `## The version of phase ${phaseNumber} you must fix`,
              current[phaseNumber - 1] ?? "",
            ].join("\n"),
          });
          next[phaseNumber - 1] = normalizePhasePart(repairDeterministically(output).content, {
            phaseNumber,
            dependsOn: entry?.dependsOn || "none",
          }).markdown.trim();
        }
        return build(next);
      },
    });

    return build(phases);
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
  /** As perguntas deste documento e como o desenvolvedor as respondeu. */
  function perguntadas(document: ChainDocument): AskedQuestion[] {
    const prefixo = `${document}#`;
    return allAnswers
      .filter((answer) => answer.questionId.startsWith(prefixo))
      .map((answer) => {
        const pergunta = allQuestions.find((entry) => entry.id === answer.questionId);
        return {
          decision: pergunta?.decision ?? answer.questionId,
          disposition: answer.disposition,
          answer: answer.raw,
        };
      });
  }

  async function closeGaps(document: ChainDocument, initial: Authored, writer: WriterContext): Promise<Authored> {
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

      announce(`  ${markers.length} decisão(ões) pendente(s) em ${document}; reabrindo a entrevista`);
      await event("interview", document, "retry", `${markers.length} gap(s) descobertos na escrita`, round);

      const batch = parseQuestionBatch(
        await track({
          role: "writer",
          stage: "interview",
          subject: `${document}:gaps`,
          attempt: round,
          // O que já foi perguntado vai junto, com as palavras do desenvolvedor.
          // Sem isso a rodada de gaps reabre o que a entrevista fechou e chega a
          // recomendar o contrário — foi assim que o piloto 3 publicou colunas
          // gerenciáveis depois de o desenvolvedor as ter fixado.
          prompt: gapPrompt(document, writer, markers, perguntadas(document)),
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
      // as respostas da entrevista principal do mesmo documento.
      const stage = `gap${round}`;
      allQuestions.push(...batch.questions.map((question) => ({ ...question, id: scoped(document, question.id, stage) })));
      allAnswers.push(...answered.map((answer) => ({ ...answer, questionId: scoped(document, answer.questionId, stage) })));

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
      const assessment = await judge(criteria, writer, upstream, round);

      const blocked = [
        ...assessment.blocking.map(
          ({ criterion, ruling, reason }) =>
            `${criterion.address} · ${criterion.taskTitle} — ${ruling}: ${reason || criterion.text}`,
        ),
        ...assessment.unrehearsed.map(
          (criterion) => `${criterion.address} · ${criterion.taskTitle} — NÃO ENSAIADO: o verificador não julgou este critério`,
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
    document: ChainDocument,
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

    for (let attempt = 1; attempt <= maxAuditReturns + 1; attempt += 1) {
      const content = authored.content;
      const verdict = await auditOnce(document, content, writer, upstream, attempt);
      history.push({ attempt, verdict, writerSummary: `tentativa ${attempt}: escreveu ${document}` });

      const action = nextAuditAction({ document, history, maxReturns: maxAuditReturns });
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
        if (normalized.startsWith("abortar") || decision === "") {
          throw new InitBlockedError(`${rendered}\n\nDecisão do desenvolvedor: abortar`, runId);
        }

        // A resposta do desenvolvedor É a decisão: ela volta ao escritor como
        // autoridade, acima do auditor. Perguntar "o que vale?" e descartar a
        // resposta é pior do que não ter perguntado.
        developerRuled = true;
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
    document: ChainDocument,
    content: string,
    writer: WriterContext,
    upstream: { name: string; content: string }[],
    attempt: number,
  ): Promise<AuditVerdict> {
    // Self-check mecânico antes do auditor: erro de forma não custa modelo.
    if (document === "project-phases.md") {
      const parsed = parsePhases(content);

      // Dimensionamento é contável, então é contado aqui e não descoberto pelo
      // auditor três devoluções depois: uma fase é uma sessão de agente.
      if (parsed.ok) {
        const grandes = parsed.document.phases.filter((phase) => phase.tasks.length > MAX_TASKS_PER_PHASE);
        if (grandes.length > 0) {
          return {
            status: "REJECTED",
            findings: grandes.map((phase) => ({
              where: `Phase ${phase.number}`,
              problem: `a fase declara ${phase.tasks.length} tasks e uma fase é uma sessão de agente`,
              fix: `divida em mais fases de topo até nenhuma passar de ${MAX_TASKS_PER_PHASE} tasks, preservando a ordem de dependências`,
            })),
            remarks: [],
            reason: "há fase acima do que cabe numa sessão",
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

  const phasesDocument = published["project-phases.md"] ?? "";
  const parsedPhases = parsePhases(phasesDocument);
  const coverage = {
    storyIds: extractStoryIds(published["user-stories.md"] ?? ""),
    entities: extractEntities(published["database-schema.md"] ?? ""),
    workflows: extractWorkflows(published["project-description.md"] ?? ""),
    excludedWorkflows: [],
  };

  const readiness = evaluateReadiness({
    documents: published,
    stampInputs: stampInputs(published),
    coverage,
    approved,
    unresolvedQuestions: needsDecisionMarkers({
      round: maxInterviewRounds,
      questions: allQuestions,
      answers: allAnswers,
      assumptions: [],
      maxRounds: maxInterviewRounds,
    }),
    designRoot: artifactPaths(options.projectRoot).design,
    designExists: () => true,
    rehearsal,
  });

  const tasks = parsedPhases.ok ? parsedPhases.document.phases.reduce((total, phase) => total + phase.tasks.length, 0) : 0;

  const report: InitReport = {
    ready: readiness.ready,
    published: DOCUMENT_CHAIN.map((name) => `${artifactPaths(options.projectRoot).init}/${name}`),
    phases: parsedPhases.ok ? parsedPhases.document.phases.length : 0,
    tasks,
    mvpCutPhase: parsedPhases.ok ? parsedPhases.document.phases.length : 0,
    coverage: { stories: coverage.storyIds.length, entities: coverage.entities.length, workflows: coverage.workflows.length },
    checkpoint: buildCheckpoint({ round: maxInterviewRounds, questions: allQuestions, answers: allAnswers, assumptions: [], maxRounds: maxInterviewRounds }),
    remarks,
    costs: [...costs.values()],
    readiness,
  };

  await writeRunState(options.projectRoot, { ...state, stage: readiness.ready ? "ready" : "publish", status: readiness.ready ? "complete" : "blocked" }, now);
  await event(readiness.ready ? "ready" : "publish", "-", readiness.ready ? "complete" : "blocked", readiness.ready ? "RALPH READY" : "NOT READY");

  return { runId, readiness, report, rendered: renderReport(report) };
}

function stampFor(document: ChainDocument, published: Partial<Record<ChainDocument, string>>): string | null {
  const inputs = stampSources(document, published);
  return inputs.length === 0 ? null : buildStamp(inputs);
}

function stampSources(document: ChainDocument, published: Partial<Record<ChainDocument, string>>): StampInput[] {
  const order: ChainDocument[] = ["project-description.md", "user-stories.md", "database-schema.md"];
  const upTo = order.slice(0, DOCUMENT_CHAIN.indexOf(document));
  return upTo.map((name) => ({ name, content: published[name] ?? "" }));
}

function stampInputs(published: Partial<Record<ChainDocument, string>>): StampInput[] {
  return stampSources("project-phases.md", published);
}

function projectName(published: Partial<Record<ChainDocument, string>>): string {
  const title = (published["project-description.md"] ?? "").split("\n")[0] ?? "";
  return /^#\s+(.+?)\s+—/.exec(title)?.[1] ?? "Projeto";
}

export { sha12 };
