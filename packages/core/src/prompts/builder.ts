/**
 * Prompts do papel `builder`.
 *
 * Toda sessão é nova e todo prompt é auto-contido: o executor não tem memória da
 * tentativa anterior, e é por isso que o prompt de correção carrega a CAUSA
 * REAL do gate vermelho — a saída do engine, a saída da suíte, as linhas
 * INCOMPLETE do verificador. "Os testes falharam" não diz a ninguém o que fazer.
 */

import { languageBlock } from "./language.js";

export interface BuilderContext {
  language: string;
  /** Comando exato que o gate 2 vai executar. Ausente quando não foi resolvido. */
  testCommand: string | null;
  containerized: boolean;
  phaseMarkdown: string;
  /**
   * As skills desta fase, já escolhidas por área e materializadas no disco.
   *
   * Vem pronto porque quem escolhe não é quem executa: o §34 decidiu que a
   * seleção é o cruzamento de duas listas fechadas, não uma decisão de modelo no
   * meio da fase.
   */
  skills?: string;
  /** Onde anotar o que aprendeu. Ausente desliga o pedido. */
  memoriasDir?: string;
  /**
   * Esta fase será percorrida no navegador, e o runner ainda não existe.
   *
   * O harness sabe disso no preflight e sabia de novo ao montar a fase — e
   * contava só depois, quando o gate 4 reprovava. No `assitencia` a P04 gastou um
   * ciclo inteiro assim: meia hora de sessão para descobrir uma ausência que já
   * estava anotada antes da primeira chamada.
   */
  runnerDeFluxosAusente?: boolean;
}

export interface FixContext extends BuilderContext {
  gate: string;
  cause: string;
  /** Verdadeiro quando a sessão anterior não alterou nenhum arquivo. */
  previousWroteNothing: boolean;
}

/**
 * Onde o executor anota o que só ele descobriu.
 *
 * Ele apanha para saber que este projeto precisa de `--legacy-peer-deps`, e esse
 * conhecimento morria com a sessão. Escrever arquivo é coisa que toda CLI sabe
 * fazer; o harness recolhe no fim da fase e manda para a base como rascunho.
 *
 * Só o que NÃO ESTÁ NO CÓDIGO. Um resumo do que a fase implementou seria ruído:
 * o código já diz isso, e o próximo run vai lê-lo de qualquer forma.
 */
function memoriaBlock(context: { memoriasDir?: string }): string[] {
  if (!context.memoriasDir) return [];
  return [
    "## What you learned that is not in the code",
    "",
    `If — and only if — you hit something a future session would waste time rediscovering, write it to \`${context.memoriasDir}/\`:`,
    "",
    `- \`${context.memoriasDir}/armadilha-<assunto>.md\` — a trap: what failed, what fixed it, and the cost.`,
    `- \`${context.memoriasDir}/convencao-<assunto>.md\` — a rule this project follows that the code does not state.`,
    "",
    "One short file each, starting with a `#` heading. Write nothing when nothing surprised you:",
    "a summary of what you implemented is noise — the code already says that, and the next session reads it.",
    "",
  ];
}

export const BUILDER_COMPLETE_MARKER = "CAPIVARA_BUILDER_STATUS: COMPLETE";

/**
 * A saída do executor quando quem está errado é o roteiro, não o produto.
 *
 * O gate 4 devolve "a aplicação não cumpriu um fluxo declarado", e o executor só
 * tinha uma forma de responder: mexer no produto. Quando o roteiro é que exige o
 * que ninguém pediu, isso piora a aplicação para satisfazer um teste — e foi o
 * que aconteceu na fase 4 do MCP_teste2:
 *
 *   O título "Novo cadastro" está na seção, fora do `form`. O fluxo procura esse
 *   heading dentro do formulário — vou colocá-lo lá.
 *
 * O título estava no lugar certo. O roteiro é que se ancorava no `form` e
 * procurava dentro dele um heading que é irmão, não filho. O produto foi
 * remodelado para caber num seletor.
 *
 * Com este marcador o executor ganha a outra saída: dizer que o roteiro está
 * errado, e por quê. O harness reescreve o ROTEIRO — por uma sessão
 * independente, que lê o produto de novo — em vez de reescrever o produto. E o
 * escape se corrige sozinho: se o produto estiver mesmo errado, o roteiro novo
 * reprova de novo e a fase continua devendo o que devia.
 */
export const BUILDER_FLOW_WRONG_MARKER = "CAPIVARA_ROTEIRO_ERRADO";

/** O executor declarou que o defeito é do roteiro? Devolve o motivo que ele deu. */
export function declarouRoteiroErrado(output: string): string | null {
  // O negrito do Markdown cerca a chave de qualquer lado — `**CHAVE:**` e
  // `**CHAVE**:` — e nenhum dos dois muda o que ele quis dizer (§40).
  const linha = new RegExp(`^[\\s*>-]*${BUILDER_FLOW_WRONG_MARKER}[\\s*]*:?(.*)$`, "im").exec(output);
  if (!linha) return null;
  return (linha[1] ?? "").replace(/^[\s*]+/, "").trim() || "o executor não explicou o motivo";
}

export function discoveryPreamble(): string {
  return [
    /*
     * Onde construir precisava ser dito.
     *
     * O prompt nunca disse, e os executores mais fortes inferiam. O mimo, mais
     * fraco, criou `tmp/biblioteca-app/` e montou o projeto inteiro lá dentro:
     * a raiz ficou vazia, o gate 2 não achou comando de teste, e a fase entrou
     * em ciclo de correção sem que nada estivesse errado com o código escrito.
     *
     * Um harness que se propõe a rodar com modelo barato não pode depender de
     * inferência para a pergunta mais básica de todas.
     */
    "## Where the project lives",
    "You are already inside the project. Build IN THE CURRENT DIRECTORY: `package.json`, `src/`,",
    "the config files and everything else go at this root, next to `.capivara/`.",
    "Never create a subdirectory to hold the project — not `app/`, not `tmp/`, not a folder named",
    "after the product. A scaffolding tool that wants to create one (`npm create vite@latest myapp`)",
    "must be pointed at `.` instead, or its output moved to this root afterwards.",
    "The verifier reads this directory. A project built one level down reads as a project that was",
    "never built.",
    "",
    "## Discover the stack and the conventions before writing code",
    "This project may use any language or framework. Assume nothing. Before you start, read the",
    "ones that exist, in this order:",
    "1. CAPIVARA.md or AGENTS.md — conventions, commands and project rules",
    "2. .capivara/init/skeleton.md — the stack, the data model, the stories, the workflows, and the",
    "   cross-cutting rules that every phase of this project has to honour",
    "3. any document the phase text itself cites",
    "Use the build, test and run commands those documents and the existing tooling define.",
    "",
    "## Authority you may not touch",
    ".capivara/init/ is read-only specification: read it, never edit it.",
    ".capivara/runs/ is the orchestrator's control plane: never create, edit or delete anything",
    "under it. Writing there invalidates this attempt.",
  ].join("\n");
}

export function testBlock(context: BuilderContext): string {
  if (!context.testCommand) return "";
  const lines = [
    "",
    "## This project's test command",
    "Always run the suite with:",
    "",
    `    ${context.testCommand}`,
    "",
    "This is the exact command used to validate the phase. Do not use another runner and do not",
    "run the tests outside it. A different runner can show you green while the gate sees red.",
  ];
  if (context.containerized) {
    lines.push("This project runs its suite inside a container: run the language tooling and the tests");
    lines.push("through that command, never directly on the host.");
  }
  return lines.join("\n");
}

export function implementPrompt(context: BuilderContext): string {
  return [
    languageBlock(context.language),
    "",
    "You are a senior developer implementing one phase of this project.",
    "",
    discoveryPreamble(),
    testBlock(context),
    "",
    "## Dependencies and network",
    "You may install dependencies and download scaffolding with the project's package manager.",
    "Prefer the ecosystem's standard tooling and pin versions the way this project already does.",
    "Never add a new stack, framework or tool that the documentation does not call for.",
    ...(context.runnerDeFluxosAusente
      ? [
          "",
          "This phase declares user flows, and after you finish they are walked through the running",
          "application with `@playwright/test` — which is NOT installed in this project yet. Install it as",
          "a dev dependency while you are here, and make sure the browser is available",
          "(`npx playwright install chromium`). It is not part of the phase's work and no criterion asks",
          "for it; it is the tooling that proves the phase, and installing it now saves a whole cycle.",
          "The package is `@playwright/test`, the test runner — not `playwright`, the library. Having the",
          "second one does not satisfy the first.",
        ]
      : []),
    "",
    "## Your task now",
    "Implement the phase below COMPLETELY.",
    "",
    "For each item:",
    "1. Write the complete code. No TODO, no placeholder, no stub.",
    "2. Create the tests the task lists, following the project's test framework.",
    "3. Run the suite with the project's test command.",
    "4. When a test fails, fix the code and run it again.",
    "5. Move to the next item only when its tests pass.",
    "",
    "## Mandatory rules",
    "- Use the commands, the test runner and the tooling the project already adopted.",
    "- Tests, fixtures and factories create every dependency they need.",
    "- Class, file and method names follow exactly what the phase describes.",
    "- Never skip an item marked [ ].",
    "- At the end, verify that the whole suite passes.",
    "",
    "When the phase is genuinely finished, end your answer with this line, alone:",
    BUILDER_COMPLETE_MARKER,
    "",
    ...(context.skills && context.skills.trim() !== "" ? [context.skills, ""] : []),
    ...memoriaBlock(context),
    "## The phase to implement",
    context.phaseMarkdown,
  ].join("\n");
}

export function fixPrompt(context: FixContext): string {
  const note = context.previousWroteNothing
    ? "The previous session ended without changing any file. "
    : "";
  return [
    languageBlock(context.language),
    "",
    "You are a senior developer completing a partially implemented phase.",
    "",
    discoveryPreamble(),
    testBlock(context),
    "",
    "## Situation",
    "A previous session tried to implement the phase below and did not pass verification.",
    "You are a NEW session with no memory of what was done. Read the current code before changing",
    "anything.",
    "",
    "## Mandatory rules",
    "- Fix ONLY what is missing. Do not reimplement what is already correct and tested.",
    "- Leave no TODO, no placeholder and no skipped test.",
    "- Run the project's test suite at the end and make sure it passes.",
    "",
    `## Why it failed (${context.gate})`,
    "````",
    `${note}${context.cause}`,
    "````",
    "",
    ...(context.gate.includes("gate 4")
      ? [
          "## If the product is right and the SCRIPT is wrong",
          "",
          "The flow script is written by another session, from the phase and the real markup. It can be",
          "wrong: anchored to a container the element does not live in, asserting a structure no acceptance",
          "criterion asks for, expecting a label the phase never promised.",
          "",
          "When that is the case, DO NOT reshape the product to satisfy it. Moving a heading inside a form",
          "because a selector looks for it there makes the application worse to make a test pass, and the",
          "next reader inherits a layout nobody chose.",
          "",
          `Answer with this line instead, and say why on the same line: \`${BUILDER_FLOW_WRONG_MARKER}: <why>\``,
          "The harness rewrites the script — another independent session, reading the product again — and",
          "runs the flow once more. If the product really is wrong, the new script fails too and the phase",
          "still owes what it owes. So use it when you are right, and fix the product when you are not.",
          "",
        ]
      : []),
    "When the phase is genuinely finished, end your answer with this line, alone:",
    BUILDER_COMPLETE_MARKER,
    "",
    ...(context.skills && context.skills.trim() !== "" ? [context.skills, ""] : []),
    ...memoriaBlock(context),
    "## The phase to complete",
    context.phaseMarkdown,
  ].join("\n");
}

/**
 * Prompt de correção da aceitação operacional.
 *
 * Aqui a evidência não é um teste vermelho: é o produto que não subiu numa cópia
 * limpa. O executor precisa saber disso, porque a correção é de outra natureza —
 * migração que não roda, dependência de sistema ausente, configuração que só
 * existia na máquina de quem escreveu.
 */
export function acceptancePrompt(context: BuilderContext & { cause: string; attempt: number }): string {
  return [
    languageBlock(context.language),
    "",
    "You are a senior developer fixing a product that does not run.",
    "",
    discoveryPreamble(),
    testBlock(context),
    "",
    "## Situation",
    "Every phase is implemented and the test suite is green, but the product failed operational",
    "acceptance: it was copied to a clean directory — no node_modules, no untracked files, nothing",
    "but what is committed — and there it did not build, did not migrate, or did not stay up.",
    "",
    "A green suite proves the rules. This proves the product runs. They are not the same thing, and",
    "this is the one the developer will hit first.",
    "",
    "## Mandatory rules",
    "- Fix the cause, not the symptom. Do not weaken the acceptance to make it pass.",
    "- Never delete, skip or disable a test to get past this.",
    "- A missing system prerequisite is installable: you have system access.",
    "- Configuration that only worked on the author's machine is the defect, not the environment.",
    "- Keep the suite green: run it before finishing.",
    "",
    "## What failed",
    "````",
    context.cause,
    "````",
    "",
    "When the product genuinely runs from a clean copy, end your answer with this line, alone:",
    BUILDER_COMPLETE_MARKER,
  ].join("\n");
}

export interface InstallContext {
  language: string;
  /** O que falta, com o executável que prova a presença. */
  missing: { technology: string; binary: string }[];
}

/**
 * Uma sessão do executor com um escopo só: instalar.
 *
 * Escopo estreito é o que impede a sessão de "aproveitar a viagem". Um executor
 * solto numa máquina com permissão de sistema e um prompt vago instala
 * dependência que ninguém pediu, mexe em configuração global e começa a
 * implementar o projeto — e nada disso passa por gate nenhum, porque acontece
 * antes de a primeira fase existir.
 *
 * A saída dele não é evidência: quem confirma é `which`, depois.
 */
export function installPrompt(context: InstallContext): string {
  return [
    languageBlock(context.language),
    "",
    "You are installing system prerequisites on this machine, and doing nothing else.",
    "",
    "## What is missing",
    ...context.missing.map((item) => `- ${item.technology} — proven present when \`which ${item.binary}\` finds it`),
    "",
    "## Your entire task",
    "Install exactly those, using the package manager this system already uses. Start whatever",
    "service each one needs to be usable. Then stop.",
    "",
    "## What you must not do",
    "- Do not install anything that is not on the list above, however useful it looks.",
    "- Do not create, edit or delete any file of the project. Not a config, not a fixture, not a",
    "  migration. The project has not started being built yet.",
    "- Do not implement, scaffold or prepare any part of the application.",
    "- Do not change global configuration beyond what installing these requires.",
    "",
    "Your report is not evidence: when you finish, the harness runs `which` again and that is what",
    "decides. Say plainly what you installed and what failed, including the command that failed.",
  ].join("\n");
}
