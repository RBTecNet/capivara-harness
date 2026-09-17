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

import { assemblePhasesDocument, buildStamp, extractEntities, extractStoryIds, extractWorkflows, parsePhases, sha12 } from "../contract/index.js";
import type { StampInput } from "../contract/index.js";
import { DEFAULT_MAX_RETURNS, nextAuditAction, parseAudit, renderStandoff } from "../audit/index.js";
import type { AuditAttempt, AuditVerdict, Finding, Remark } from "../audit/index.js";
import { allocateParts, isRepairable, parseLedger, publish, repairDeterministically, stage, substanceDefects } from "../authoring/index.js";
import { buildAnswer, buildCheckpoint, classifyLocally, needsDecisionMarkers, parseClassification, parseQuestionBatch, planRound, unresolved, writeHandoff } from "../interview/index.js";
import type { Answer, Question } from "../interview/index.js";
import { auditorPrompt, gapPrompt, interviewPrompt, ledgerPrompt, phasePartPrompt, rewriteInstruction, writerPrompt } from "../prompts/index.js";
import type { DocumentName, WriterContext } from "../prompts/index.js";
import { appendEvent, artifactPaths, createRunState, ensureArtifactTree, runIdFor, runPaths, writeRunState } from "../state/index.js";
import type { RunStage } from "../state/index.js";
import { inspectProject, summarizeInventory } from "./inventory.js";
import { DOCUMENT_CHAIN, evaluateReadiness } from "./readiness.js";
import type { ChainDocument, Readiness } from "./readiness.js";
import type { DeveloperRequest } from "./request.js";
import { checkDocumentShape } from "./selfcheck.js";
import { renderReport, type InitReport, type RoleCost } from "./report.js";

export interface AgentCall {
  role: "writer" | "auditor";
  stage: RunStage;
  subject: string;
  attempt: number;
  prompt: string;
}

export type AgentCaller = (call: AgentCall) => Promise<{ stdout: string; exitCode: number }>;
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
function scoped(document: string, questionId: string): string {
  return `${document}#${questionId}`;
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

  const runId = runIdFor("init", options.request.sha12);
  const paths = runPaths(options.projectRoot, runId);
  await ensureArtifactTree(options.projectRoot);
  const state = createRunState({ runId, command: "init", language: options.language, now });
  await writeRunState(options.projectRoot, state, now);

  const costs = new Map<string, RoleCost>();
  const track = async (call: AgentCall): Promise<string> => {
    const startedAt = Date.now();
    const response = await options.call(call);
    const cost = costs.get(call.role) ?? { role: call.role, calls: 0, inputTokens: null, outputTokens: null, milliseconds: 0 };
    cost.calls += 1;
    cost.milliseconds += Date.now() - startedAt;
    costs.set(call.role, cost);
    if (response.exitCode !== 0) {
      throw new InitBlockedError(`o papel ${call.role} falhou com código ${response.exitCode} em ${call.subject}`, runId);
    }
    return response.stdout;
  };

  const event = async (stage: RunStage, subject: string, status: "started" | "complete" | "retry" | "blocked", detail = "", attempt = 1): Promise<void> => {
    await appendEvent(paths.events, { timestamp: now().toISOString(), stage, subject, attempt, status, detail });
  };

  const inventory = await inspectProject(options.projectRoot);
  const inventoryText = summarizeInventory(inventory);
  announce(inventory.empty ? "Projeto vazio: greenfield." : `Inventário: ${inventory.files.length} arquivo(s).`);

  const published: Partial<Record<ChainDocument, string>> = {};
  const approved: ChainDocument[] = [];
  const allAnswers: Answer[] = [];
  const allQuestions: Question[] = [];
  const remarks: { document: string; remark: Remark }[] = [];

  for (const document of DOCUMENT_CHAIN) {
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
    published[document] = verdict.content;
    approved.push(document);
    remarks.push(...verdict.remarks.map((remark) => ({ document, remark })));

    await publish(options.projectRoot, [{ name: document, content: verdict.content }]);
    await event("publish", document, "complete");
    announce(`  publicado: ${document}`);
  }

  async function interview(document: ChainDocument, upstream: { name: string; content: string }[]) {
    const questions: Question[] = [];
    const answers: Answer[] = [];

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
        const local = classifyLocally(question, raw);
        const classification = local.settled
          ? local
          : await classifyWithModel(document, question, raw, round);
        answers.push(buildAnswer(question, raw, classification, round, now));
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

  async function classifyWithModel(document: ChainDocument, question: Question, raw: string, round: number) {
    const output = await track({
      role: "auditor",
      stage: "interview",
      subject: `${document}:${question.id}`,
      attempt: round,
      prompt: [
        `Classify the developer's answer. Reply with exactly one line and nothing else:`,
        `CAPIVARA_ANSWER: ${question.id} | <ACCEPTED|PARTIAL|AMBIGUOUS|DEFERRED|CONTRADICTED> | <normalized decision, or what is still missing>`,
        "",
        "ACCEPTED requires one single material interpretation that answers the decision asked.",
        "Never add precision the answer did not supply.",
        "",
        `Question: ${question.decision}`,
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

    const parts = allocateParts(ledger.ledger);
    const phases: string[] = [];
    for (const part of parts) {
      announce(`  parte ${part.id}`);
      const entry = ledger.ledger.phases.find((phase) => phase.number === part.phaseNumber);
      const output = await track({
        role: "writer",
        stage: "authoring",
        subject: part.id,
        attempt: 1,
        prompt: phasePartPrompt({ ...writer, phaseNumber: part.phaseNumber, ledgerEntry: JSON.stringify(entry) }),
      });
      phases.push(repairDeterministically(output).content.trim());
      await event("authoring", part.id, "complete");
    }

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
          next[phaseNumber - 1] = repairDeterministically(output).content.trim();
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
  async function closeGaps(document: ChainDocument, initial: Authored, writer: WriterContext): Promise<Authored> {
    let authored = initial;

    for (let round = 1; round <= maxGapRounds; round += 1) {
      const markers = [...authored.content.matchAll(/\[NEEDS DECISION\]\s*(.+)/g)]
        .map((match) => (match[1] ?? "").trim())
        .filter((marker) => marker !== "");
      if (markers.length === 0) return authored;

      announce(`  ${markers.length} decisão(ões) pendente(s) em ${document}; reabrindo a entrevista`);
      await event("interview", document, "retry", `${markers.length} gap(s) descobertos na escrita`, round);

      const batch = parseQuestionBatch(
        await track({ role: "writer", stage: "interview", subject: `${document}:gaps`, attempt: round, prompt: gapPrompt(document, writer, markers) }),
      );
      if (!batch.ok || batch.questions.length === 0) return authored;

      const answered: Answer[] = [];
      let index = 0;
      for (const question of batch.questions) {
        index += 1;
        const raw = await options.ask(question, index, batch.questions.length);
        const local = classifyLocally(question, raw);
        const classification = local.settled ? local : await classifyWithModel(document, question, raw, round);
        answered.push(buildAnswer(question, raw, classification, round, now));
      }

      allQuestions.push(...batch.questions.map((question) => ({ ...question, id: scoped(document, question.id) })));
      allAnswers.push(...answered.map((answer) => ({ ...answer, questionId: scoped(document, answer.questionId) })));

      const accepted = answered.filter((answer) => answer.disposition === "ACCEPTED");
      if (accepted.length === 0) return authored;

      writer.decisions = allAnswers.filter((answer) => answer.disposition === "ACCEPTED").map((answer) => answer.decision);

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
    }

    return authored;
  }

  async function auditLoop(
    document: ChainDocument,
    initial: Authored,
    writer: WriterContext,
    upstream: { name: string; content: string }[],
  ): Promise<{ content: string; remarks: Remark[] }> {
    let authored = initial;
    const history: AuditAttempt[] = [];

    for (let attempt = 1; attempt <= maxAuditReturns + 1; attempt += 1) {
      const content = authored.content;
      const verdict = await auditOnce(document, content, writer, upstream, attempt);
      history.push({ attempt, verdict, writerSummary: `tentativa ${attempt}: escreveu ${document}` });

      const action = nextAuditAction({ document, history, maxReturns: maxAuditReturns });
      if (action.action === "publish") return { content, remarks: verdict.remarks };

      if (action.action === "ask-developer") {
        const rendered = renderStandoff(action.standoff);
        await event("audit", document, "blocked", "teto de devoluções esgotado", attempt);
        if (!options.decideStandoff) throw new InitBlockedError(rendered, runId);
        const decision = await options.decideStandoff(rendered);
        if (decision.trim().toLowerCase().startsWith("publicar")) return { content, remarks: verdict.remarks };
        throw new InitBlockedError(`${rendered}\n\nDecisão do desenvolvedor: ${decision}`, runId);
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
