/**
 * Os dois prompts do caminho por esqueleto.
 *
 * O primeiro pensa o produto inteiro, uma vez. O segundo escreve uma fase vendo
 * apenas a fatia dela. É a troca que o desenvolvedor pediu depois de ver a
 * medição: hoje o modelo reconstrói o entendimento do projeto todo em cada uma
 * das ~50 chamadas do plano, e 77% do que ele processa é esse contexto, não a
 * tarefa.
 */

import { languageBlock } from "./language.js";

const AUTHORITY = [
  "## Authority order",
  "1. The developer's original prompt, verbatim.",
  "2. Interview answers whose disposition is ACCEPTED.",
  "3. Explicit low-risk assumptions recorded during the interview.",
  "Nothing else is authority. Never invent a feature, actor, limit, number, platform or failure",
  "behaviour that none of them states.",
].join("\n");

export interface SkeletonContext {
  language: string;
  request: string;
  decisions: string[];
  assumptions: string[];
  inventory: string;
  /** Tetos que o plano precisa respeitar para o loop conseguir executá-lo. */
  maxTasksPerPhase: number;
  maxCriteriaPerTask: number;
  /** Defeitos da tentativa anterior, quando houve. */
  defects?: string[];
}

export function skeletonPrompt(context: SkeletonContext): string {
  return [
    languageBlock(context.language),
    "",
    "You are designing the execution skeleton of a product. You produce structured data, not prose.",
    "",
    AUTHORITY,
    "",
    "## What this is for",
    "Nobody reads this as a document. It is consumed by a loop that implements the product phase by",
    "phase, one agent session per phase. Everything you write is judged by a single question: can",
    "that loop execute it? Not whether it reads well, whether it is complete as literature, or",
    "whether it explains itself. Executable, or not.",
    "",
    "This is the ONLY time anyone looks at the whole product at once. Each phase is written later",
    "seeing only its own slice of what you produce here, so whatever must be agreed across phases",
    "has to be decided by you, now.",
    "",
    "## The shared vocabulary is the part that cannot be vague",
    "If phase 3 creates a field and phase 7 reads it, they never see each other. They agree only",
    "through what you write. A name you leave loose becomes two different names; a rule you leave",
    "implicit becomes two different rules, and the loop discovers it when implementing one breaks",
    "the tests of the other.",
    "",
    "So `rules` carries every rule that crosses phases, and each one NAMES ITS TARGET AND ITS",
    "MOMENT. Not \"trim whitespace\" — say what is trimmed, when, and what is left untouched:",
    '  "cartoes.titulo: stored trimmed at both ends on save; comparison for search and uniqueness',
    '   ignores case and accents and does not alter the stored value; inner spaces are preserved"',
    "A rule that names an operation without naming what it operates on is the single defect that",
    "cost this harness the most: three phases each guessed differently about the same field.",
    "",
    "And every rule is CHECKED BY READING THIS REPOSITORY. Never write a rule as \"according to the",
    "<name> base\", \"as the design guide defines\" or \"following the supplied documentation\". Those",
    "documents guide HOW the product is built and are handed to whoever builds it — they are applied,",
    "never cited. A rule that points outside the repository becomes a criterion nobody can prove: the",
    "verifier looks for the document, does not find it, and rejects a phase that is correct. Say what",
    "must be TRUE in the code instead.",
    "",
    "## Sizing",
    `- One phase is ONE agent session: up to ${context.maxTasksPerPhase} tasks.`,
    `- Later, each task gets two or three acceptance criteria, at most ${context.maxCriteriaPerTask}.`,
    `  So a phase carries at most about ${context.maxTasksPerPhase * 3} criteria of real work. Size`,
    "  `taskCount` with that in mind: a phase that would need more is two phases.",
    "- Foundation first: data, then the relationships wired up front, then interface shell, then the",
    "  product flows. Never defer a relationship to a later feature phase.",
    "- `areas` says WHERE the phase works, from this closed list: frontend, backend, dados, infra,",
    "  qualidade. It decides which skills the builder receives in that phase — a frontend skill",
    "  loaded to build a database migration is paid context competing with what matters. A phase",
    "  may declare more than one. Use only these words; anything else is dropped.",
    "- Every story, entity and workflow you declare appears in the `covers` of some phase. What is",
    "  not covered will not be built.",
    "",
    "## Shape",
    "Return only JSON, no fence, no preamble:",
    "{",
    '  "contract": "capivara-skeleton/v1",',
    '  "projectName": "…",',
    '  "stack": [ { "component": "Linguagem", "decision": "TypeScript 5.8" } ],',
    '  "entities": [ { "name": "cartoes", "fields": [ { "name": "titulo", "type": "text, obrigatório" } ],',
    '                  "relations": ["pertence a colunas"] } ],',
    '  "stories": [ { "id": "US-1.1", "statement": "…" } ],',
    '  "workflows": [ { "number": "1", "name": "…", "steps": ["…"] } ],',
    '  "rules": [ { "subject": "cartoes.titulo", "statement": "…" } ],',
    '  "phases": [ { "number": 1, "title": "…", "goal": "…", "dependsOn": "none",',
    '                "covers": ["cartoes", "US-1.1", "workflow 1"], "areas": ["backend"], "taskCount": 8 } ],',
    '  "mvpCutPhase": 3',
    "}",
    "",
    "`dependsOn` is `none` or `Phase N, Phase M`. Story ids are `US-<n>.<m>`. Workflow numbers are",
    "plain numbers; the label `workflow <n>` is structural and is never translated.",
    "",
    ...(context.defects && context.defects.length > 0
      ? ["## Your previous attempt was rejected", ...context.defects.map((defect) => `- ${defect}`), ""]
      : []),
    "## The developer's original request (verbatim)",
    context.request,
    "",
    "## Confirmed decisions (ACCEPTED answers only)",
    context.decisions.length > 0 ? context.decisions.map((entry) => `- ${entry}`).join("\n") : "- (none)",
    "",
    "## Explicit low-risk assumptions",
    context.assumptions.length > 0 ? context.assumptions.map((entry) => `- ${entry}`).join("\n") : "- (none)",
    "",
    "## The project directory",
    context.inventory,
  ].join("\n");
}

export interface PhaseFromSliceContext {
  language: string;
  /** A fatia: só o que esta fase cobre, mais stack e regras transversais. */
  slice: string;
  phaseNumber: number;
  totalPhases: number;
  grammar: string;
  maxCriteriaPerTask: number;
  /** O teto que o harness conta e recusa. Passar dele é defeito só ele pode fechar. */
  maxTasksPerPhase: number;
}

export function phaseFromSlicePrompt(context: PhaseFromSliceContext): string {
  return [
    languageBlock(context.language),
    "",
    `You are writing phase ${context.phaseNumber} of ${context.totalPhases}, and only it.`,
    "",
    "## What you can see, and why that is all",
    "Below is this phase's slice: the stack, the entities and stories it delivers, and the rules that",
    "cross every phase. You are not seeing the other phases and you do not need to — what had to be",
    "agreed between them was decided in the skeleton, and the cross-cutting rules are reproduced here",
    "in full.",
    "",
    "Do not restate the rules as if they were yours to decide, and do not contradict them. A phase",
    "that redefines a shared rule breaks a phase you cannot see.",
    "",
    "## What a task is",
    "One agent session implements this whole phase, task by task, and an independent verifier reads",
    "the real code afterwards and says DONE or INCOMPLETE for each. Write for those two readers.",
    "",
    `- Two or three acceptance criteria per task, ${context.maxCriteriaPerTask} at the very most. A task needing more is`,
    "  doing more than one thing: split it.",
    "- Every criterion is something a person can observe in the code or in a command's output. If two",
    "  honest verifiers could read the same code and disagree, the criterion decides nothing.",
    "- A criterion is proven by reading THIS REPOSITORY, and nothing else. Never make one depend on a",
    "  document that is not in it — a skill from the documentation library, a design base, a style",
    "  guide, a wiki page — not even when a rule above phrases itself that way. Such guidance is",
    "  already in the hands of whoever builds: it is applied, never cited. \"The visual system follows",
    "  the frontend-design base\" cannot be verified; \"the palette, spacing scale and typography are",
    "  defined in one shared module and every screen imports them from there\" can.",
    "- Never assert the presence of something the skeleton says does not exist. A criterion demanding",
    "  what cannot exist can never be proven: the verifier looks, does not find, and rejects a phase",
    "  that was correct.",
    "",
    "## The adjective that invents a rule",
    "A criterion is written to be precise, and the fastest way to sound precise is to add a word:",
    "the \"normalized\" e-mail, the \"random\" password, \"equivalent indexes\", \"validated\" data,",
    "\"sanitized\" input. Each of those words is a RULE — it says a transformation happens, and it does",
    "not say to what, when, or what is left alone. If no source states that rule, you just invented",
    "one, and nobody can implement or verify what you meant.",
    "",
    "So: write what the sources state, AT THE PRECISION THEY STATE IT. `usuarios.email is unique` is",
    "faithful; `the normalized e-mail is unique` is a normalization rule nobody decided. When you",
    "catch yourself reaching for an adjective, either the slice already defines it — then name the",
    "rule, not the adjective — or nobody defined it, and you must not.",
    "",
    "And when a task genuinely cannot be written without deciding something material — what happens",
    "when the billing day does not exist in the month, whether a deleted e-mail can be reused — write",
    "",
    "  [NEEDS DECISION] <the open decision, in one line>",
    "",
    "on its own line, inside the task it belongs to. That line goes to the DEVELOPER before anything",
    "is audited, and comes back answered. It is the only legal way to leave something open: an",
    "invented default looks like a decision, gets built, and nobody ever learns it was a guess.",
    "",
    "The marker ADDS a line; it never replaces one. The task still carries its acceptance criteria,",
    "its feature tests and its traces — written for the part that IS decided. A task that is only a",
    "marker is a task the contract rejects, and it takes the whole plan down with it.",
    "",
    "Keep them few. One phase with several open decisions usually means you stopped writing and",
    "started asking: write everything the sources do settle, and mark only what truly cannot be",
    "written without an answer.",
    "",
    "## How many tasks",
    "The slice states how many tasks the skeleton allocated to this phase. That number is a budget:",
    `stay at it or below, and NEVER go past ${context.maxTasksPerPhase}. The harness counts and refuses the phase`,
    "above that, and you are the only one who can fix it — you cannot create a phase. The phases were",
    "decided once, in the skeleton, and nothing after it splits one.",
    "",
    "So if the work does not fit, make the tasks BIGGER: two tasks that deliver the same capability",
    "are one task. Never drop a capability the slice covers to fit the count — coverage is checked",
    "too, and a phase that fits by forgetting something fails a different way.",
    "",
    "## What you emit, and what you do not",
    "You emit the TASKS of this phase, and nothing else. The phase heading, its number, its title,",
    "its Goal, its Depends on and its Covers are already decided and are assembled around what you",
    "write. Writing them yourself is not needed and is not read.",
    "",
    "## Grammar of a task",
    context.grammar,
    "",
    "`Design ref` is the one optional field, and it is USUALLY ABSENT. It points at an artifact the",
    "developer put in the design directory by hand — a mockup, a spec, a screenshot — and that",
    "directory almost never exists. A path you invent there is a dead reference: the harness looks for",
    "the file, does not find it, and rejects the phase. When there is no artifact, the task simply",
    "carries no Design ref, and that is the normal case.",
    "",
    "Emit the raw bytes of the tasks and nothing else: no phase heading, no Goal line, no document",
    "header, no other phase, no preamble, no fence.",
    "",
    "## This phase's slice",
    context.slice,
  ].join("\n");
}
