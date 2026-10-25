/**
 * Prompt do roteiro de fluxo — o gate que abre a aplicação.
 *
 * Quem escreve o roteiro não é quem implementou a fase, e não escreve na árvore:
 * devolve o roteiro em texto e o harness o grava sob `.capivara/flows/`. É a
 * mesma independência do gate 3, pela mesma razão — quem implementou já provou,
 * no piloto 6, que consegue aprovar o próprio trabalho lendo o próprio código.
 *
 * O roteiro é de FLUXO, não de unidade. Ele percorre a aplicação pela interface,
 * como o desenvolvedor que abriu o produto e em dois minutos achou o cadastro de
 * membros que não cadastrava nada.
 */

import { languageBlock } from "./language.js";
import { flowScopeBlock, interfaceContractBlock, transientStateBlock } from "./acceptance-policy.js";
import { lerProtocolo, semRaciocinio } from "../contract/protocolo.js";

export interface FlowWorkflowContext {
  number: string;
  name: string;
  steps: string[];
}

export interface FlowAuthorContext {
  language: string;
  workflow: FlowWorkflowContext;
  /** Onde a aplicação vai estar de pé quando o roteiro rodar. */
  baseUrl: string;
  sharedContract?: string;
  phaseMarkdown?: string;
  /** O que o gate recusou na tentativa anterior, quando houve uma. */
  rejected?: string[];
  previousScript?: string;
  /**
   * O comando da suíte do projeto que o harness roda no G2 (§134): é ela que prova
   * o fluxo que nenhum roteiro percorre. `null` é o projeto sem suíte que o harness
   * rode; ausente, o prompt não diz nada sobre ela.
   */
  suite?: string | null;
  /**
   * A passagem em que o roteiro vai rodar: quem roda antes, o que começa vazio,
   * e o ajudante para o que não é interface. Sem isto o roteirista escreve para
   * uma máquina que ele imagina — e no `assistencia2` imaginou um instalador que
   * alguém já teria rodado.
   */
  passagem?: {
    anteriores: Array<{ number: string; name: string; arquivo: string }>;
    bancoNovo: string[];
    migracao: string | null;
    ajudante: string;
  };
}

export const FLOW_HEADER = "CAPIVARA_FLOW";

/**
 * Ler o produto sem mudar nada (§133).
 *
 * Aqui estava "Do not run commands" — e no codex ler arquivo É rodar comando,
 * não há outra ferramenta. No Astra (`build-082c825927b3`) o roteirista recusou
 * sete vezes em oito, pedindo que alguém colasse os arquivos, e a fase parou com
 * o produto aprovado no G2 e no G3. O verificador sempre teve a frase certa; o
 * roteirista e a triagem, que também leem o produto, ficaram com a metade.
 */
export const LEITURA_SEM_EFEITO = [
  "You may run commands that change nothing — reading files, listing directories, searching the source.",
  "Do not run tests, servers, builds, browser probes or installations, and do not write anything, in this session.",
] as const;

/**
 * O produto que não se usa num navegador (§133).
 *
 * O G4 abre a aplicação por HTTP e a percorre com Playwright; o esqueleto declara
 * fluxos de qualquer produto. No Luna (`build-521a72e8dbb5`, desktop Avalonia) o
 * gate pediu um `start` no manifesto, o executor pôs um `package.json` com
 * `dotnet run` e depois um `HttpListener` falso dentro do produto, e o roteirista
 * — que tinha lido o contrato e dito que era desktop — inventou seletores web.
 * Quem decide é o roteirista, que é independente e lê o contrato; o trecho que ele
 * cita é conferido contra o contrato, e o fluxo fica NÃO percorrido, nunca aprovado.
 */
export const FORA_DO_NAVEGADOR = "CAPIVARA_FORA_DO_NAVEGADOR";

/**
 * A prova de um passo do fluxo que não se percorre (§134): o teste da suíte do
 * próprio projeto que o exercita, citado pelo roteirista — que é independente e
 * leu a suíte —, rodado pelo harness no G2 e conferido pelo Core. No Luna a suíte
 * xUnit existia, o G2 nunca a rodou, e o fluxo ficou pendente com o produto certo.
 */
export const PROVA = "CAPIVARA_PROVA";

/** O passo que nenhum teste da suíte exercita, com o porquê: continua pendente e nomeado (§134). */
export const SEM_PROVA = "CAPIVARA_SEM_PROVA";

export interface ProvaCitada {
  passo: number;
  /** O arquivo de teste, relativo à raiz do projeto. */
  arquivo: string;
  teste: string;
}

export interface PassoSemProva {
  passo: number;
  motivo: string;
}

/** Sem crases, aspas e espaço em volta. */
function limpar(texto: string): string {
  return texto.trim().replace(/^[`"'«“]+|[`"'»”]+$/g, "").trim();
}

/**
 * As linhas de prova da resposta, uma por linha, com ou sem crases em volta.
 * Linha fora do formato não é prova: o passo dela fica sem prova, e isso é dito.
 */
export function lerProvas(resposta: string): { provas: ProvaCitada[]; semProva: PassoSemProva[] } {
  const provas: ProvaCitada[] = [];
  const semProva: PassoSemProva[] = [];
  for (const bruta of lerProtocolo(resposta, `${PROVA}|${SEM_PROVA}`).split(/\r?\n/)) {
    const linha = limpar(bruta);
    const prova = new RegExp(`^${PROVA}:\\s*passo\\s+(\\d+)\\s*[—–:-]+\\s*(.+?)\\s*::\\s*(.+)$`, "u").exec(linha);
    if (prova) {
      const arquivo = limpar(prova[2] ?? "");
      const teste = limpar(prova[3] ?? "");
      if (arquivo !== "" && teste !== "") provas.push({ passo: Number(prova[1]), arquivo, teste });
      continue;
    }
    const sem = new RegExp(`^${SEM_PROVA}:\\s*passo\\s+(\\d+)\\s*[—–:-]+\\s*(.+)$`, "u").exec(linha);
    if (sem) semProva.push({ passo: Number(sem[1]), motivo: limpar(sem[2] ?? "") });
  }
  return { provas, semProva };
}

/** O trecho citado depois da marca, sem aspas, crases nem pontuação final em volta; `null` sem marca ou sem trecho. */
export function lerForaDoNavegador(resposta: string): string | null {
  const linha = new RegExp(`${FORA_DO_NAVEGADOR}:[ \\t]*([^\\n]*)`).exec(lerProtocolo(resposta, FORA_DO_NAVEGADOR))?.[1] ?? "";
  const trecho = linha.replace(/^[\s"'«“`]+|[\s"'»”`.;:,!?]+$/g, "");
  return trecho === "" ? null : trecho;
}

/** O rótulo de cada passo. É estrutural: o gate conta por ele. */
export function stepLabel(index: number, step: string): string {
  return `passo ${index + 1}: ${step}`;
}

export function flowPrompt(context: FlowAuthorContext): string {
  const { workflow } = context;
  const passos = workflow.steps.map((step, index) => `${index + 1}. ${step}`);
  const passagem = context.passagem;
  const ajudante = (passagem?.ajudante ?? "capivara-comando.ts").replace(/\.ts$/, "");

  return [
    languageBlock(context.language),
    "",
    FLOW_HEADER,
    "",
    "You write ONE Playwright script that walks a user flow through the running application.",
    "You did not implement this phase. You never write, edit, create, delete or commit any file:",
    "you return the script as text and the harness stores it.",
    "",
    "You may read the real source — pages, templates, components, routes — to find the actual",
    "selectors. Read the product, never guess the markup.",
    ...LEITURA_SEM_EFEITO,
    "Do not create temporary scripts or delegate work. The harness executes the returned script once it is ready.",
    "The runtime instructions below describe the returned script, never actions for your authoring session.",
    "",
    "## A product used outside the browser",
    "This gate walks the flow against the running product. When the published contract in this prompt says users",
    "reach the product neither through a browser nor through a terminal — a native desktop window, a mobile device, a",
    "library with no interface of its own — no script can walk this flow: do not invent pages or selectors. Answer",
    "instead with this line, then one line per step:",
    `\`${FORA_DO_NAVEGADOR}: <the line of the contract's Stack that says how users reach the product, copied word for word>\``,
    `\`${PROVA}: passo <n> — <path of a test file of the project> :: <name of the test>\``,
    `\`${SEM_PROVA}: passo <n> — <why no test of the project's suite does what this step says>\``,
    ...suiteBlock(context.suite),
    "A Stack line that says the product is used in a browser never takes a flow out of it, and neither does a flow that",
    "already ran steps in a browser in this phase. Cite the test by its own name — the method or function the suite runs,",
    "or the exact title of its `it`/`test` — never a class, an attribute or a helper; a skipped test proves nothing.",
    "The harness checks the Stack line and every cited test. A flow whose every step has an accepted test is concluded",
    "by the suite; any other stays NOT walked — a pending obligation reported to the developer with the steps you named,",
    "never a pass. A step done in a terminal inside a product used through a browser is not this case: walk it with",
    "`comandoDoProjeto`, below.",
    "",
    "## A product used in a terminal",
    "When the contract says users reach the product through a terminal — a command-line program, a terminal interface",
    "driven by its input — walk the flow with `comandoDoProjeto` alone: run the product's own commands with their input,",
    "and assert the exit code, the output and what they wrote. Use no `page`, `request`, `context`, `browser`,",
    "`aplicacaoPropria` or URL: the harness then runs the script without starting a server or opening a browser, and",
    "the running application described below does not exist for it. Write the test as `async () => { ... }`.",
    flowScopeBlock(),
    transientStateBlock(true),
    "",
    `## The flow — workflow ${workflow.number}: ${workflow.name}`,
    "",
    ...passos,
    interfaceContractBlock(context.sharedContract, context.phaseMarkdown),
    "",
    "## The script",
    "",
    `The application is ALREADY RUNNING at ${context.baseUrl} when your script starts: the harness`,
    "builds it, starts it and waits for it to answer, and that instance belongs to the gate — walk the",
    "flow against it.",
    "",
    "When a step needs to start, stop or RESTART the server — \"restart the server with the same",
    "database and check what persisted\" — do it for real with `aplicacaoPropria()` from the helper",
    "(below). It starts another instance of the same product, with the gate's start command, this",
    "pass's environment and the SAME database file, on a free port of its own, and waits for it to",
    "answer. `reiniciar()` stops that process for real and starts it again on the same port and",
    "database; `encerrar()` stops it — call it when you are done. A restart runs the start command",
    "again: raise the test's timeout with `test.setTimeout(300_000)` in a flow that restarts.",
    "",
    "## The environment your script runs in",
    "",
    "Every pass of this gate starts from ZERO. The home directory (`os.homedir()`) is a new, empty",
    "directory" +
      (passagem && passagem.bancoNovo.length > 0
        ? `, and the database is a new, empty file (${passagem.bancoNovo.map((chave) => `\`${chave}\``).join(", ")} ` +
          "already point to it in the environment)" +
          (passagem.migracao !== null
            ? `. The harness applies \`${passagem.migracao}\` to it before the application starts, so the schema exists and no row does`
            : ". No migration is applied for you: if your flow needs the schema, apply the project's own migration first")
        : "") +
      ". Nothing from an earlier pass survives, so never assume an operator already did something.",
    "",
    ...(passagem && passagem.anteriores.length > 0
      ? [
          "The flows run ONE AT A TIME, in this order, sharing the application and the data. These run",
          "before yours, and yours starts from the state they leave:",
          "",
          ...passagem.anteriores.map((anterior) => `- workflow ${anterior.number} — ${anterior.name} (\`${anterior.arquivo}\`)`),
          "",
          "Read their scripts to know that state: a password they changed, a record they created. Never",
          "depend on a flow that is not in this list. Preserve prerequisite state until the steps needing it are done.",
          "A declared empty-state step may remove this pass's test data through the real API; never fabricate an empty response.",
        ]
      : [
          "Your flow is the FIRST of the pass: nothing ran before it, and it must set up whatever it needs.",
        ]),
    "",
    "## Steps that happen in a terminal, not in the interface",
    "",
    "Some steps are what an operator does in a terminal — run the installer, apply the migration, seed",
    "data, read a file the product wrote. Do those for real, with the helper the harness provides:",
    "",
    "```ts",
    `import { comandoDoProjeto } from './${ajudante}';`,
    "",
    "const resultado = await comandoDoProjeto('npm', ['run', '<a script the project declares>']);",
    "expect(resultado.codigo, resultado.saida).toBe(0);",
    "```",
    "",
    "It runs ONE command in the project root with this pass's environment and returns",
    "`{ codigo, saida }` when the command ends. Use commands the project declares — read its manifest.",
    "A server never ends, so never start one with it; use `aplicacaoPropria` instead:",
    "",
    "```ts",
    `import { aplicacaoPropria } from './${ajudante}';`,
    "",
    "const app = await aplicacaoPropria();",
    "const criada = await page.request.post(`${app.url}/api/<resource>`, { data: { /* ... */ } });",
    "await app.reiniciar();",
    "const depois = await page.request.get(`${app.url}/api/<resource>/<id>`);",
    "expect(await depois.json()).toEqual(/* what was saved */);",
    "await app.encerrar();",
    "```",
    "",
    "Other processes a step needs may be started with `child_process`; stop every process you start.",
    "",
    "Use RELATIVE paths ('/', '/clientes') — the base URL is configured. Never write an absolute",
    "`http://127.0.0.1:...` or `http://localhost:...`: where the application lives is the harness's",
    "decision, and hardcoding it is how a script ends up proving something about another process.",
    "The one exception is the instance you start yourself: reach it through `app.url`.",
    "",
    "Return EXACTLY ONE fenced code block, TypeScript, and nothing else — no preamble, no",
    `explanation after it (the \`${FORA_DO_NAVEGADOR}\` answer above, with its step lines, is the only other answer). The block is the whole file:`,
    "",
    "```ts",
    "import { expect, test } from '@playwright/test';",
    "",
    `test('workflow ${workflow.number} — ${workflow.name}', async ({ page }) => {`,
    `  await test.step('${stepLabel(0, workflow.steps[0] ?? "<o primeiro passo>")}', async () => {`,
    "    // drive the real interface, then assert what the user would see",
    "  });",
    "});",
    "```",
    "",
    "Rules the harness checks mechanically, before running anything:",
    `- ONE \`test.step\` per declared step, in order. This flow has ${workflow.steps.length}.`,
    "- The step title is `passo <n>: ` followed by the step text, copied as it is written above.",
    "- At least one `expect(...)` inside each step: a step that only clicks proves nothing.",
    "- No `test.skip`, no `test.fixme`, no `.only`.",
    "- Every step is EXECUTED. No assertion on a constant (`expect(false)`, `expect(true)`), no",
    "  `CAPIVARA_REMARK` and no \"pending\" annotation in place of a step: a step you did not run fails.",
    "- Never fabricate the product backend's responses with fulfill, HAR or stubs, including success, empty lists or counters.",
    "  Test empty lists by removing the test's data through the real API in this disposable pass.",
    "  To observe loading, hold a GET then continue it to the real backend; arrange the observation before navigation.",
    "  To observe API unavailability, page.route may abort a GET. Check request.method() === 'GET'; continue every other method.",
    "  The returned script may control these reads; this does not authorize running commands in your authoring session.",
    "  A third-party service the product calls out to may have responses stubbed, and only that.",
    "",
    "What the assertions are for: a step must FAIL when the product cannot do it. Asserting that",
    "a button exists proves markup; asserting what happens after it is clicked proves the flow.",
    "Prefer role and visible text over CSS classes — they survive a redesign and they are what the",
    "user actually sees.",
    "",
    "SCOPE YOUR LOCATORS. A bare `getByRole(...)` matches everything on the page, including what the",
    "framework injects, and every framework injects something — a route announcer, a live region, a",
    "dev overlay. One real case: a hidden `role=\"alert\"` announcer on every page, so",
    "`getByRole(\"alert\")` matches two elements and Playwright refuses it. Anchor each locator to",
    "the region it belongs to — `page.getByRole(\"main\")`, the form, the dialog — or narrow it by",
    "accessible name. A locator that matches twice fails on a product that is working.",
    "Navigation belongs to its actual navigation region; do not search sidebar links inside main.",
    ...(context.previousScript ? [
      "", "## Existing script — repair this file, do not start over", "",
      "Preserve the working steps and assertions. Apply only the supplied correction; do not add new checks.",
      "```ts", context.previousScript.trim(), "```",
    ] : []),
    ...(context.rejected && context.rejected.length > 0
      ? [
          "",
          "## The previous attempt was rejected",
          "",
          ...context.rejected.map((defect) => `- ${defect}`),
          "",
          "Fix exactly these and return the whole file again.",
        ]
      : []),
  ].join("\n");
}

/**
 * O que o roteirista precisa saber da suíte para provar o fluxo por ela (§134).
 * Ausente, só a regra; `null`, que não há suíte e nenhum passo se prova por teste.
 */
function suiteBlock(suite: string | null | undefined): string[] {
  if (suite === undefined) {
    return ["Cite only tests of the project's own suite that you read in the source; a test that only builds, starts or opens the product proves no step."];
  }
  if (suite === null) {
    return [
      "This project has no suite the harness can run, so no step can be proven by a test here: answer the first line",
      `and one \`${SEM_PROVA}\` line per step.`,
    ];
  }
  return [
    `The project's own suite, which the harness runs and must pass on this code, is \`${suite}\`.`,
    "Read its tests and cite, for each step, a test that performs what the step says and asserts its result:",
    "a test that only builds, starts or opens the product proves no step. Cite only tests you read in the source.",
    "A cited test counts only when the suite's own report shows it ran and passed in this run — today, a .NET",
    `suite's TRX report. For any other suite, answer a \`${SEM_PROVA}\` line per step naming the test that covers it.`,
  ];
}

/**
 * O roteiro dentro da resposta.
 *
 * Um modelo que responde só com o bloco é o caso feliz; um que escreve uma linha
 * antes dele é o caso comum, e recusar isso gastaria um ciclo inteiro para ganhar
 * nada. Sem nenhum bloco, devolve vazio e quem chamou decide.
 */
export function extractFlowScript(resposta: string): string {
  const output = semRaciocinio(resposta);
  const blocos = [...output.matchAll(/```(?:ts|typescript|js|javascript)?\s*\n([\s\S]*?)```/g)];
  if (blocos.length === 0) return "";
  // O último: um modelo que mostra o antes e o depois põe o resultado por último.
  return (blocos[blocos.length - 1]?.[1] ?? "").trim()
    .replace(/^<!--[ \t]*inputs:[^\n]*-->(?=\r?\n|$)/, stamp => `// ${stamp}`);
}
