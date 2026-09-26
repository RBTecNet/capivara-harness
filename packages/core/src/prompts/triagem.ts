/**
 * A triagem do gate 4 — de quem é a falha, antes de alguém trabalhar nela.
 *
 * O gate 4 reprovava e mandava ao executor o rastro do Playwright. O executor
 * era a única parte do ciclo que via o produto e o erro juntos, e respondia de
 * dois jeitos: mexendo no produto, ou gastando o ciclo inteiro para dizer que o
 * roteiro estava errado. Na P05 do `assistencia2` foram seis ciclos assim —
 * rótulo que não existia, título que muda depois de excluir —, e três defeitos
 * reais do produto no meio deles, que chegaram ao executor como rastro cru.
 *
 * A triagem é uma sessão que só lê. Ela recebe o que o executor não recebia: o
 * RETRATO da página no instante da falha, que o Playwright grava e ninguém lia.
 * Com ele, "o botão chama Salvar, não Salvar registro" deixa de ser um ciclo e
 * vira uma linha.
 */

import { languageBlock } from "./language.js";

export const TRIAGE_HEADER = "CAPIVARA_TRIAGE";

export type TipoDaTriagem = "PRODUTO" | "ROTEIRO" | "CRITERIO";

export interface Triagem {
  tipo: TipoDaTriagem;
  evidencia: string;
  onde: string;
  criterio: string;
  correcao: string;
}

export interface TriageContext {
  language: string;
  phaseMarkdown: string;
  workflow: { number: string; name: string; steps: string[] };
  /** O roteiro que falhou, inteiro. */
  script: string;
  /** O que o Playwright disse sobre a falha. */
  failure: string;
  /** A árvore de acessibilidade da página no instante da falha, quando houve. */
  snapshot: string;
  /** O que a própria aplicação registrou enquanto o roteiro rodava. */
  serverErrors: readonly string[];
}

export function triagePrompt(context: TriageContext): string {
  const passos = context.workflow.steps.map((step, index) => `${index + 1}. ${step}`);

  return [
    languageBlock(context.language),
    "",
    TRIAGE_HEADER,
    "",
    "A user-flow script just failed against the running application. Decide WHOSE failure it is,",
    "before anyone spends a cycle on it. You only read: never write, edit, create or delete a file.",
    "",
    "You may read the product's source to confirm what you see.",
    "",
    `## The flow — workflow ${context.workflow.number}: ${context.workflow.name}`,
    "",
    ...passos,
    "",
    "## The phase — what the product owes",
    "",
    "````markdown",
    context.phaseMarkdown.trim(),
    "````",
    "",
    "## The script that failed",
    "",
    "```ts",
    context.script.trim(),
    "```",
    "",
    "## What the runner said",
    "",
    "```",
    context.failure.trim(),
    "```",
    "",
    "## The page at the moment of the failure",
    "",
    context.snapshot.trim() === ""
      ? "(no snapshot was recorded — judge from the output and the source)"
      : ["```yaml", context.snapshot.trim(), "```"].join("\n"),
    ...(context.serverErrors.length > 0
      ? ["", "## What the application logged", "", ...context.serverErrors.map((linha) => `- ${linha}`)]
      : []),
    "",
    "## How to decide",
    "",
    "- PRODUTO — the product does not do what an acceptance criterion of the phase or a step of the",
    "  flow requires: it saves and forgets, it answers an error, the user cannot reach the action.",
    "- ROTEIRO — the product does what the phase asks and the SCRIPT expects something nobody",
    "  promised: a label, a heading, a container, an API field type, a timing it did not wait for.",
    "  The page snapshot is your strongest evidence: if what the script looks for is there under",
    "  another name, or the script navigated before the save finished, it is the script.",
    "- CRITERIO — the criterion, read honestly, does not decide the case (for example, whether",
    "  permission to edit implies permission to view). Say which reading you recommend and why.",
    "",
    "Prefer PRODUTO only when you can name the criterion or the step it breaks.",
    "",
    "## Answer",
    "",
    "Exactly these lines, each on one line, and nothing after them:",
    "",
    "```",
    "CAPIVARA_TRIAGEM: PRODUTO | ROTEIRO | CRITERIO",
    "CAPIVARA_EVIDENCIA: <what in the snapshot or the output proves it>",
    "CAPIVARA_ONDE: <file(s) or route in the product; for ROTEIRO, the line of the script>",
    "CAPIVARA_CRITERIO: <the criterion or task it concerns>",
    "CAPIVARA_CORRECAO: <exactly what to change — in the product for PRODUTO, in the script for ROTEIRO,",
    "  the recommended reading for CRITERIO>",
    "```",
  ].join("\n");
}

/**
 * O veredito, ou nada.
 *
 * Nada quando o formato não veio: a triagem nunca bloqueia o gate, e sem
 * veredito legível o gate faz o que fazia antes dela.
 */
export function lerTriagem(output: string): Triagem | null {
  const campo = (nome: string): string =>
    new RegExp(`^[\\s*>-]*CAPIVARA_${nome}[\\s*]*:\\s*(.*)$`, "im").exec(output)?.[1]?.trim() ?? "";

  const tipo = campo("TRIAGEM").toUpperCase().replace(/[^A-Z]/g, "");
  if (tipo !== "PRODUTO" && tipo !== "ROTEIRO" && tipo !== "CRITERIO") return null;

  const correcao = campo("CORRECAO");
  if (correcao === "") return null;

  return { tipo, evidencia: campo("EVIDENCIA"), onde: campo("ONDE"), criterio: campo("CRITERIO"), correcao };
}
