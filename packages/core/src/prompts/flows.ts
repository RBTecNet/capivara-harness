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
  /** O que o gate recusou na tentativa anterior, quando houve uma. */
  rejected?: string[];
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
    "",
    `## The flow — workflow ${workflow.number}: ${workflow.name}`,
    "",
    ...passos,
    "",
    "## The script",
    "",
    `The application is ALREADY RUNNING at ${context.baseUrl} when your script starts. The harness`,
    "builds it, starts it and waits for it to answer — that is not your job and you must not do it:",
    "no `child_process`, no `spawn`, no starting, stopping or building a server, no polling loop",
    "waiting for a port. A script that brings up a second server fights the one that is already",
    "there, and what fails is your server, not the product.",
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
          "undo it, and never depend on a flow that is not in this list.",
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
    "`{ codigo, saida }`. Use only commands the project declares — read its manifest. It is the only way",
    "to reach the terminal: `child_process` stays forbidden, and the helper never builds, starts or",
    "serves the application, which is already running.",
    "",
    "Use RELATIVE paths ('/', '/clientes') — the base URL is configured. Never write an absolute",
    "`http://127.0.0.1:...` or `http://localhost:...`: where the application lives is the harness's",
    "decision, and hardcoding it is how a script ends up proving something about another process.",
    "",
    "Return EXACTLY ONE fenced code block, TypeScript, and nothing else — no preamble, no",
    "explanation after it. The block is the whole file:",
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
    "- Never intercept or stub the product's own backend. The point is to exercise it for real.",
    "  A third-party service the product calls out to may be stubbed, and only that.",
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
 * O roteiro dentro da resposta.
 *
 * Um modelo que responde só com o bloco é o caso feliz; um que escreve uma linha
 * antes dele é o caso comum, e recusar isso gastaria um ciclo inteiro para ganhar
 * nada. Sem nenhum bloco, devolve vazio e quem chamou decide.
 */
export function extractFlowScript(output: string): string {
  const blocos = [...output.matchAll(/```(?:ts|typescript|js|javascript)?\s*\n([\s\S]*?)```/g)];
  if (blocos.length === 0) return "";
  // O último: um modelo que mostra o antes e o depois põe o resultado por último.
  return (blocos[blocos.length - 1]?.[1] ?? "").trim();
}
