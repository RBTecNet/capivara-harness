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
}

export interface FixContext extends BuilderContext {
  gate: string;
  cause: string;
  /** Verdadeiro quando a sessão anterior não alterou nenhum arquivo. */
  previousWroteNothing: boolean;
}

export const BUILDER_COMPLETE_MARKER = "CAPIVARA_BUILDER_STATUS: COMPLETE";

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
    "When the phase is genuinely finished, end your answer with this line, alone:",
    BUILDER_COMPLETE_MARKER,
    "",
    ...(context.skills && context.skills.trim() !== "" ? [context.skills, ""] : []),
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
