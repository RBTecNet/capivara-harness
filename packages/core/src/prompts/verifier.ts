/**
 * Prompt do papel `verifier`.
 *
 * Read-only, mais comandos que não alteram nada. Ele NÃO roda a suíte inteira:
 * o gate 2 já rodou e passou minutos antes, e repeti-la dobraria custo e tempo
 * sem prova nova. Um teste filtrado é permitido quando um critério específico
 * depende do resultado dele.
 *
 * Bloqueio exige evidência material; melhorias opcionais são observações.
 * Cada devolução custa tempo e dinheiro, inclusive com um modelo barato.
 */

import { languageBlock } from "./language.js";
import { architectureSliceBlock, completionBlock, processBlock } from "./builder.js";
import { lerProtocolo } from "../contract/protocolo.js";
import { pendenciasDoPlano } from "../contract/phases.js";
import { functionalAcceptanceBlock } from "./acceptance-policy.js";
import { testPolicyBlock } from "./test-policy.js";

export interface VerifierContext {
  language: string;
  phaseMarkdown: string;
  sharedContract?: string;
  /** A fatia da arquitetura aprovada para a fase (§125): o verificador a confronta com o código. */
  architectureSlice?: string;
  taskCount: number;
  /**
   * As tasks que ele já declarou DONE em ciclo anterior, com o mesmo texto.
   *
   * Elas vão na tela porque uma task não se julga fora do contexto da fase — e
   * vão marcadas porque relê-las é o que impede a fase de fechar: seis tasks
   * diferentes em três ciclos, nunca mais de duas por vez, todas fechadas pelo
   * executor e substituídas por outras duas que ele mesmo tinha aprovado antes.
   */
  tasksJaAprovadas?: readonly { index: number; title: string; mudancas?: readonly string[] }[];
  /**
   * Tasks que ele aprovou antes, sob verificação agora porque o código mudou
   * desde então por um reparo (§125): a lista do que mudou dirige a releitura,
   * e a linha TASK conta como qualquer outra.
   */
  tasksParaConfirmar?: readonly { index: number; title: string; mudancas: readonly string[] | null }[];
  /**
   * Os defeitos desta fase que o build já conhece — abertos e resolvidos —,
   * para o verificador dizer quando um achado é o mesmo: `[P03-D1]` na linha.
   */
  defeitosConhecidos?: readonly { id: string; status: string; gate: string; summary: string }[];
  /** A fase passa pelo gate 4: o executor recebeu o contrato de subida dele (§107), e o verificador precisa conhecê-lo (§133). */
  temFluxos?: boolean;
}

/**
 * "Não provado" é do código, não da sessão (§133).
 *
 * No Luna (desktop Avalonia) o verificador escreveu, sobre a integração que ele
 * mesmo leu pronta, "confirmar visualmente a abertura do calendário" — cinco
 * vezes, com a árvore idêntica, e dois reparos dele mesmo, que não tinham janela
 * para olhar. O B0 de "não pode ser provado" valia para o que nenhuma sessão do
 * loop consegue ver, e virou reprovação sem saída. O critério que manda percorrer
 * os fluxos "no aplicativo nativo" é procedimento de verificação, que pertence ao
 * gate de fluxos — o plano não planeja teste (§129).
 */
function observacaoPossivelBlock(temFluxos: boolean | undefined): string[] {
  return [
    "'Cannot be proven' is about the code and the evidence this loop can produce, not about what your session can watch.",
    "No session of this loop can open a native window, look at a screen or operate a device, and no repair changes that:",
    "never block on such an observation ('open the application and confirm visually'). Judge the requirement from the",
    "code, the gates' results and a check you can run, and ask only for a proof the builder can deliver with the approved",
    "infrastructure. If the code does not establish the behaviour, it is INCOMPLETE as before.",
    "A criterion that prescribes HOW the product is verified — walk the flows in some environment, run a given test — is",
    "the gates' procedure, not a code requirement: verify the product behaviour it refers to.",
    // Com `--no-flows`, ou numa fase sem fluxo, não há gate que relate o percurso: a frase seria falsa (§133).
    ...(temFluxos ? ["Walking the flows belongs to the flow gate, which reports what it could not walk."] : []),
  ];
}

/**
 * O que o harness exige da subida para o gate 4, do lado de quem julga (§133).
 *
 * O executor recebe o contrato do §107 — `start` com `PORT` e `HOST` — e o
 * verificador não. No Astra a P06 dizia "iniciar na porta 3000 e manter
 * SQLITE_PATH como única variável lida"; o G3 reprovou o servidor por ler `PORT`
 * e `HOST`, o reparo dele os tirou, e a aplicação passou a escutar onde o gate não
 * a procura. A metade que faltava era esta.
 */
function subidaDoGate4Block(temFluxos: boolean | undefined): string[] {
  if (!temFluxos) return [];
  return [
    "",
    "## How the harness starts the product for the flow gate",
    "For a product used through a browser, the harness itself tells the builder that the flow gate runs the manifest's",
    "`start` entrypoint with `PORT` and `HOST` in the environment, and that the entrypoint must listen there. Honouring",
    "`PORT` and `HOST` — with the plan's own address as the default when they are absent — is that harness requirement,",
    "not a deviation from the plan: never ask to remove it. A default that contradicts the plan is still a finding.",
    "A product used outside the browser — a native desktop window, a program used in a terminal, a library — has no",
    "such entrypoint: never ask to create a manifest, an HTTP server or a `start` entry only for the flow gate.",
  ];
}

/**
 * O bloco do que já passou.
 *
 * Simétrico ao `tasksJaAprovadas` do auditor de fases (§73), e pela mesma razão:
 * guardar o veredito não basta se quem julga não souber que ele existe — ele
 * julgaria de novo, acharia algo novo, e o harness teria de descartar um veredito
 * que acabou de pagar.
 */
function aprovadasBlock(tasks: readonly { index: number; title: string; mudancas?: readonly string[] }[]): string[] {
  if (tasks.length === 0) return [];
  return [
    "",
    "## Already DONE — not under verification now",
    "",
    "You judged these tasks DONE in an earlier cycle of this same phase, and their text in the plan",
    "has not changed since. They are here only so the phase reads whole:",
    ...tasks.map((task) =>
      `- task ${task.index}: ${task.title}` +
      (task.mudancas && task.mudancas.length > 0 ? ` (files changed since your approval: ${task.mudancas.slice(0, 12).join(", ")}${task.mudancas.length > 12 ? ", …" : ""})` : ""),
    ),
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
 * A fatia da arquitetura, do lado de quem julga (§125).
 *
 * O G3 confronta os critérios de aceite E a arquitetura com o código real. Um
 * contrato que a fase devia oferecer e não oferece, ou um contrato consumido
 * que foi reescrito, é lacuna material; organização interna diferente com o
 * contrato honrado não é.
 */
function verifierArchitectureBlock(slice: string | undefined): string[] {
  if (!slice || slice.trim() === "") return [];
  return [
    "",
    "## Architecture decided by the plan for this phase",
    "Confront the acceptance criteria AND this architecture slice with the real code. A contract this phase must",
    "provide that is missing or contradicted, or a dependency contract that was rewritten instead of consumed, is a",
    "material gap: report it on the task it belongs to, with evidence. A different internal organization that honours",
    "the contracts is not a gap.",
    "",
    slice.trim(),
  ];
}

/**
 * As aprovadas que voltam à verificação porque um reparo mudou o código (§125).
 *
 * Não é o bloco de cima: estas estão SOB verificação, e a linha delas conta.
 * Mas a releitura é dirigida — o que mudou desde a aprovação —, e não uma
 * auditoria nova de tudo o que já tinha passado.
 */
function confirmarBlock(tasks: readonly { index: number; title: string; mudancas: readonly string[] | null }[]): string[] {
  if (tasks.length === 0) return [];
  return [
    "",
    "## Previously approved — confirm against what changed",
    "",
    "You approved these tasks earlier in this phase. A repair changed the code since then, so they are",
    "under verification again: check whether the change affects each one, starting from the files below.",
    ...tasks.map((task) => `- task ${task.index}: ${task.title} — changed since: ${task.mudancas === null ? "unknown (read the current code)" : task.mudancas.slice(0, 20).join(", ") || "nothing versioned"}`),
    "Emit their TASK lines like any other: DONE if the requirement still holds, INCOMPLETE with evidence if the change broke it.",
  ];
}

/** Os defeitos que o build já conhece, para o achado repetido manter a identidade (§125). */
function defeitosBlock(defeitos: readonly { id: string; status: string; gate: string; summary: string }[]): string[] {
  if (defeitos.length === 0) return [];
  return [
    "",
    "## Defects of this phase the harness already knows",
    ...defeitos.map((defeito) => `- [${defeito.id}] ${defeito.gate}, ${defeito.status}: ${defeito.summary}`),
    "When an INCOMPLETE finding is one of these, start its text with the id in brackets, e.g. `[" + (defeitos[0]?.id ?? "P01-D1") + "]`.",
  ];
}

/**
 * As pendências que o plano deixou na fase, do lado de quem julga.
 *
 * Uma pendência impede `aceito` até a revisão dizer, na mesma chamada, que o
 * código a resolveu. A linha é separada das TASK porque a pendência não é de
 * uma task: é a contradição que o plano não fechou.
 */
function pendenciasDoPlanoBlock(phaseMarkdown: string): string[] {
  const pendencias = pendenciasDoPlano(phaseMarkdown);
  if (pendencias.length === 0) return [];
  return [
    "",
    "## Plan issues this phase carries",
    "The plan audit could not close these issues; the builder was told to resolve them in the code. After the",
    "TASK lines, emit exactly one line per issue, numbered as below:",
    "",
    "PLAN_ISSUE <n>: RESOLVED — <the file and behaviour that resolve it>",
    "PLAN_ISSUE <n>: OPEN — <why the code does not resolve it>",
    "",
    "RESOLVED only when you read the code that resolves it. When in doubt, OPEN: the phase is then delivered",
    "with the issue pending, named, and never blocked for it.",
    ...pendencias.map((pendencia, indice) => `${indice + 1}. ${pendencia}`),
  ];
}

/** O que a revisão disse de cada pendência do plano: o número das que ela leu resolvidas no código. */
export function pendenciasResolvidas(output: string): Set<number> {
  const resolvidas = new Set<number>();
  for (const linha of lerProtocolo(output, String.raw`PLAN_ISSUE\s+\d+`, "RESOLVED|OPEN").split("\n")) {
    const lida = /^PLAN_ISSUE\s+(\d+):\s*(RESOLVED|OPEN)\b/iu.exec(linha.trim());
    if (lida && (lida[2] ?? "").toUpperCase() === "RESOLVED") resolvidas.add(Number(lida[1]));
  }
  return resolvidas;
}

export const VERIFY_HEADER = "CAPIVARA_VERIFY";

export function verifyPrompt(context: VerifierContext): string {
  return [
    languageBlock(context.language),
    "",
    VERIFY_HEADER,
    ...(context.sharedContract ? ["## Published shared contracts", context.sharedContract] : []),
    ...verifierArchitectureBlock(context.architectureSlice),
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
    functionalAcceptanceBlock(),
    testPolicyBlock(),
    "",
    "For EACH task marked `- [ ]` or `- [x]` in the phase below, in the order they appear, check",
    "its acceptance criteria against the real code — files, classes, tests, routes, migrations,",
    "whatever the task requires — and emit EXACTLY ONE line:",
    "",
    "TASK <n>: DONE",
    "TASK <n>: DONE — ADVISORY: <optional improvement that does not block required behaviour>",
    "TASK <n>: INCOMPLETE — <all missing criteria; evidence; concrete correction; regression check>",
    "",
    "Rules:",
    "- <n> is the index of the task within the phase, starting at 1.",
    `- One TASK line for every task. This phase has ${context.taskCount}. No exception, no grouping, no reordering.`,
    pendenciasDoPlano(context.phaseMarkdown).length > 0
      ? "- Emit no other text than the TASK lines and the PLAN_ISSUE lines below: no preamble, no summary, no closing sentence."
      : "- Emit no other text: no preamble, no summary, no closing sentence.",
    "- End DONE immediately, or use the exact separator ` — ADVISORY: ` for a non-blocking suggestion. Never `DONE; ...`.",
    "- If an observation means a required criterion is unmet, emit INCOMPLETE with evidence and a concrete fix.",
    "- Missing required functionality, a placeholder or a demonstrated functional defect means INCOMPLETE.",
    "- A task marked [x] is verified like any other. The mark is a claim, not evidence.",
    "- Investigate uncertainty. Block on concrete material evidence.",
    "",
    "## Findings must be executable repair instructions",
    "Inspect EVERY acceptance criterion of each task under verification before answering. Report ALL",
    "the gaps you can substantiate now on its one TASK line, not one gap per correction cycle.",
    "Write each finding with labeled fields, so the repair can start from your diagnosis without rediscovering it:",
    "`B1: CRITERION: <unmet requirement>; OBSERVED: <file, symbol or test and its actual behaviour>; EXPECTED: <required behaviour>;",
    "LOCATION: <where>; HYPOTHESIS: <likely cause>; FIX: <smallest change>; CHECK: <regression scenario and command>`.",
    "Start with B0 instead of B1 when required functionality is absent or essential behaviour cannot be proven at all.",
    ...observacaoPossivelBlock(context.temFluxos),
    "Only when the code CANNOT satisfy the requirement because the approved documentation itself is wrong — an",
    "acceptance criterion contradicts the architecture, a contract cannot be honoured as written, two documents",
    "contradict each other, the phase demonstrably needs a dependency the approved infrastructure does not",
    "declare — add `UPSTREAM: PLAN — <document and exact passage>: <why no compatible implementation",
    "exists>` (INIT instead of PLAN when the product definition in skeleton.md is the source). It is a claim, not a",
    "way out: the harness forwards it only after the build exhausted every repair, and keeps the task INCOMPLETE.",
    "A finding without the unmet requirement, the observed behaviour and the expected behaviour is not a material block.",
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
    "Never suggest weakening an assertion, replacing the failing scenario with an easier mock, hiding",
    "a failure from the checks, or changing the specification to pass. Preserve fixes already delivered.",
    "",
    ...aprovadasBlock(context.tasksJaAprovadas ?? []),
    ...confirmarBlock(context.tasksParaConfirmar ?? []),
    ...defeitosBlock(context.defeitosConhecidos ?? []),
    ...subidaDoGate4Block(context.temFluxos),
    ...pendenciasDoPlanoBlock(context.phaseMarkdown),
    "",
    "## The phase to verify",
    context.phaseMarkdown,
  ].join("\n");
}

export interface VerifierRepairContext {
  language: string;
  phaseMarkdown: string;
  sharedContract?: string;
  /** A mesma fatia da arquitetura que o executor recebe (§125). */
  architectureSlice?: string;
  /** O diagnóstico completo, inclusive como corrigir e verificar cada pendência. */
  cause: string;
  testCommand: string | null;
  e2eCommand?: string;
  /** Instalação de sistema depende da política do run; dependências locais são permitidas. */
  systemInstall?: boolean;
}

export const VERIFY_REPAIR_HEADER = "CAPIVARA_VERIFY_REPAIR";

/** Orientação de correção, nunca um veredito nem permissão para editar. */
export function testRepairGuidancePrompt(context: VerifierRepairContext): string {
  return [
    languageBlock(context.language), "", "CAPIVARA_TEST_REPAIR_GUIDANCE", "",
    ...(context.sharedContract ? ["## Published shared contracts", context.sharedContract] : []),
    ...architectureSliceBlock(context.architectureSlice),
    "The harness test command failed after integrating this phase into a checkout.",
    "Read the source and the complete failure below. Do not write, edit, delete or repair files in this session.",
    "Give the executor a concrete solution so it does not have to rediscover your diagnosis.",
    "Return CAUSE, EVIDENCE (file and failing assertion), FIX (exact file and minimal action), and CHECK (reproduction and regression commands).",
    "A passing suite in a warm worktree does not explain a failure in the integrated checkout.",
    "If tests require an ignored build artifact, declare reproducible preparation in the test command or lifecycle (for example pretest).",
    "Do not merely run a build to warm the worktree, copy ignored artifacts into the main tree, remove tests, skip cases or weaken assertions.",
    "Preserve the scenario that failed. Distinguish a product defect from missing test preparation and explain the smallest durable correction.",
    "Your advice is not approval: the harness will rerun tests and independent verification after the correction.",
    "", "## Exact test command", context.testCommand ?? "not resolved", "",
    "## Complete failure evidence", "````", context.cause, "````", "",
    "## Current requirements", context.phaseMarkdown,
  ].join("\n");
}

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
    ...(context.sharedContract ? ["## Published shared contracts", context.sharedContract] : []),
    ...architectureSliceBlock(context.architectureSlice),
    "",
    "You are repairing explicit findings from an independent verification of this phase.",
    processBlock(),
    completionBlock(),
    "This is a bounded REPAIR session, not the read-only verification session and not a new implementation.",
    "Read the current code and the cited evidence first. Fix ONLY the listed gaps and their direct causes.",
    "Preserve all existing correct behaviour, previous corrections and unrelated work.",
    "",
    "## Allowed actions and boundaries",
    "- Edit the project's code, tests and required local configuration to close the explicit findings.",
    "- Install, rebuild or restore, with this project's package manager, the project-local dependencies the",
    "  approved infrastructure and the manifests declare, including dependencies the builder could not install.",
    "  Never add, replace or upgrade one they do not declare: the plan chose them. Use existing manifests and",
    "  lockfiles; do not introduce a new stack or unrelated packages.",
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
    "  a failing scenario with an easier mock.",
    "",
    "## Runtime and verification",
    `For Node projects the harness uses \`${process.execPath}\` (${process.version}, ABI ${process.versions.modules}).`,
    "Use that SAME Node executable for installation, rebuilds and checks, with its directory first in",
    "PATH for package-manager scripts. Do not activate another Node/NVM version to make a command pass.",
    "For other stacks use the runtime and commands already declared by this project.",
    "Apply the smallest fix and run the relevant check. Preserve the original failing scenario.",
    ...(context.testCommand
      ? ["The harness will run the complete gate command independently after handoff; use focused checks while repairing:", "", `    ${context.testCommand}`, ""]
      : ["No gate test command was resolved; report that explicitly and use the project's documented checks."]),
    ...(context.e2eCommand
      ? [
          "When relevant and not already covered by a check you ran, the browser command is:",
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

const TASK_LINE = /^TASK\s+(\d+):\s*(DONE|INCOMPLETE)\s*(?:[—-]\s*(.*))?$/i;

/**
 * Lê as linhas TASK pela leitura tolerante de `contract/protocolo.ts` — prosa em
 * volta, raciocínio, negrito, marcador de lista, a chave colada na frase anterior
 * (§40) — e o veredito em qualquer caixa. O que sobra ilegível não é veredito.
 */
export function parseVerification(output: string): TaskVerdict[] {
  const verdicts: TaskVerdict[] = [];
  for (const rawLine of lerProtocolo(output, String.raw`TASK\s+\d+`, "DONE|INCOMPLETE").split("\n")) {
    const match = TASK_LINE.exec(rawLine.replace(/\r$/, "").trim());
    if (!match) continue;
    verdicts.push({
      index: Number(match[1]),
      done: (match[2] ?? "").toUpperCase() === "DONE",
      missing: (match[3] ?? "").trim(),
    });
  }
  return verdicts;
}
