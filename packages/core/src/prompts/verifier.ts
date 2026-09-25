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
import { desgrudarChaves } from "../contract/protocolo.js";

export interface VerifierContext {
  language: string;
  phaseMarkdown: string;
  taskCount: number;
  /** O inventário mecânico: os testes que a fase nomeia e se o nome existe na árvore. */
  featureTests?: readonly { task: number; name: string; found: boolean }[];
  /**
   * As tasks que ele já declarou DONE em ciclo anterior, com o mesmo texto.
   *
   * Elas vão na tela porque uma task não se julga fora do contexto da fase — e
   * vão marcadas porque relê-las é o que impede a fase de fechar: seis tasks
   * diferentes em três ciclos, nunca mais de duas por vez, todas fechadas pelo
   * executor e substituídas por outras duas que ele mesmo tinha aprovado antes.
   */
  tasksJaAprovadas?: readonly { index: number; title: string }[];
}

/**
 * O bloco do que já passou.
 *
 * Simétrico ao `tasksJaAprovadas` do auditor de fases (§73), e pela mesma razão:
 * guardar o veredito não basta se quem julga não souber que ele existe — ele
 * julgaria de novo, acharia algo novo, e o harness teria de descartar um veredito
 * que acabou de pagar.
 */
function aprovadasBlock(tasks: readonly { index: number; title: string }[]): string[] {
  if (tasks.length === 0) return [];
  return [
    "",
    "## Already DONE — not under verification now",
    "",
    "You judged these tasks DONE in an earlier cycle of this same phase, and their text in the plan",
    "has not changed since. They are here only so the phase reads whole:",
    ...tasks.map((task) => `- task ${task.index}: ${task.title}`),
    "",
    "Emit `TASK <n>: DONE` for each of them and move on. Re-reading them is not thoroughness — a",
    "second reading of the same code always finds something the first did not, and that is how a",
    "phase never closes: three cycles, six different tasks, two at a time, every one of them fixed",
    "and replaced by two others that had already been approved.",
    "",
    "The one exception: if the correction made in THIS cycle broke one of them — a function that",
    "moved, a column that was renamed, a test that stopped covering what it covered — say it, and",
    "say it about the task that was CORRECTED, which is under verification. What protects the rest",
    "is not your reading: the build, the linter and the whole test suite ran over the entire tree",
    "before you were called, and they do not depend on attention.",
  ];
}

/**
 * O inventário, em texto.
 *
 * Ele entra no prompt como FATO, não como veredito: um nome ausente pode estar
 * coberto por um teste com outro nome, e isso só se decide lendo. O que ele
 * resolve é a ordem de descoberta — na fase 4 do MCP_teste o verificador achou
 * um buraco por ciclo, e os dois já estavam lá desde o primeiro.
 */
function featureTestBlock(tests: readonly { task: number; name: string; found: boolean }[]): string[] {
  const ausentes = tests.filter((test) => !test.found);
  if (tests.length === 0) return [];

  return [
    "",
    "## Mechanical check, already done for you",
    "",
    "The phase names specific feature tests. The harness searched the whole project tree for each",
    "name, literally. This is a fact about names, not a verdict about coverage:",
    "",
    ...tests.map((test) => `- task ${test.task}: \`${test.name}\` — ${test.found ? "name found in the tree" : "NAME NOT FOUND ANYWHERE"}`),
    "",
    ...(ausentes.length > 0
      ? [
          "A name that was not found may still be covered by a test written under another name —",
          "read the code and decide. But a task whose named test is missing AND whose rule is not",
          "asserted anywhere is INCOMPLETE, and you must say which name is missing.",
        ]
      : ["Every named test exists by name. Judging whether each one asserts what the task requires is still yours."]),
  ];
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
    ...featureTestBlock(context.featureTests ?? []),
    ...aprovadasBlock(context.tasksJaAprovadas ?? []),
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

/**
 * Lê as linhas TASK, ignorando prosa em volta, indentação acidental — e a chave
 * colada no fim da frase anterior, que foi a forma que derrubou a auditoria e o
 * ensaio do `MCP_teste2` antes de aparecer aqui (§40).
 */
export function parseVerification(output: string): TaskVerdict[] {
  const verdicts: TaskVerdict[] = [];
  for (const rawLine of desgrudarChaves(output, String.raw`TASK\s+\d+:`).split("\n")) {
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
