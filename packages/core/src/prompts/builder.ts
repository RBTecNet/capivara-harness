/**
 * Prompts do papel `builder`.
 *
 * Toda sessão é nova e todo prompt é auto-contido: o executor não tem memória da
 * tentativa anterior, e é por isso que o prompt de correção carrega a CAUSA
 * REAL do gate vermelho — a saída do engine, a saída da suíte, as linhas
 * INCOMPLETE do verificador. "Os testes falharam" não diz a ninguém o que fazer.
 */

import { languageBlock } from "./language.js";
import { functionalAcceptanceBlock, proportionateChecksBlock } from "./acceptance-policy.js";

export interface BuilderContext {
  language: string;
  /** Comando exato que o gate 2 vai executar. Ausente quando não foi resolvido. */
  testCommand: string | null;
  containerized: boolean;
  /** Os testes de navegador do projeto, quando o manifesto os declara (§113). Não é o do gate 2. */
  e2eCommand?: string;
  phaseMarkdown: string;
  sharedContract?: string;
  /**
   * A fatia da arquitetura que o `plan` aprovou para esta fase (§125).
   *
   * Sem ela, o executor recebia o markdown da fase e a Stack e as Regras do
   * esqueleto, e redescobria pelo código as decisões que o `plan` já tinha
   * tomado — quais componentes são desta fase, o que eles expõem, de quais
   * contratos ela só consome. Ausente quando a arquitetura não foi comprovada
   * igual à publicada: aí ele lê `architecture.md` inteiro.
   */
  architectureSlice?: string;
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
  /**
   * Esta fase passa pelo gate 4, e a aplicação precisa subir do jeito dele (§107).
   *
   * No `build-96756ca336b0` o contrato só aparecia na causa do último ciclo: o
   * gate sobe com `npm start` e `PORT`, a aplicação abria a 3001 da sua `PORTA`,
   * e três fases bloquearam sem que um executor soubesse o que o gate esperava.
   */
  temFluxos?: boolean;
  /**
   * E o projeto ainda não declara esse `start` (§109).
   *
   * O contrato genérico do §107 não bastou: no `build-96756ca336b0` retomado, as
   * três fases o receberam e as três deixaram o gate 4 descobrir a falta — um
   * ciclo cada. O harness sabe antes do ciclo 1, e agora diz.
   */
  entrypointAusente?: boolean;
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
    "3. .capivara/init/architecture.md — the components, contracts and infrastructure the plan decided",
    "   for the whole product",
    "4. any document the phase text itself cites",
    "Use the build, test and run commands those documents and the existing tooling define.",
    "",
    "## Authority you may not touch",
    ".capivara/init/ is read-only specification: read it, never edit it.",
    ".capivara/runs/ is the orchestrator's control plane: never create, edit or delete anything",
    "under it. Writing there invalidates this attempt.",
  ].join("\n");
}

/**
 * A arquitetura decidida pelo `plan` para a fase, como o executor a recebe (§125).
 *
 * Quem implementa não decide de novo o que o `plan` já decidiu: componentes,
 * contratos, dependências e infraestrutura vêm prontos, e o que a fase consome
 * de outra é consumido como está. Se o código já diverge, a saída é dizer com
 * evidência — não escolher outro desenho em silêncio.
 */
export function architectureSliceBlock(slice: string | undefined): string[] {
  if (!slice || slice.trim() === "") return [];
  return [
    "",
    "## Architecture decided by the plan for this phase",
    "The plan already decided the components, contracts, dependencies and infrastructure below; do not re-decide them.",
    "Implement the components of this phase and provide the contracts listed for them. Consume the contracts of the",
    "components this phase depends on exactly as declared: never rewrite, rename or redesign them. If the code already",
    "diverges from a contract below, report it with evidence instead of silently choosing another design.",
    "",
    slice.trim(),
  ];
}

/** Como o gate 4 sobe a aplicação — só para quem será percorrido nele (§107). */
export function flowStartBlock(context: BuilderContext): string {
  if (!context.temFluxos) return "";
  return [
    "",
    "## How the application is started for the flow gate",
    "After the tests, the gate runs the manifest's `start` entrypoint (`npm start` in a Node project)",
    "from the project root, with `PORT` and `HOST` set in the environment, and walks the flows at that",
    "address. The entrypoint must exist and listen on that `PORT` and `HOST`; a server that only",
    "listens on a fixed port fails the gate. The project may keep its own variable names, as long as",
    "the entrypoint honours these two.",
    ...(context.entrypointAusente
      ? [
          "",
          "This project does NOT declare that entrypoint yet: the manifest has no `start`. Create it in this",
          "session — honouring `PORT` and `HOST` — or the flow gate fails before walking a single flow.",
        ]
      : []),
  ].join("\n");
}

export function testBlock(context: BuilderContext): string {
  if (!context.testCommand) return "";
  const lines = [
    "",
    "## This project's test command",
    "The harness independently runs the full suite with:",
    "",
    `    ${context.testCommand}`,
    "",
    "This is the exact command the gate uses to validate the phase after your handoff.",
    "Use focused checks for changed code and relevant browser or end-to-end tests. Do not add a watch mode.",
    "Reuse existing browser coverage and implement concrete checks requested by the independent validator; do not design a speculative test suite.",
    "A test from an earlier phase that contradicts what this phase requires is out of date: update it.",
  ];
  if (context.containerized) {
    lines.push("This project runs its suite inside a container: run the language tooling and the tests");
    lines.push("through that command, never directly on the host.");
  }
  if (context.e2eCommand) {
    lines.push(
      "",
      "The project's browser and end-to-end tests run with:",
      "",
      `    ${context.e2eCommand}`,
      "",
      "Run them when affected and not already covered: inspect the project's scripts before running a duplicate suite.",
    );
  }
  return lines.join("\n");
}

export function processBlock(): string {
  return [
    "",
    "## Processes started by this session or its tests",
    "Every server started for verification must be cleaned up, including when startup or an assertion fails.",
    "Start the actual executable directly, or use a dedicated process group and terminate that group.",
    "Killing an npm/npx wrapper does not guarantee its server child exits. In Node tests, prefer",
    "process.execPath with the local entrypoint instead of spawning npx as the server owner.",
    "Use try/finally or teardown to stop your own server, and await its exit before restarting on the same port.",
    "Prefer an OS-assigned free port. Never kill unrelated processes by name or by occupied port.",
    "A persistence test must still restart the actual application and verify the stored data; do not",
    "remove that assertion, skip the test or leave a watcher/server running to get a green result.",
    "",
  ].join("\n");
}

/** O executor entrega a implementação; os gates independentes julgam se ela basta. */
export function completionBlock(): string {
  return [
    "",
    "## Finish and hand off to independent verification",
    functionalAcceptanceBlock(),
    proportionateChecksBlock(),
    "Implement every acceptance criterion and its required positive and negative test cases.",
    "After the relevant checks pass, finish using this role's required output protocol so the harness can run its independent gates.",
    "Do not keep inventing new verification infrastructure after completing the phase.",
    "Mutation-testing frameworks, driver interception, loader monkey-patching and persistent test telemetry",
    "are outside this task unless an explicit requirement or an independent finding makes them necessary.",
    "A statement that tests must use an isolated database requires correct isolation and evidence of it;",
    "it does not by itself require a system that detects every hypothetical malicious test.",
    "If a focused check reveals a real defect against a criterion, fix it and rerun the affected checks.",
    "Never drop a requirement, weaken an assertion or skip a failing test to finish sooner.",
    "Your tests and completion marker are evidence for the gates, not approval of the phase.",
    "",
  ].join("\n");
}

export function implementPrompt(context: BuilderContext): string {
  return [
    languageBlock(context.language),
    "",
    "You are a senior developer implementing one phase of this project.",
    ...(context.sharedContract ? ["## Published shared contracts", context.sharedContract] : []),
    ...architectureSliceBlock(context.architectureSlice),
    "",
    discoveryPreamble(),
    testBlock(context),
    processBlock(),
    completionBlock(),
    "",
    "## Dependencies and network",
    "You may install dependencies and download scaffolding with the project's package manager.",
    "Prefer the ecosystem's standard tooling and pin versions the way this project already does.",
    "Never add a new stack, framework or tool that the documentation does not call for.",
    "Scripts you need only for this session go under `.capivara/tmp/`, which never enters a commit.",
    "Keep other scratch files under `$TMPDIR`, never at a fixed path under `/tmp`.",
    flowStartBlock(context),
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
    "2. Reuse or add focused tests for the task's required behaviour, following the project's framework.",
    "3. Run the relevant focused checks for that change, not the complete suite for every item.",
    "4. Fix an actual product failure; correct a demonstrably wrong test expectation while preserving its public scenario.",
    "5. Preserve passing work and proceed once the affected behaviour is verified.",
    "A test must assert the behaviour and failure mode the acceptance criterion actually names.",
    "A matching test name or an alert's existence is not enough: when the criterion requires a",
    "localized network error, reject the real fetch or use `route.abort()` and assert the message;",
    "an HTTP 503 returned by `route.fulfill()` exercises a different path.",
    "",
    "## Mandatory rules",
    "- Use the commands, the test runner and the tooling the project already adopted.",
    "- Tests, fixtures and factories create every dependency they need.",
    "- Preserve required entrypoints and public contracts; equivalent internal names or structure do not justify rework.",
    "- Never skip an item marked [ ].",
    "- Finish after relevant regression checks; the harness runs the complete suite independently.",
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
    ...(context.sharedContract ? ["## Published shared contracts", context.sharedContract] : []),
    ...architectureSliceBlock(context.architectureSlice),
    "",
    discoveryPreamble(),
    testBlock(context),
    processBlock(),
    completionBlock(),
    flowStartBlock(context),
    "",
    "## Situation",
    "A previous session tried to implement the phase below and did not pass verification.",
    "You are a NEW session with no memory of what was done. Read the current code before changing",
    "anything.",
    "",
    "## Mandatory rules",
    "- Fix ONLY what is missing. Do not reimplement what is already correct and tested.",
    "- Preserve corrections already present in this tree, including fixes from an earlier cycle. Patch",
    "  the current implementation in place; do not recreate the phase from scratch.",
    "- The cause below may include evidence, a concrete correction and a regression check from the",
    "  verifier. Use them as your repair plan after checking the current files. If an instruction no",
    "  longer applies, report the exact evidence instead of silently replacing the required behaviour.",
    "- Test the actual failure mode named in each finding. A transport failure needs a rejected fetch",
    "  or `route.abort()`; an HTTP 503 from `route.fulfill()` does not exercise it. When the requirement",
    "  is a localized error, assert the displayed message/language, not just the presence of an alert.",
    "- Do not weaken assertions, skip checks, or substitute an easier scenario to obtain a green test.",
    "- Leave no TODO, no placeholder and no skipped test.",
    "- Run focused checks for the actual fix and hand off for the harness's independent full suite.",
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
    processBlock(),
    completionBlock(),
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
  missing: readonly { technology: string; binary: string; checkArgs?: string[]; installHint?: string; evidence?: string }[];
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
    "You are preparing the declared prerequisites, and doing nothing else.",
    "",
    "## What is missing",
    ...context.missing.flatMap(item => [
      `- ${item.technology} — readiness check (executable and arguments, no shell): ${JSON.stringify([item.binary, ...(item.checkArgs ?? [])])}`,
      ...(item.installHint ? [`  preparation: ${item.installHint}`] : []),
      ...(item.evidence ? [`  failed readiness evidence: ${item.evidence}`] : []),
    ]),
    "",
    "## Your entire task",
    "Install exactly those, using the package manager this system already uses. Start whatever",
    "service each one needs to be usable. Then stop.",
    "For a project npm dependency, use the workspace named by the plan/preparation hint. You may create",
    "a missing minimal package.json containing only the listed dependencies, then install them there.",
    "Keep existing dependency versions and application files intact. Do not move Git refs or commit.",
    "",
    "## What you must not do",
    "- Do not install anything that is not on the list above, however useful it looks.",
    "- Apart from that minimal dependency manifest and its generated lock/node_modules, do not create,",
    "  edit or delete project files: no source, config, fixture or migration.",
    "- Do not implement, scaffold or prepare any part of the application.",
    "- Do not change global configuration beyond what installing these requires.",
    "- Never replace, wrap or patch a third-party CLI to make a readiness check pass. If the check",
    "  itself is invalid, report its exact failure and stop; do not change the tool being checked.",
    "",
    "Your report is not evidence: when you finish, the harness repeats the declared readiness check and that is what",
    "decides. Say plainly what you installed and what failed, including the command that failed.",
  ].join("\n");
}
