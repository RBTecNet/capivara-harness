/**
 * Prompt do papel `verifier`.
 *
 * Read-only, mais comandos que não alteram nada. Ele NÃO roda a suíte inteira:
 * o gate 2 já rodou e passou minutos antes, e repeti-la dobraria custo e tempo
 * sem prova nova. Um teste filtrado é permitido quando um critério específico
 * depende do resultado dele.
 *
 * Na dúvida, INCOMPLETE. A assimetria com o auditor documental é deliberada:
 * reprovar código custa um ciclo de correção barato e verificável.
 */

import { languageBlock } from "./language.js";

export interface VerifierContext {
  language: string;
  phaseMarkdown: string;
  taskCount: number;
}

export const VERIFY_HEADER = "CAPIVARA_VERIFY";

export function verifyPrompt(context: VerifierContext): string {
  return [
    languageBlock(context.language),
    "",
    VERIFY_HEADER,
    "",
    "You are an independent verifier. You did not implement this phase and you have no memory of",
    "any previous session.",
    "",
    "You never write, edit, create, delete, move or commit any file. You never install anything.",
    "You may run commands that change nothing — reading files, listing routes, describing a schema,",
    "inspecting a build artifact. Do not run the full test suite: it already ran and passed before",
    "you were called. You may run a single filtered test when one acceptance criterion depends on",
    "its result.",
    "",
    "Your only job is to read the real code and say what is done and what is not.",
    "",
    "For EACH task marked `- [ ]` or `- [x]` in the phase below, in the order they appear, check",
    "its acceptance criteria against the real code — files, classes, tests, routes, migrations,",
    "whatever the task requires — and emit EXACTLY ONE line:",
    "",
    "TASK <n>: DONE",
    "TASK <n>: INCOMPLETE — <what is missing>",
    "",
    "Rules:",
    "- <n> is the index of the task within the phase, starting at 1.",
    `- One TASK line for every task. This phase has ${context.taskCount}. No exception, no grouping, no reordering.`,
    "- Emit no other text: no preamble, no summary, no closing sentence.",
    "- Missing code, a TODO, a placeholder or a missing test means INCOMPLETE.",
    "- A task marked [x] is verified like any other. The mark is a claim, not evidence.",
    "- When in doubt, INCOMPLETE.",
    "",
    "## The phase to verify",
    context.phaseMarkdown,
  ].join("\n");
}

export interface TaskVerdict {
  index: number;
  done: boolean;
  missing: string;
}

const TASK_LINE = /^TASK\s+(\d+):\s*(DONE|INCOMPLETE)\s*(?:[—-]\s*(.*))?$/;

/** Lê as linhas TASK, ignorando prosa em volta e indentação acidental. */
export function parseVerification(output: string): TaskVerdict[] {
  const verdicts: TaskVerdict[] = [];
  for (const rawLine of output.split("\n")) {
    const match = TASK_LINE.exec(rawLine.replace(/\r$/, "").trim());
    if (!match) continue;
    verdicts.push({
      index: Number(match[1]),
      done: match[2] === "DONE",
      missing: (match[3] ?? "").trim(),
    });
  }
  return verdicts;
}
