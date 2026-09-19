/**
 * Prompts de entrevista do papel `writer`.
 *
 * O levantamento de perguntas e a rodada de lacunas. O que escreve o produto
 * mora em `skeleton.ts`: é lá que o modelo olha o projeto inteiro, uma vez.
 */

import { languageBlock } from "./language.js";

export interface WriterContext {
  language: string;
  /** O prompt original do desenvolvedor, verbatim. */
  request: string;
  /** Decisões cuja disposição é ACCEPTED, já normalizadas. */
  decisions: string[];
  /** Suposições explícitas de baixo risco. */
  assumptions: string[];
  /** Documentos que este prompt pode citar como contexto já publicado. */
  upstream: { name: string; content: string }[];
  /** Stamp de inputs a gravar na linha 3, quando o documento tem um. */
  stamp?: string;
}

function context(writer: WriterContext): string {
  const parts = [
    "## The developer's original request (verbatim)",
    writer.request,
    "",
    "## Confirmed decisions (ACCEPTED answers only)",
    writer.decisions.length > 0 ? writer.decisions.map((entry) => `- ${entry}`).join("\n") : "- (none)",
    "",
    "## Explicit low-risk assumptions",
    writer.assumptions.length > 0 ? writer.assumptions.map((entry) => `- ${entry}`).join("\n") : "- (none)",
  ];
  for (const document of writer.upstream) {
    parts.push("", `## Upstream document: ${document.name}`, document.content);
  }
  return parts.join("\n");
}

const APPEARANCE = [
  "## One question you must always ask when the product has a user interface",
  "If anything the developer described is seen by a person — a screen, a page, a window — ONE of",
  "your questions is about visual identity, even when the request never mentions looks. It almost",
  "never does: whoever is planning a product is usually deep in the business rules, and appearance",
  "simply does not occur to them. A product shipped with no styling at all is not a minimal scope,",
  "it is a defect — and the loop will faithfully build exactly the nothing that was specified.",
  "",
  "Ask it as a concrete choice, never as \"do you want it to look good?\". Offer options that differ",
  "in effort and result, each naming what the developer gets:",
  "- a small design system of their own: colour tokens in one place, a spacing scale, typography,",
  "  visible states for hover, focus, empty and loading, light and dark themes;",
  "- an existing component library or CSS framework, named and versioned;",
  "- a deliberate minimum: readable typography, consistent spacing, one accent colour, nothing more.",
  "",
  "There is no option for \"no styling\", because that is the defect this question exists to prevent.",
  "Recommend the one that fits the product described, and say why in one sentence.",
].join("\n");

const FRAME = [
  "You are a specification writer for the Capivara harness. You produce documentation only.",
  "You never write application code, never run build or test commands, never install anything,",
  "and never commit. You have no memory of any previous session.",
  "",
  "## Authority order",
  "1. The developer's original prompt, verbatim.",
  "2. Interview answers whose disposition is ACCEPTED.",
  "3. Explicit low-risk assumptions recorded during the interview.",
  "4. Evidence observed in the project directory.",
  "Nothing else is authority. A DEFERRED, PARTIAL, AMBIGUOUS or CONTRADICTED answer is not a",
  "decision and must not become confirmed prose.",
  "",
  "## Hard rules",
  "- Never invent a feature, actor, limit, number, platform, failure behaviour or compatibility",
  "  promise that no authority above states. Missing information is an open question, never a default.",
  "- Never weaken, narrow or drop a decision that an ACCEPTED answer states.",
  "- Never add precision the source did not supply: no invented quantifiers, thresholds,",
  "  defaults or exceptions.",
  "- An unresolved material decision is written as `[NEEDS DECISION] <the open decision>` on its",
  "  own line. Never hide it inside fluent prose.",
  "- Never mention a provider, a model, an effort level, a CLI, a branch or commit strategy, or",
  "  how many agents will implement the work. You do not know those and they are not yours.",
].join("\n");

export function interviewPrompt(
  document: string,
  writer: WriterContext,
  inventory: string,
  previous: { question: string; answer: string; disposition: string }[],
): string {
  return [
    languageBlock(writer.language),
    "",
    FRAME,
    "",
    "## Your task",
    `Raise the questions that must be answered before ${document} can be written. Write no document.`,
    "",
    "Ask only when ALL of these are true:",
    "1. Neither the request nor the project evidence answers it safely.",
    "2. At least two plausible answers exist.",
    "3. The choice changes observable behaviour, scope, contracts, security, data or architecture.",
    "4. A wrong assumption creates meaningful rework or risk.",
    "",
    "Never ask about a discoverable command, path, dependency or convention.",
    "",
    "## The assumption channel, and why it exists",
    "Anything that does NOT change observable behaviour, scope, contracts, security or data goes in",
    "`assumptions`, not in `questions`. Exact colour values of a palette, a date format, a file name,",
    "a default page size: decide it, say why it is low risk, and move on. The developer reads every",
    "assumption in the final report and can overturn any of them.",
    "",
    "At most SIX questions per round. If more than six seem necessary, ask the six whose answers most",
    "change the result and turn the rest into assumptions. A developer answering forty questions to",
    "document one small product stops answering carefully somewhere around the fifteenth, and a",
    "careless answer is worse than an explicit assumption — it looks like a decision.",
    "",
    "An empty question list is a valid and good answer.",
    "",
    // A pergunta de aparência vale para o levantamento do produto: a identidade
    // visual é decidida uma vez, e não fase a fase.
    ...(document === "skeleton" ? [APPEARANCE, ""] : []),
    "",
    "Return only JSON, with both lists — `assumptions` may be empty, and so may `questions`:",
    '{ "contract": "capivara-questions/v1",',
    '  "assumptions": [ { "topic": "...", "statement": "what you decided", "basis": "why it is low risk" } ],',
    '  "questions": [ {',
    '  "id": "Q-01", "topic": "...", "evidence": "what you already found",',
    '  "decision": "the missing decision as a question", "why": "what changes with the answer",',
    '  "options": [ { "label": "...", "consequence": "..." } ],',
    '  "recommended": "<exactly one option label>", "recommendationBasis": "..." } ] }',
    "",
    "Every question MUST carry all five of these, non-empty:",
    "- id       — Q-01, Q-02, … stable across rounds",
    "- topic    — the subject in two or three words",
    "- evidence — what you already found out about it without asking",
    "- decision — the missing decision, written as a question",
    "- why      — what changes in the result depending on the answer",
    "A question missing any of them is an invalid response: the developer never sees it.",
    "",
    "Options are optional: omit them for a genuinely open question. When you give options, give",
    "two to four, each with its consequence, and recommend exactly one of them.",
    "",
    "Every option must be a CONCRETE, FINAL answer to the decision. An option that only postpones",
    'it — "define a specific stack", "decide during implementation", "choose later" — is a deferral',
    "wearing the clothes of a choice: the developer picks it, the decision is recorded as made, and",
    "the writer still has nothing to write. If the honest answer is that it can be decided later,",
    "do not ask the question at all.",
    "",
    "## Project evidence",
    inventory,
    ...(previous.length > 0
      ? ["", "## Already answered — never ask these again", ...previous.map((entry) => `- ${entry.question} → ${entry.answer} [${entry.disposition}]`)]
      : []),
    "",
    context(writer),
  ].join("\n");
}

/**
 * Perguntas para os gaps que o ESCRITOR descobriu.
 *
 * A entrevista prévia não alcança tudo: só ao escrever é que se descobre qual
 * decisão falta de verdade. Sem este caminho de volta, um `[NEEDS DECISION]`
 * viraria um bloqueio no fim do run, com o desenvolvedor descobrindo tarde algo
 * que ele teria respondido em dez segundos.
 */
/** O que já foi perguntado neste documento, com as palavras do desenvolvedor. */
export interface AskedQuestion {
  decision: string;
  disposition: string;
  answer: string;
}

export function gapPrompt(
  document: string,
  writer: WriterContext,
  markers: readonly string[],
  asked: readonly AskedQuestion[] = [],
): string {
  return [
    languageBlock(writer.language),
    "",
    FRAME,
    "",
    "## Your task",
    `While writing ${document} you marked these decisions as still open:`,
    ...markers.map((marker) => `- ${marker}`),
    "",
    "Turn each of them into one question for the developer. Write no document.",
    "Ask only about what is genuinely blocking the text; if one of the markers can be resolved by a",
    "low-risk explicit assumption, leave it out.",
    "",
    ...(asked.length > 0
      ? [
          "## Already asked in this document, with the developer's own words",
          ...asked.map((entry) => `- ${entry.decision}\n  [${entry.disposition}] ${entry.answer}`),
          "",
          "Never ask again what the developer already answered. A marker that one of those answers",
          "settles is closed: drop it. A marker that one of them settles PARTLY becomes a question about",
          "the remaining part only — never about the part already decided.",
          "Never offer an option that contradicts what the developer said above. Their answer outranks",
          "your recommendation: re-proposing the opposite as the recommended option is how a document",
          "ends up published against the decision that created it.",
        ]
      : []),
    "",
    "Never ask for the path of a design artifact. The design directory is optional and usually",
    "absent: a task with no matching artifact simply carries no Design ref. That is not a gap.",
    "",
    "Return only JSON, same shape as the interview batch:",
    '{ "contract": "capivara-questions/v1", "questions": [ { "id": "Q-01", "topic": "...",',
    '  "evidence": "...", "decision": "...", "why": "...", "options": [ { "label": "...",',
    '  "consequence": "..." } ], "recommended": "...", "recommendationBasis": "..." } ] }',
    "",
    "Every option must be a concrete, final answer. An option that postpones the decision is not an",
    "option: it is what put this marker here in the first place.",
    "",
    context(writer),
  ].join("\n");
}
