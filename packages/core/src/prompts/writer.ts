/**
 * Prompts do papel `writer`.
 *
 * A moldura comum estabelece a ordem de autoridade e as proibições; o bloco de
 * tarefa muda por documento. Para `project-phases.md` são duas chamadas: o
 * ledger de coordenação primeiro, depois UMA CHAMADA POR FASE — nunca um
 * intervalo, que é a forma mais comum de o documento estourar o contexto e o
 * run morrer no meio.
 */

import { phaseBlock, phaseHeading } from "../contract/templates.js";
import { languageBlock } from "./language.js";

export type DocumentName =
  | "project-description.md"
  | "user-stories.md"
  | "database-schema.md"
  | "project-phases.md";

export interface WriterContext {
  language: string;
  /** O prompt original do desenvolvedor, verbatim. */
  request: string;
  /** Decisões cuja disposição é ACCEPTED, já normalizadas. */
  decisions: string[];
  /** Suposições explícitas de baixo risco. */
  assumptions: string[];
  /** Documentos upstream já publicados, em ordem da cadeia. */
  upstream: { name: string; content: string }[];
  /** Stamp de inputs a gravar na linha 3, quando o documento tem um. */
  stamp?: string;
}

const FRAME = [
  "You are a specification writer for the Capivara harness. You produce documentation only.",
  "You never write application code, never run build or test commands, never install anything,",
  "and never commit. You have no memory of any previous session.",
  "",
  "## Authority order",
  "1. The developer's original prompt, verbatim.",
  "2. Interview answers whose disposition is ACCEPTED.",
  "3. Upstream documents already published in this chain.",
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
  '- Words like "appropriate", "supported", "fast", "secure", "as needed", "when possible" and',
  '  "etc." may appear as prose, but must never define a domain rule or an acceptance criterion.',
  "- An unresolved material decision is written as `[NEEDS DECISION] <the open decision>` on its",
  "  own line. Never hide it inside fluent prose.",
  "- Never mention a provider, a model, an effort level, a CLI, a branch or commit strategy, or",
  "  how many agents will implement the work. You do not know those and they are not yours.",
  "",
  "## Output",
  "Emit the raw bytes of the document body and nothing else. No preamble, no explanation, no",
  "closing remark, and no markdown fence wrapping the whole document.",
].join("\n");

const TASKS: Record<DocumentName, string> = {
  "project-description.md": [
    "## Your task",
    "Write project-description.md.",
    "",
    "Required structure, exactly:",
    "",
    "# <Project Name> — Project Description",
    "## Overview            (2-4 paragraphs: what it is, who it serves, the core value, the MVP boundary)",
    "### Key Concepts       (- **<Concept>:** <definition, including rules, limits and numbers>)",
    "## Tech Stack          (table or grouped bullets; the stack DECIDED IN THE INTERVIEW, with real",
    "                        versions; never a stack you chose yourself)",
    "## Core Workflows      (### 1. <name>, ### 2. <name>, ... numbered, concrete, with rules and",
    "                        edge cases; request/response examples in fenced blocks when the flow is an API)",
    "## Open Questions      (only when gaps remain; otherwise omit the section)",
    "",
    "This document is the head of the chain and carries no input stamp.",
    "Prefer specific numbers, limits and rules over vague description.",
  ].join("\n"),

  "user-stories.md": [
    "## Your task",
    "Write user-stories.md from the project description.",
    "",
    "Required structure, exactly:",
    "",
    "# <Project Name> — User Stories",
    "## Overview                        (what the product is, who it serves)",
    "**User Types:**                    (- **<Persona>** - <one-line definition>)",
    "## <N>. <Feature Area>",
    "### US-<N>.<M>: <Short Title>",
    "**As a** <persona>",
    "**I want to** <capability>",
    "**So that** <benefit>",
    "**Acceptance Criteria:**           (- [ ] concrete, testable condition)",
    "**Expected Result:** <end state when the story is done>",
    "## Open Questions                  (optional, before the appendix)",
    "## Appendix: User Story Status      (| ID | Story | Priority | Status | for EVERY story)",
    "",
    "Rules:",
    "- Every numbered workflow of the project description must be covered by at least one story,",
    "  or explicitly excluded with the reason the developer gave. Never assume an exclusion.",
    "- Acceptance criteria state limits, states and failure paths, with numbers where they exist.",
    "- Story IDs are stable. The IDs in the body and in the appendix must be the same set.",
  ].join("\n"),

  "database-schema.md": [
    "## Your task",
    "Write database-schema.md from the project description and the user stories.",
    "",
    "This document always exists. It describes the project's REAL data model, whatever its shape:",
    "database tables, files on disk, in-memory structures, or an input/output format. When the",
    "project has no persistence, describe what it does have and say so plainly in the overview.",
    "",
    "Required structure, exactly:",
    "",
    "# <Project Name> — Database Schema",
    "## Overview                  (the data model at a glance; conventions in force)",
    "## Schema                    (DBML when there are tables; the equivalent formal description",
    "                              otherwise. Lookup tables first, then domain, then pivots.)",
    "## Relationships             (one plain-language line per relationship)",
    "## Lookup Table Seeds        (for each lookup table, the concrete initial rows)",
    "## Notes & Conventions       (soft deletes, pivots, indexes, denormalisation, traceability)",
    "## Open Questions            (optional)",
    "",
    "Domain rules — apply to any stack:",
    "- Apply the naming and column conventions of the framework/ORM decided in the interview.",
    "  Never mix conventions from two stacks in one schema.",
    "- NEVER use an enum column or a string-based enum column. Any field holding a predefined set",
    "  of values (status, type, category, priority, level, role) becomes a lookup table with a",
    "  foreign key: `status_id` referencing `statuses`. Declare its seed rows.",
    "- File uploads: store the path in a string column with a `_path` suffix. When a record can",
    "  hold several files, create a related table with its own `file_path` column.",
    "- Every ref points at a real entity and a real column. Every key concept becomes an entity or",
    "  carries a recorded reason for not becoming one.",
  ].join("\n"),

  "project-phases.md": "",
};

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

export function writerPrompt(document: Exclude<DocumentName, "project-phases.md">, writer: WriterContext): string {
  const stamp = writer.stamp
    ? ["", "Line 3 must be the machine-owned input stamp, exactly:", writer.stamp].join("\n")
    : "";
  return [languageBlock(writer.language), "", FRAME, "", TASKS[document] + stamp, "", context(writer)].join("\n");
}

/** Primeira chamada de `project-phases.md`: planeja tudo, escreve nenhuma fase. */
export function ledgerPrompt(writer: WriterContext): string {
  return [
    languageBlock(writer.language),
    "",
    FRAME,
    "",
    "## Your task",
    "Plan the whole build, but write NO phase yet.",
    "",
    "Return only the coordination ledger as JSON:",
    '{ "contract": "capivara-ledger/v1",',
    '  "phases": [ { "number": 1, "title": "...", "goal": "...", "dependsOn": "none",',
    '                "covers": ["US-1.1", "users", "workflow 2"], "taskCount": 12 } ],',
    '  "mvpCutPhase": 1,',
    '  "coverage": { "stories": { "US-1.1": [1] }, "entities": { "users": [1] },',
    '                "workflows": { "1": [1], "2": "excluded: <reason the developer gave>" } } }',
    "",
    "Phase sizing is a hard constraint, not a preference:",
    "- One phase (parent plus all its sub-phases) is ONE agent session. Around 10-15 tasks.",
    "- Beyond that, split into more top-level phases. More well-scoped phases always beat fewer large ones.",
    "- Foundation first, always: (1) data foundation, (2) models with EVERY relationship wired up",
    "  front — never defer a relationship to a later feature phase, (3) frontend foundation.",
    "  Only then the product flows.",
    "- Every story, every entity and every workflow must appear in the coverage map, or carry an",
    "  explicit exclusion the developer stated.",
    "",
    context(writer),
  ].join("\n");
}

export interface PhasePartContext extends WriterContext {
  phaseNumber: number;
  /** A entrada do ledger alocada para esta fase, serializada. */
  ledgerEntry: string;
}

/** Uma chamada por fase. Nunca um intervalo. */
export function phasePartPrompt(part: PhasePartContext): string {
  return [
    languageBlock(part.language),
    "",
    FRAME,
    "",
    "## Your task",
    `Write EXACTLY ONE phase of project-phases.md: phase ${part.phaseNumber}.`,
    "",
    "Do not write the document header, the overview, any other phase, or the open questions.",
    `Emit only the Markdown of this one phase, starting at its "${phaseHeading(part.phaseNumber)}" heading.`,
    "",
    "The allocated shape of this phase, from the coordination ledger:",
    part.ledgerEntry,
    "",
    "Required structure, exactly:",
    "",
    phaseBlock(part.phaseNumber),
    "",
    "Rules:",
    "- Every task carries at least one acceptance criterion and a non-empty Traces line.",
    "- A criterion is binary and observable by reading the code or running a command. An",
    "  independent verifier with no conversation context must be able to answer DONE or",
    '  INCOMPLETE from it alone. "Works correctly", "handles errors" and "when applicable" are rejected.',
    "- A business-logic task (rule, calculation, state transition, permission, validation,",
    "  workflow) must list the feature tests to generate. Tests assert business rules: the limits,",
    "  states and edge cases from the stories and the data model.",
    "- A frontend-only task needs no tests, but needs validatable criteria and, when the design",
    "  directory holds a matching artifact, a Design ref pointing at it.",
    "- Sub-phases stay at level 3. A sub-phase promoted to level 2 becomes its own agent session",
    "  and breaks the sizing rule.",
    "- All tasks start as `- [ ]`.",
    "",
    context(part),
  ].join("\n");
}

/**
 * Levantamento de perguntas, antes de escrever o documento.
 *
 * A regra de decisão é restritiva de propósito: perguntar o descobrível gasta a
 * paciência de quem responde e não melhora o documento.
 */
export function interviewPrompt(
  document: DocumentName,
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
    "Never ask about a discoverable command, path, dependency or convention. Record a low-risk",
    "explicit assumption instead. An empty question list is a valid and good answer.",
    "",
    "Return only JSON:",
    '{ "contract": "capivara-questions/v1", "questions": [ {',
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
    "## Project evidence",
    inventory,
    ...(previous.length > 0
      ? ["", "## Already answered — never ask these again", ...previous.map((entry) => `- ${entry.question} → ${entry.answer} [${entry.disposition}]`)]
      : []),
    "",
    context(writer),
  ].join("\n");
}
