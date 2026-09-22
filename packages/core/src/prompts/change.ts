/**
 * O prompt da mudança.
 *
 * O `init` desenha um produto que ainda não existe; aqui a aplicação já roda e
 * alguém já a usa. O prompt inteiro gira em torno disso: o que existe é
 * autoridade, o que funciona precisa continuar funcionando, e o que foi pedido é
 * o teto do que vai ser feito.
 */

import { languageBlock } from "./language.js";
import { CHANGE_CONTRACT, MAX_FASES_DA_MUDANCA } from "../contract/change.js";

export const CHANGE_HEADER = "CAPIVARA_CHANGE";

export interface ChangeContext {
  language: string;
  /** O que o desenvolvedor pediu, verbatim. */
  request: string;
  /** O esqueleto atual, renderizado: o que foi combinado até aqui. */
  skeleton: string;
  /** O inventário do projeto: o que existe no disco. */
  inventory: string;
  maxTasksPerPhase: number;
  /** As respostas da rodada anterior, quando houve perguntas. */
  answers?: { question: string; answer: string }[];
  defects?: string[];
}

export function changePrompt(context: ChangeContext): string {
  return [
    languageBlock(context.language),
    "",
    CHANGE_HEADER,
    "",
    "You are planning a CHANGE to an application that already exists, already works and is",
    "already being used. You write the plan for it; you do not implement anything now, and you",
    "never write, edit or commit a file.",
    "",
    "## Authority",
    "",
    "1. The developer's request below, verbatim. It is the ceiling of what will be done.",
    "2. The skeleton: what the product agreed to be. It is the record of past decisions.",
    "3. The code on disk: what actually happened. Read it — the skeleton says what was planned,",
    "   the code says what was built, and where they disagree the code is the fact.",
    "",
    "Never add a feature, a screen, a field or a rule that the request does not ask for. An",
    "application that works is not an invitation to improve it: every extra thing you plan is",
    "work nobody asked for, in code somebody depends on.",
    "",
    "## What already works has to keep working",
    "",
    "List in `touches` everything existing that this change alters — a screen, a route, a table,",
    "a rule, a flow. This is not documentation: it is what tells the loop which existing flows to",
    "re-run as regression, and what the executor must be careful with.",
    "",
    "A change that alters an existing rule REPLACES it: copy the old statement, verbatim as it",
    "appears in the skeleton, into `replaces`. Leaving two contradictory rules in the skeleton is",
    "worse than either one alone, because the next person to read it picks the wrong one — and so",
    "does the next phase to be implemented.",
    "",
    "## The phases",
    "",
    `At most ${MAX_FASES_DA_MUDANCA} phases, and usually one. Each phase is one agent session: it`,
    "must be implementable, testable and commitable on its own. If the change honestly does not",
    "fit in three phases, it is not a change — it is a project, and it belongs in `init`.",
    "",
    "Phases are appended after the existing ones and you do not number them: the harness does,",
    "because renumbering what was already built would break the plan that produced it.",
    "",
    "Declare `areas` for each phase — frontend, backend, dados, infra, qualidade — the same way",
    "the skeleton does. It decides which skills the executor gets.",
    "",
    "## Flows",
    "",
    "Declare a workflow only when the change gives the user something NEW to do end to end. A",
    "change that alters how something already looks or behaves does not invent a flow: the flows",
    "that already exist are the regression, and they will be re-run against the changed product.",
    "",
    "When the change alters a flow that exists, restate it with the same number, in full.",
    "",
    "## When you cannot decide",
    "",
    "Ask. A question costs one screen from the developer; a wrong assumption costs a phase built",
    "on it. Ask only what changes the result, at most three, each answerable on its own — never",
    "two decisions in one question. Emit questions and NO phases when you ask: planning on top of",
    "an assumption that a question is about to undo produces a plan for a product nobody wanted.",
    "",
    "Zero questions is the common and good answer for a request that is already specific.",
    "",
    "## Return only JSON",
    "",
    `{ "contract": "${CHANGE_CONTRACT}",`,
    '  "summary": "what changes, in one sentence",',
    '  "touches": ["the client form", "the rule about the accent colour"],',
    '  "entities": [ { "name": "...", "fields": [ { "name": "...", "type": "..." } ], "relations": ["..."] } ],',
    '  "rules": [ { "subject": "...", "statement": "the rule as it will be", "replaces": "the old statement, verbatim, or empty" } ],',
    '  "workflows": [ { "number": "", "name": "...", "steps": ["..."] } ],',
    `  "phases": [ { "title": "...", "goal": "...", "dependsOn": "Phase N | none", "covers": ["..."], "areas": ["frontend"], "taskCount": 3 } ],`,
    '  "questions": [ { "id": "M-01", "topic": "...", "decision": "the missing decision as a question",',
    '                   "why": "what changes with the answer",',
    '                   "options": [ { "label": "...", "consequence": "..." } ], "recommended": "<one label>" } ] }',
    "",
    `\`taskCount\` is between 1 and ${context.maxTasksPerPhase}.`,
    "",
    "## The request",
    "",
    context.request,
    ...(context.answers && context.answers.length > 0
      ? [
          "",
          "## What the developer already answered",
          "",
          ...context.answers.map((entry) => `- ${entry.question} → ${entry.answer}`),
          "",
          "Do not ask these again. Plan with them.",
        ]
      : []),
    "",
    "## The skeleton as it stands",
    "",
    context.skeleton,
    "",
    "## What is on disk",
    "",
    context.inventory,
    ...(context.defects && context.defects.length > 0
      ? ["", "## Your previous answer was rejected", "", ...context.defects.map((defect) => `- ${defect}`), "", "Return the whole thing again."]
      : []),
  ].join("\n");
}
