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
}

export interface FixContext extends BuilderContext {
  gate: string;
  cause: string;
  /** Verdadeiro quando a sessão anterior não alterou nenhum arquivo. */
  previousWroteNothing: boolean;
}

export const BUILDER_COMPLETE_MARKER = "CAPIVARA_BUILDER_STATUS: COMPLETE";

function discoveryPreamble(): string {
  return [
    "## Discover the stack and the conventions before writing code",
    "This project may use any language or framework. Assume nothing. Before you start, read the",
    "ones that exist, in this order:",
    "1. CAPIVARA.md or AGENTS.md — conventions, commands and project rules",
    "2. .capivara/init/project-description.md — scope, stack and core workflows",
    "3. .capivara/init/user-stories.md — the stories and their acceptance criteria",
    "4. .capivara/init/database-schema.md — the data model",
    "5. any document the phase text itself cites",
    "Use the build, test and run commands those documents and the existing tooling define.",
    "",
    "## Authority you may not touch",
    ".capivara/init/ is read-only specification: read it, never edit it.",
    ".capivara/runs/ is the orchestrator's control plane: never create, edit or delete anything",
    "under it. Writing there invalidates this attempt.",
  ].join("\n");
}

function testBlock(context: BuilderContext): string {
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
    "## The phase to complete",
    context.phaseMarkdown,
  ].join("\n");
}
