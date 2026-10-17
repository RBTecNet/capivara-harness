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
    "The one exception: if you SEE that one of them is not delivered — the correction made in this",
    "cycle broke it, or it was never really there — mark THAT task `TASK <n>: INCOMPLETE — <what is",
    "missing>`. It goes back to the builder. Do not go looking for it: re-reading approved work to",
    "find something new is the loop described above. Report what you ran into, not what you hunted.",
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
    "TASK <n>: INCOMPLETE — <all missing criteria; evidence; concrete correction; regression check>",
    "",
    "Rules:",
    "- <n> is the index of the task within the phase, starting at 1.",
    `- One TASK line for every task. This phase has ${context.taskCount}. No exception, no grouping, no reordering.`,
    "- Emit no other text: no preamble, no summary, no closing sentence.",
    "- Missing code, a TODO, a placeholder or a missing test means INCOMPLETE.",
    "- A task marked [x] is verified like any other. The mark is a claim, not evidence.",
    "- When in doubt, INCOMPLETE.",
    "",
    "## Findings must be executable repair instructions",
    "Inspect EVERY acceptance criterion of each task under verification before answering. Report ALL",
    "the gaps you can substantiate now on its one TASK line, not one gap per correction cycle.",
    "For each missing criterion include: (1) which requirement is unmet, (2) the file, symbol or test",
    "and its actual behaviour, (3) the smallest concrete change that closes it, and (4) the exact",
    "regression scenario/assertion and command that would prove it. Separate findings with semicolons.",
    "Do not merely say 'fix the code', 'add coverage' or 'handle errors'. Name the location and the",
    "expected behaviour so a builder with no memory can follow your instructions. If a location does",
    "not exist, say so and point to the existing integration point; never invent a file you did not read.",
    "Distinguish a product defect from a missing dependency or incompatible runtime. For an installation",
    "failure include the failed command and evidence, then the project-local installation/rebuild and",
    "check needed under the SAME runtime as the harness. Do not ask to rewrite working product code",
    "to compensate for a broken environment. You report the repair; you still never perform it here.",
    "",
    "## A passing test must prove the specified failure mode",
    "Read the setup AND assertions of the tests; a matching name or a green suite is not proof.",
    "A rejected fetch or browser `route.abort()` exercises a transport/network failure. An HTTP 503",
    "created with `route.fulfill()` exercises a server response and does NOT prove transport handling.",
    "When the criterion requires a localized network error, require the real transport failure and an",
    "assertion of the displayed message/language; merely asserting that an alert exists is insufficient.",
    "Apply this distinction only to requirements actually stated in the phase or its cited specification.",
    "Never suggest weakening an assertion, replacing the failing scenario with an easier mock, hiding",
    "a failure from the checks, or changing the specification to pass. Preserve fixes already delivered.",
    "",
    ...featureTestBlock(context.featureTests ?? []),
    ...aprovadasBlock(context.tasksJaAprovadas ?? []),
    "",
    "## The phase to verify",
    context.phaseMarkdown,
  ].join("\n");
}

export interface VerifierRepairContext {
  language: string;
  phaseMarkdown: string;
  /** O diagnóstico completo, inclusive como corrigir e verificar cada pendência. */
  cause: string;
  testCommand: string | null;
  e2eCommand?: string;
  /** Instalação de sistema depende da política do run; dependências locais são permitidas. */
  systemInstall?: boolean;
}

export const VERIFY_REPAIR_HEADER = "CAPIVARA_VERIFY_REPAIR";

/**
 * Sessão de reparo separada da avaliação independente.
 *
 * O verificador sabe onde está o defeito e pode consertá-lo sem obrigar o
 * construtor a redescobrir a causa. Isso não o autoriza a aprovar a própria
 * mudança: o runner repete os gates e chama outra verificação somente leitura.
 */
export function verifierRepairPrompt(context: VerifierRepairContext): string {
  return [
    languageBlock(context.language),
    "",
    VERIFY_REPAIR_HEADER,
    "",
    "You are repairing explicit findings from an independent verification of this phase.",
    "This is a bounded REPAIR session, not the read-only verification session and not a new implementation.",
    "Read the current code and the cited evidence first. Fix ONLY the listed gaps and their direct causes.",
    "Preserve all existing correct behaviour, previous corrections and unrelated work.",
    "",
    "## Allowed actions and boundaries",
    "- Edit the project's code, tests and required local configuration to close the explicit findings.",
    "- Install, rebuild or restore project-local dependencies with this project's package manager,",
    "  including dependencies the builder could not install. Use existing manifests and lockfiles;",
    "  do not introduce a new stack or unrelated packages.",
    ...(context.systemInstall === true
      ? [
          "- System installation is enabled for this run: you may install a demonstrated missing system",
          "  prerequisite required by a finding. Use the existing system package manager, change only",
          "  what that prerequisite needs, and report the exact command and result.",
        ]
      : [
          "- System installation is NOT enabled: never install system packages, use sudo or change global",
          "  configuration. If a required prerequisite is unavailable, report the failed command and",
          "  the specific prerequisite instead of bypassing the failure.",
        ]),
    "- Do not commit, stage files, change Git branches/refs, merge, reset or cherry-pick. The harness",
    "  owns checkpointing and integration; leave the patch in the current worktree.",
    "- Never edit the specification under `.capivara/init/`, phase requirements, or run state under",
    "  `.capivara/runs/`. Do not alter the acceptance criteria to fit the implementation.",
    "- Never delete, skip or disable tests, weaken assertions, suppress failures to pass checks, or replace",
    "  a failing scenario with an easier mock. HTTP 503 via `route.fulfill()` cannot replace a transport failure",
    "  via rejected fetch or `route.abort()` when the requirement is network-failure handling.",
    "",
    "## Runtime and verification",
    `For Node projects the harness uses \`${process.execPath}\` (${process.version}, ABI ${process.versions.modules}).`,
    "Use that SAME Node executable for installation, rebuilds and checks, with its directory first in",
    "PATH for package-manager scripts. Do not activate another Node/NVM version to make a command pass.",
    "For other stacks use the runtime and commands already declared by this project.",
    "First add or strengthen the regression check for the actual finding, then apply the smallest fix",
    "and run the relevant check. Preserve the original failing scenario and assert the required result.",
    ...(context.testCommand
      ? ["Run the project's gate test command before finishing:", "", `    ${context.testCommand}`, ""]
      : ["No gate test command was resolved; report that explicitly and use the project's documented checks."]),
    ...(context.e2eCommand
      ? [
          "When the repair changes browser behaviour or browser tests, also run:",
          "",
          `    ${context.e2eCommand}`,
          "",
        ]
      : []),
    "## Findings to repair",
    "````",
    context.cause,
    "````",
    "",
    "## The phase — read-only requirements",
    context.phaseMarkdown,
    "",
    "## Required report",
    "Report each finding with the changed files, the correction, the exact commands and observed",
    "results, and any unresolved prerequisite or gap. Say explicitly when you could not fix something.",
    "Do not emit TASK verdicts or claim approval. Your report is not evidence of success: the harness",
    "will rerun the tests and perform a NEW independent read-only verification of the resulting code.",
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
