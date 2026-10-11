import { buildAnswer, classifyLocally, DELEGAR, latestAnswers, parseClassification, parseQuestionBatch } from "../interview/index.js";
import type { Answer, Assumption, Question, QuestionBatch } from "../interview/index.js";
import type { AgentCall } from "../init/index.js";
import { classificationPrompt, discoveryPrompt, draftPrompt } from "./prompts.js";
import { parsePromptDraft, renderPromptDraft } from "./protocol.js";
import { PromptEngineerError, promptLanguage } from "./types.js";
import type { EngineeredPrompt, PromptDraft, PromptEngineerOptions, PromptOpenQuestion, PromptStatement } from "./types.js";

const DEFER = "Deixar esta decisão em aberto";
const DELEGATE_TEXT = /^(?:deixe (?:o harness|a capivara|a llm) decidir por mim|decida por mim|pode decidir|delegar|delegate|you decide)\.?$/i;
const DEFER_TEXT = /^(?:deixar (?:esta decisão|em aberto)|adiar|pular|skip|later|i don['’]t know)\.?$/i;

/** Edits a prompt only: no project artifacts, execution or MCP writes happen here. */
export async function engineerPrompt(options: PromptEngineerOptions): Promise<EngineeredPrompt> {
  const language = promptLanguage(options.language);
  const maxRounds = positiveLimit(options.maxRounds ?? 3, "maxRounds");
  const maxQuestions = positiveLimit(options.maxQuestions ?? 24, "maxQuestions");
  if (!options.request.text.trim()) throw new PromptEngineerError("nenhum pedido informado para organizar", "invalid-options");
  const now = options.now ?? (() => new Date());
  const questions: Question[] = [];
  const answers: Answer[] = [];
  const assumptions: Assumption[] = [];
  const delegated = new Set<string>();
  let rounds = 0;
  let asked = 0;
  let discoveryComplete = false;
  let limitReached = false;

  for (let round = 1; round <= maxRounds; round += 1) {
    rounds = round;
    options.announce?.(`Prompt Engineer: analisando lacunas (rodada ${round}/${maxRounds}).`);
    const base = discoveryPrompt(options, questions, answers, assumptions, round);
    let batch = parseQuestionBatch(await call("interview", "prompt-engineer", round, base));
    let defects = interviewDefects(batch);
    if (defects.length > 0) {
      batch = parseQuestionBatch(await call("interview", "prompt-engineer", round, [
        base,
        "Your previous batch was invalid. Correct these defects and return the entire JSON batch:",
        ...defects,
      ].join("\n")));
      defects = interviewDefects(batch);
    }
    if (!batch.ok || defects.length > 0) {
      throw new PromptEngineerError(`a análise de lacunas veio inválida: ${defects.join("; ")}`, "invalid-interview");
    }

    for (const assumption of batch.assumptions) {
      // Suggestions never enter the confirmed-decision ledger; the artifact labels them provisional.
      if (!assumptions.some((item) => item.statement === assumption.statement)) assumptions.push(assumption);
    }
    const latest = latestAnswers(answers);
    for (const incoming of [...batch.questions, ...batch.omissions]) {
      const exact = questions.find((question) => normalize(question.decision) === normalize(incoming.decision));
      const existing = exact ?? questions.find((question) => question.id === incoming.id);
      if (existing) {
        const previous = latest.get(existing.id);
        if (previous?.disposition === "ACCEPTED" || previous?.disposition === "DEFERRED" || delegated.has(existing.id)) continue;
        questions[questions.indexOf(existing)] = { ...incoming, id: existing.id };
      } else questions.push(incoming);
    }

    const pending = questions.filter((question) => {
      const answer = latest.get(question.id);
      return !delegated.has(question.id) && (!answer || (answer.disposition !== "ACCEPTED" && answer.disposition !== "DEFERRED"));
    });
    if (pending.length === 0) {
      discoveryComplete = true;
      break;
    }
    for (let index = 0; index < pending.length; index += 1) {
      if (asked >= maxQuestions) {
        limitReached = true;
        break;
      }
      const original = pending[index]!;
      const previous = latest.get(original.id);
      const question = withExits(original, previous?.open);
      const raw = await options.askQuestion(question, index + 1, pending.length);
      asked += 1;
      const local = classifyLocally(question, raw);
      const choice = local.decision;
      if (choice === DELEGAR || DELEGATE_TEXT.test(raw.trim())) {
        // Delegation authorizes exactly the displayed recommendation, never an invented choice.
        const recommendation = original.recommended.trim();
        if (recommendation && recommendation !== DELEGAR && recommendation !== DEFER) {
          const consequence = original.options.find((option) => option.label === recommendation)?.consequence ?? "";
          assumptions.push({ topic: original.topic,
            statement: `${original.decision} → ${recommendation}${consequence ? ` — ${consequence}` : ""}`,
            basis: `o usuário autorizou delegar ${original.id}; esta era a recomendação apresentada, não uma decisão confirmada` });
          delegated.add(original.id);
        }
        answers.push(buildAnswer(original, raw, { disposition: "DEFERRED", decision: "", open: original.decision }, round, now));
        continue;
      }
      if (choice === DEFER || DEFER_TEXT.test(raw.trim())) {
        answers.push(buildAnswer(original, raw, { disposition: "DEFERRED", decision: "", open: original.decision }, round, now));
        continue;
      }
      if (local.settled) answers.push(buildAnswer(original, raw, local, round, now));
      else {
        const verdict = parseClassification(await call("interview", `prompt-engineer:${original.id}`, round, classificationPrompt(original, raw)))
          .find((item) => item.questionId === original.id);
        if (!verdict || !verdict.text.trim()) {
          answers.push(buildAnswer(original, raw, { disposition: "PARTIAL", decision: "", open: original.decision }, round, now));
        } else {
          answers.push(buildAnswer(original, raw, { disposition: verdict.disposition,
            decision: verdict.disposition === "ACCEPTED" ? verdict.text : "",
            open: verdict.disposition === "ACCEPTED" ? "" : verdict.text }, round, now));
        }
        const answer = answers.at(-1)!;
        if (answer.disposition !== "ACCEPTED") options.announce?.(`A decisão continua em aberto: ${answer.open}`);
      }
    }
    if (limitReached) break;
  }

  if (!discoveryComplete) limitReached = true;
  const latest = latestAnswers(answers);
  const openQuestions: PromptOpenQuestion[] = questions.flatMap((question) => {
    const answer = latest.get(question.id);
    if (answer?.disposition === "ACCEPTED" || delegated.has(question.id)) return [];
    return [{ questionId: question.id, topic: question.topic, statement: answer?.open || question.decision,
      disposition: answer?.disposition ?? "DEFERRED" }];
  });
  if (limitReached) {
    const statement = `O limite de segurança (${maxRounds} rodadas, ${maxQuestions} perguntas) foi atingido; a cobertura final das lacunas ainda precisa ser confirmada.`;
    openQuestions.push({ questionId: "DISCOVERY-LIMIT", topic: "cobertura das lacunas", statement, disposition: "DEFERRED" });
    options.announce?.(`Prompt Engineer: limite de segurança atingido; ${openQuestions.length} ponto(s) permanecem explícitos no prompt.`);
  }
  const decisions: PromptStatement[] = questions.flatMap((question) => {
    const answer = latest.get(question.id);
    if (answer?.disposition !== "ACCEPTED") return [];
    const consequence = question.options.find((option) => option.label === answer.decision)?.consequence;
    return [{ id: question.id, statement: `${question.topic}: ${question.decision} → ${answer.decision}${consequence ? ` — ${consequence}` : ""}` }];
  });
  const ledger = {
    confirmedDecisions: decisions,
    assumptions: assumptions.map((assumption, index) => ({ id: `A-${String(index + 1).padStart(2, "0")}`, statement: `${assumption.topic}: ${assumption.statement} (${assumption.basis})` })),
    openQuestions: openQuestions.map((question) => ({ id: question.questionId, statement: question.statement })),
  };
  options.announce?.(`Prompt Engineer: organizando prompt em ${language === "en" ? "inglês" : "português"}.`);
  const base = [
    draftPrompt(options, language, decisions, ledger.assumptions, openQuestions),
    "Full interview context (question wording, selected option consequences and raw user answers):",
    JSON.stringify({ questions, answers }),
  ].join("\n");
  let draft: PromptDraft | undefined;
  let corrective = base;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const output = await call("authoring", "prompt-engineer", attempt, corrective);
    try {
      draft = parsePromptDraft(output, language, ledger);
      break;
    } catch (error) {
      if (!(error instanceof PromptEngineerError) || attempt === 2) throw error;
      corrective = `${base}\nYour previous draft was rejected: ${error.message}. Return corrected JSON with all required sections and ledger items.`;
    }
  }
  if (!draft) throw new PromptEngineerError("nenhum prompt estruturado foi produzido", "invalid-prompt");
  return {
    prompt: renderPromptDraft(draft, options.request.text, {
      questions, answers, assumptions, openQuestions,
      source: { origin: options.request.origin, path: options.request.path,
        ...(options.library?.length ? { library: options.library } : {}) },
    }),
    language, questions, answers, assumptions, openQuestions, rounds,
    coverage: openQuestions.length === 0 ? "sufficient" : "open", limitReached,
  };

  async function call(stage: AgentCall["stage"], subject: string, attempt: number, prompt: string): Promise<string> {
    const result = await options.writer({ role: "writer", stage, subject, attempt, prompt });
    if (result.exitCode !== 0) throw new PromptEngineerError(`o writer falhou em ${subject} (${stage}, código ${result.exitCode})`, "provider-failed");
    return result.stdout;
  }

  function interviewDefects(batch: QuestionBatch): string[] {
    if (!batch.ok) return batch.defects.map((defect) => `${defect.questionId}: ${defect.problem} — ${defect.hint}`);
    const latest = latestAnswers(answers);
    return [...batch.questions, ...batch.omissions].flatMap((incoming) => {
      const existing = questions.find((question) => question.id === incoming.id);
      if (!existing || normalize(existing.decision) === normalize(incoming.decision)) return [];
      const previous = latest.get(existing.id);
      if (previous?.disposition !== "ACCEPTED" && previous?.disposition !== "DEFERRED" && !delegated.has(existing.id)) return [];
      return [`${incoming.id}: o id de uma decisão encerrada foi reutilizado para outra pergunta; preserve a decisão anterior e atribua um novo id ao novo tema`];
    });
  }
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function positiveLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new PromptEngineerError(`${name} deve ser inteiro positivo`, "invalid-options");
  return value;
}

function withExits(question: Question, open?: string): Question {
  return {
    ...question,
    ...(open?.trim() ? { pending: open } : {}),
    options: [
      ...question.options.filter((option) => option.label !== DELEGAR && option.label !== DEFER),
      { label: DELEGAR, consequence: `Usar a recomendação (${question.recommended}) como suposição explícita, que pode ser revista.` },
      { label: DEFER, consequence: "A lacuna fica explícita no prompt; nenhuma resposta será presumida." },
    ],
  };
}
